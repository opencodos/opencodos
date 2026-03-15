"""Claude service using Claude Code CLI for streaming chat."""

import asyncio
import json
from collections.abc import AsyncGenerator
from pathlib import Path

from backend.codos_models.exceptions import DependencyNotInstalledException
from backend.codos_utils.deps import find_claude

from .agent_loader import parse_agent


class ClaudeService:
    """Service that uses Claude Code CLI for streaming responses."""

    def __init__(self):
        claude_path = find_claude()
        if not claude_path:
            raise DependencyNotInstalledException(
                "claude CLI not found. Please install: curl -fsSL https://claude.ai/install.sh | bash"
            )
        self.claude_path = claude_path

    async def stream_chat(
        self, messages: list[dict], agent_id: str = "engineer", tools: list[dict] | None = None
    ) -> AsyncGenerator[dict]:
        """
        Stream chat using Claude Code CLI.

        Uses --print --output-format stream-json for streaming output.
        """
        # Build the prompt from messages
        prompt_parts = []
        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            if role == "user":
                prompt_parts.append(f"User: {content}")
            elif role == "assistant":
                prompt_parts.append(f"Assistant: {content}")

        # Get the last user message as the main prompt
        last_user_msg = ""
        for msg in reversed(messages):
            if msg.get("role") == "user":
                last_user_msg = msg.get("content", "")
                break

        if not last_user_msg:
            yield {"type": "error", "error": "No user message found"}
            return

        # Build system prompt from agent config
        agent_config = parse_agent(agent_id)
        system_prompt = agent_config.prompt if agent_config else "You are a helpful assistant."

        # Build command
        cmd = [
            self.claude_path,
            "--print",
            "--output-format",
            "stream-json",
            "--verbose",
            "--append-system-prompt",
            system_prompt,
            last_user_msg,
        ]

        try:
            # Start the process
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(Path.home()),  # Run from home directory
            )

            accumulated_text = ""

            # Stream stdout line by line
            if process.stdout is None:
                yield {"type": "error", "error": "Failed to capture stdout"}
                return
            async for line in process.stdout:
                line_str = line.decode("utf-8").strip()
                if not line_str:
                    continue

                try:
                    event = json.loads(line_str)
                    event_type = event.get("type", "")

                    # Handle different event types from Claude Code
                    if event_type == "assistant":
                        # Assistant message with content
                        message = event.get("message", {})
                        content = message.get("content", [])
                        for block in content:
                            if block.get("type") == "text":
                                text = block.get("text", "")
                                if text and text != accumulated_text:
                                    # Yield only new text
                                    new_text = text[len(accumulated_text) :]
                                    if new_text:
                                        accumulated_text = text
                                        yield {"type": "token", "content": new_text}
                            elif block.get("type") == "tool_use":
                                yield {
                                    "type": "tool_call",
                                    "id": block.get("id", ""),
                                    "name": block.get("name", ""),
                                    "input": block.get("input", {}),
                                }

                    elif event_type == "content_block_delta":
                        # Streaming text delta
                        delta = event.get("delta", {})
                        if delta.get("type") == "text_delta":
                            text = delta.get("text", "")
                            if text:
                                yield {"type": "token", "content": text}

                    elif event_type == "content_block_start":
                        # Tool use starting
                        content_block = event.get("content_block", {})
                        if content_block.get("type") == "tool_use":
                            yield {
                                "type": "tool_call",
                                "id": content_block.get("id", ""),
                                "name": content_block.get("name", ""),
                                "input": {},
                            }

                    elif event_type == "result":
                        # Final result
                        result = event.get("result", "")
                        if result and result != accumulated_text:
                            new_text = result[len(accumulated_text) :]
                            if new_text:
                                yield {"type": "token", "content": new_text}

                        yield {"type": "complete", "message": {"content": result, "usage": event.get("usage", {})}}
                        return

                except json.JSONDecodeError:
                    # Non-JSON output, treat as text
                    if line_str:
                        yield {"type": "token", "content": line_str + "\n"}

            # Wait for process to complete
            await process.wait()

            # Check for errors
            if process.returncode != 0:
                stderr_data = await process.stderr.read() if process.stderr else None
                error_msg = stderr_data.decode("utf-8") if stderr_data else f"Exit code {process.returncode}"
                yield {"type": "error", "error": error_msg}
            else:
                # Send complete if not already sent
                yield {"type": "complete", "message": {"content": accumulated_text}}

        except FileNotFoundError:
            yield {"type": "error", "error": f"Claude CLI not found at {self.claude_path}"}
        except Exception as e:
            yield {"type": "error", "error": str(e)}


# Singleton instance
_service: ClaudeService | None = None


def get_claude_service() -> ClaudeService:
    """Get or create the Claude service singleton."""
    global _service
    if _service is None:
        _service = ClaudeService()
    return _service
