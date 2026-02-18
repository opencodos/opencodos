"""Stream Manager for Claude Code using stream-json output mode.

This module replaces the tmux-based session_manager with direct subprocess
execution using Claude Code's --output-format stream-json mode.

Key benefits:
- No ANSI codes or terminal artifacts to filter
- Clean JSON events with structured data
- No tmux dependency
- Simpler architecture (subprocess + stdout)

Session continuity via --continue flag (uses per-session directories).
"""

import asyncio
import json
import os
import shutil
import subprocess
from collections.abc import AsyncGenerator
from pathlib import Path

from loguru import logger
from ..settings import SESSIONS_DIR, settings

from .agent_loader import build_session_prompt


def _parse_etime(etime: str) -> int:
    """Parse ps elapsed time format to seconds.

    Formats: MM:SS, HH:MM:SS, D-HH:MM:SS
    """
    if "-" in etime:
        # D-HH:MM:SS
        days, rest = etime.split("-")
        parts = rest.split(":")
        return int(days) * 86400 + int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])

    parts = etime.split(":")
    if len(parts) == 3:
        # HH:MM:SS
        return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
    else:
        # MM:SS
        return int(parts[0]) * 60 + int(parts[1])


def _kill_stale_qmd_processes(max_age_seconds: int = 600) -> int:
    """Kill QMD MCP processes older than max_age_seconds.

    Preserves fresh processes that may be serving active queries.
    QMD processes accumulate and compete for GPU memory, causing OOM errors.

    Args:
        max_age_seconds: Kill processes older than this (default: 10 min)

    Returns:
        int: Number of processes killed
    """
    try:
        # Get all processes with elapsed time
        result = subprocess.run(["ps", "-o", "pid,etime,command"], capture_output=True, text=True, timeout=5)

        killed = 0
        for line in result.stdout.splitlines():
            if "qmd" in line and "mcp" in line and "grep" not in line:
                parts = line.split()
                if len(parts) < 2:
                    continue

                pid = parts[0]
                etime = parts[1]

                # Parse elapsed time to seconds
                try:
                    age_seconds = _parse_etime(etime)
                except (ValueError, IndexError):
                    continue

                if age_seconds > max_age_seconds:
                    subprocess.run(["kill", pid], timeout=2)
                    logger.info(f"Killed stale QMD process {pid} (age: {age_seconds}s)")
                    killed += 1
                else:
                    logger.debug(f"Keeping fresh QMD process {pid} (age: {age_seconds}s)")

        return killed

    except Exception as e:
        logger.warning(f"Failed to clean QMD processes: {e}")
        return 0


# Session storage (imported from settings)

# Default timeout for stream operations (handles bug #1920 - missing result event)
# 60s is reasonable for most tasks; increase for complex agentic workflows
DEFAULT_TIMEOUT = 180  # seconds


def _find_bun_cli() -> str | None:
    """Find the bun executable (bundled or system)."""
    bundled = settings.atlas_bundled_bun
    if bundled and Path(bundled).exists():
        return bundled
    bun_path = shutil.which("bun")
    if bun_path:
        return bun_path
    home_bun = Path.home() / ".bun" / "bin" / "bun"
    if home_bun.exists():
        return str(home_bun)
    return None


def _find_claude_cli() -> str:
    """Find the claude CLI executable with fallback paths."""
    bundled = settings.atlas_bundled_claude
    if bundled and Path(bundled).exists():
        return bundled

    claude_path = shutil.which("claude")
    if claude_path:
        return claude_path

    common_paths = [
        "/usr/local/bin/claude",
        "/opt/homebrew/bin/claude",
        str(Path.home() / ".local/bin/claude"),
    ]

    for path in common_paths:
        if Path(path).exists():
            return path

    # Check NVM paths
    nvm_base = Path.home() / ".nvm/versions/node"
    if nvm_base.exists():
        for version_dir in sorted(nvm_base.iterdir(), reverse=True):
            candidate = version_dir / "bin" / "claude"
            if candidate.exists():
                return str(candidate)

    # Check fnm paths
    fnm_base = Path.home() / ".fnm/node-versions"
    if fnm_base.exists():
        for version_dir in sorted(fnm_base.iterdir(), reverse=True):
            candidate = version_dir / "installation/bin/claude"
            if candidate.exists():
                return str(candidate)

    raise RuntimeError(
        "claude CLI not found in PATH or common locations.\nPlease install: npm install -g @anthropic-ai/claude-code"
    )


class StreamManager:
    """Manages Claude Code sessions using stream-json subprocess mode.

    This replaces the tmux-based SessionManager with a simpler architecture:
    - Each message spawns a subprocess with `claude -p --output-format stream-json`
    - Session continuity via --continue flag (works in per-session directories)
    - Auto-approve all tools via --permission-mode=bypassPermissions
    """

    def __init__(self):
        """Initialize the stream manager."""
        SESSIONS_DIR.mkdir(parents=True, exist_ok=True)

        # Clean up stale QMD processes (>10 min old) to free GPU memory
        # Multiple QMD MCP processes compete for GPU, causing OOM errors
        killed = _kill_stale_qmd_processes(max_age_seconds=600)
        if killed:
            logger.info(f"Cleaned up {killed} stale QMD process(es)")

        # Cache bun and claude CLI paths
        self._bun_path = _find_bun_cli()
        if self._bun_path:
            logger.info(f"StreamManager using bun at: {self._bun_path}")

        try:
            self._claude_path = _find_claude_cli()
            logger.info(f"StreamManager using claude CLI at: {self._claude_path}")
        except RuntimeError as e:
            logger.warning(f"Claude CLI not found during init: {e}")
            self._claude_path = None

        # Track which sessions have had their first message
        # (needed to decide whether to use --continue)
        self._session_initialized: dict[str, bool] = {}

        # Track running processes for stop functionality
        self._running_processes: dict[str, asyncio.subprocess.Process] = {}

    def _ensure_session_dir(self, session_id: str, agent_id: str = "engineer") -> Path:
        """Ensure session directory exists with CLAUDE.md persona.

        Args:
            session_id: Unique session identifier
            agent_id: Agent type for persona selection

        Returns:
            Path: The session directory path
        """
        session_dir = SESSIONS_DIR / session_id
        session_dir.mkdir(exist_ok=True)

        # Create CLAUDE.md with agent persona (loaded from agents/ config)
        claude_md = session_dir / "CLAUDE.md"
        claude_md.write_text(build_session_prompt(agent_id, session_id))
        codos_path = settings.get_codos_path()

        # Register Codos skills so Claude Code recognizes /brief, /todo, etc.
        # Claude Code indexes skills by FOLDER NAME, not the frontmatter "name"
        # field. So we create per-skill symlinks named after the trigger:
        #   .claude/skills/brief/ -> skills/Morning Brief/
        #   .claude/skills/todo/  -> skills/Daily Todo/
        claude_dir = session_dir / ".claude"
        claude_dir.mkdir(exist_ok=True)

        skills_target = claude_dir / "skills"
        skills_target.mkdir(exist_ok=True)
        skills_source = codos_path / "skills"
        if skills_source.exists():
            for skill_dir in skills_source.iterdir():
                if not skill_dir.is_dir():
                    continue
                skill_file = skill_dir / "SKILL.md"
                if not skill_file.exists():
                    continue
                # Read frontmatter "name" field for the trigger name
                content = skill_file.read_text(encoding="utf-8")
                if content.startswith("---"):
                    end = content.find("\n---", 3)
                    if end != -1:
                        for line in content[3:end].splitlines():
                            if line.startswith("name:"):
                                trigger = line.split(":", 1)[1].strip().strip("'\"")
                                link = skills_target / trigger
                                if not link.exists():
                                    link.symlink_to(skill_dir)
                                break

        # Disable hooks for stream-json mode (hooks cause duplicate events)
        settings_file = claude_dir / "settings.json"
        settings_file.write_text('{"hooks": {}}')

        return session_dir

    def session_exists(self, session_id: str) -> bool:
        """Check if a session directory exists.

        Note: With stream-json, there's no persistent process to check.
        We only check if the session directory exists.
        """
        session_dir = SESSIONS_DIR / session_id
        return session_dir.exists()

    async def send_prompt(
        self,
        session_id: str,
        prompt: str,
        agent_id: str = "engineer",
        timeout: float = DEFAULT_TIMEOUT,
    ) -> AsyncGenerator[dict, None]:
        """Send a prompt to Claude and stream JSON events.

        Args:
            session_id: Unique session identifier
            prompt: The user's message
            agent_id: Agent type for persona selection
            timeout: Maximum time to wait for completion (handles bug #1920)

        Yields:
            dict: Stream-json events from Claude Code

        Event types:
            - {"type": "assistant", "message": {...}} - Assistant response with content
            - {"type": "user", "message": {...}} - Tool results
            - {"type": "result", ...} - Final result
            - {"type": "error", "error": "..."} - Error event (our addition)
        """
        # Ensure session directory exists
        session_dir = self._ensure_session_dir(session_id, agent_id)

        # Find claude CLI
        if self._claude_path is None:
            try:
                self._claude_path = _find_claude_cli()
            except RuntimeError as e:
                yield {"type": "error", "error": str(e)}
                return

        # Build command - use bun as interpreter when node isn't available
        # (bundled claude has #!/usr/bin/env node shebang)
        cmd = []
        if self._bun_path and settings.atlas_bundled_claude:
            cmd.append(self._bun_path)
        cmd.extend(
            [
                self._claude_path,
                "-p",  # Print mode (non-interactive)
                "--output-format",
                "stream-json",
                "--verbose",
                "--permission-mode",
                "bypassPermissions",  # Auto-approve all tools
                "--include-partial-messages",  # Smoother text streaming
            ]
        )

        # Use --continue for subsequent messages (session continuity)
        # The --continue flag tells Claude to resume in the same directory context
        if self._session_initialized.get(session_id, False):
            cmd.append("--continue")

        # Add the prompt
        cmd.append(prompt)

        logger.info(f"Executing: {' '.join(cmd[:6])}... in {session_dir}")

        # Setup environment - use subscription auth (not API key)
        env = os.environ.copy()
        # Remove ANTHROPIC_API_KEY to use subscription instead of API credits
        # See: https://github.com/anthropics/claude-code/issues/3040
        env.pop("ANTHROPIC_API_KEY", None)
        # Remove CLAUDECODE to avoid "nested session" error when connector
        # was started from a Claude Code terminal
        env.pop("CLAUDECODE", None)

        try:
            # Start subprocess with large buffer for tool results
            # Default 64KB limit is too small for large JSON events
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(session_dir),
                env=env,
                limit=10 * 1024 * 1024,  # 10MB buffer for large tool results
            )

            # Track running process for stop functionality
            self._running_processes[session_id] = process

            # Stream stdout line by line with timeout
            got_events = False
            try:
                async with asyncio.timeout(timeout):
                    async for line in process.stdout:
                        line_str = line.decode("utf-8").strip()
                        if not line_str:
                            continue

                        try:
                            event = json.loads(line_str)
                            got_events = True
                            yield event

                            # Check for result event (end of stream)
                            if event.get("type") == "result":
                                # Mark session initialized only after successful completion
                                self._session_initialized[session_id] = True
                                # Validate result (bug #8126 - empty result 40% of time)
                                if event.get("is_error"):
                                    yield {
                                        "type": "error",
                                        "error": event.get("result", "Unknown error"),
                                    }
                                return

                        except json.JSONDecodeError:
                            # Non-JSON output (unexpected but handle gracefully)
                            logger.warning(f"Non-JSON line from claude: {line_str[:100]}")
                            continue

            except TimeoutError:
                # Bug #1920 - missing result event
                logger.error(f"Stream timeout for session {session_id} - no result event received")
                yield {
                    "type": "error",
                    "error": "Stream timeout - Claude did not return a result",
                }

                # SIGTERM → SIGKILL escalation for clean process termination
                try:
                    process.terminate()  # SIGTERM
                    try:
                        await asyncio.wait_for(process.wait(), timeout=5.0)
                    except TimeoutError:
                        logger.warning(f"SIGTERM failed for session {session_id}, sending SIGKILL")
                        process.kill()  # SIGKILL
                        await process.wait()
                except ProcessLookupError:
                    pass  # Process already dead
                return

            # Wait for process to complete
            await process.wait()

            # Check exit code
            if process.returncode != 0:
                stderr = await process.stderr.read()
                error_msg = stderr.decode("utf-8") if stderr else f"Exit code {process.returncode}"
                logger.error(f"Claude process failed: {error_msg}")
                yield {"type": "error", "error": error_msg}

        except FileNotFoundError:
            yield {"type": "error", "error": f"Claude CLI not found at {self._claude_path}"}
        except Exception as e:
            logger.exception(f"Stream error for session {session_id}")
            yield {"type": "error", "error": str(e)}
        finally:
            # Clean up process tracking
            self._running_processes.pop(session_id, None)

    async def stop_session(self, session_id: str) -> bool:
        """Stop the running Claude process for a session.

        Sends SIGTERM first, then SIGKILL if needed.

        Args:
            session_id: The session to stop

        Returns:
            bool: True if process was stopped, False if no process was running
        """
        process = self._running_processes.get(session_id)
        if not process:
            logger.info(f"[StreamManager] No running process to stop for {session_id}")
            return False

        logger.info(f"[StreamManager] Stopping process for session {session_id}")

        try:
            # SIGTERM first
            process.terminate()
            try:
                await asyncio.wait_for(process.wait(), timeout=3.0)
                logger.info(f"[StreamManager] Process stopped gracefully for {session_id}")
            except TimeoutError:
                # SIGKILL if SIGTERM didn't work
                logger.warning(f"[StreamManager] SIGTERM failed for {session_id}, sending SIGKILL")
                process.kill()
                await process.wait()
        except ProcessLookupError:
            pass  # Process already dead

        # Clean up tracking
        self._running_processes.pop(session_id, None)
        return True

    def kill_session(self, session_id: str) -> bool:
        """Clean up a session.

        With stream-json, there's no persistent process to kill.
        We just remove the session from our tracking.

        Args:
            session_id: The session to clean up

        Returns:
            bool: True (always succeeds)
        """
        self._session_initialized.pop(session_id, None)
        return True

    def list_sessions(self) -> list[dict]:
        """List all session directories.

        Returns:
            list[dict]: Session info with keys: session_id, cwd, initialized
        """
        sessions = []

        if not SESSIONS_DIR.exists():
            return sessions

        for session_dir in SESSIONS_DIR.iterdir():
            if session_dir.is_dir():
                session_id = session_dir.name
                sessions.append(
                    {
                        "session_id": session_id,
                        "cwd": str(session_dir),
                        "initialized": self._session_initialized.get(session_id, False),
                        "alive": True,  # Always "alive" since no persistent process
                    }
                )

        return sessions


# Singleton instance
_manager: StreamManager | None = None


def get_stream_manager() -> StreamManager:
    """Get or create the stream manager singleton."""
    global _manager
    if _manager is None:
        _manager = StreamManager()
    return _manager
