"""Claude integration for message processing and interactive chat."""

from typing import Any

import anthropic
from anthropic.types import ContentBlockParam, MessageParam, ToolParam, ToolResultBlockParam, ToolUseBlock
from rich.console import Console

from backend.codos_services.telegram_agent.src.config import Config
from backend.codos_services.telegram_agent.src.obsidian import ObsidianWriter
from backend.codos_services.telegram_agent.src.telegram_client import TelegramClientWrapper

console = Console()


# Tool definitions for Claude
TOOLS: list[ToolParam] = [
    {
        "name": "send_telegram_message",
        "description": (
            "Send a message to a Telegram conversation. IMPORTANT: Always confirm with the user "
            "before sending unless they explicitly said 'send' or 'tell them'."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "conversation_name": {
                    "type": "string",
                    "description": "Name of the conversation (partial match supported)",
                },
                "message": {"type": "string", "description": "The message to send"},
            },
            "required": ["conversation_name", "message"],
        },
    },
    {
        "name": "read_conversation",
        "description": "Read recent messages from a conversation's Obsidian file",
        "input_schema": {
            "type": "object",
            "properties": {"conversation_name": {"type": "string", "description": "Name of the conversation"}},
            "required": ["conversation_name"],
        },
    },
    {
        "name": "list_conversations",
        "description": "List all synced conversations",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "search_messages",
        "description": "Search across all conversations for messages containing a query",
        "input_schema": {
            "type": "object",
            "properties": {"query": {"type": "string", "description": "Search query"}},
            "required": ["query"],
        },
    },
]

SYSTEM_PROMPT = """You are a helpful personal assistant with access to the user's Telegram messages.

You can:
1. Send messages to Telegram conversations on the user's behalf
2. Read and summarize messages from synced conversations
3. Search across all messages
4. Help the user manage their communications

IMPORTANT RULES:
- When the user asks to send a message, ALWAYS confirm with them before actually sending, \
showing the exact message and recipient
- Only send without confirmation if the user explicitly says "send" or "tell them" in their request
- Be concise and helpful
- The user's message history is stored in Obsidian markdown files
- When reading conversations, summarize key points unless asked for full content"""


class ClaudeAssistant:
    """Interactive Claude assistant with Telegram tools."""

    def __init__(
        self,
        config: Config,
        telegram: TelegramClientWrapper,
        obsidian: ObsidianWriter,
    ):
        self.config = config
        self.telegram = telegram
        self.obsidian = obsidian
        self.client = anthropic.Anthropic(api_key=config.anthropic.api_key)
        self.messages: list[MessageParam] = []
        self.pending_send: dict[str, Any] | None = None  # Track pending message to send

    async def chat(self, user_message: str) -> str:
        """Process a user message and return response."""
        # Check if user is confirming a pending send
        if self.pending_send and user_message.lower() in ("yes", "y", "send", "confirm"):
            result = await self._execute_send(self.pending_send["conversation"], self.pending_send["message"])
            self.pending_send = None
            return result

        if self.pending_send and user_message.lower() in ("no", "n", "cancel"):
            self.pending_send = None
            return "Message cancelled."

        self.messages.append({"role": "user", "content": user_message})

        response = self.client.messages.create(
            model=self.config.anthropic.model,
            max_tokens=4096,
            system=SYSTEM_PROMPT,
            tools=TOOLS,
            messages=self.messages,
        )

        # Process response and handle tool calls
        return await self._process_response(response)

    async def _process_response(self, response) -> str:
        """Process Claude response, handling any tool calls."""
        while True:
            final_text = ""
            content_blocks: list[ContentBlockParam] = []
            tool_blocks: list[ToolUseBlock] = []

            for block in response.content:
                if block.type == "text":
                    final_text += block.text
                    content_blocks.append({"type": "text", "text": block.text})
                elif block.type == "tool_use":
                    content_blocks.append(
                        {"type": "tool_use", "id": block.id, "name": block.name, "input": block.input}
                    )
                    tool_blocks.append(block)

            assistant_message: MessageParam = {"role": "assistant", "content": content_blocks}

            # No tool calls - just text response
            if not tool_blocks:
                self.messages.append(assistant_message)
                return final_text

            # Execute all tools and collect results
            self.messages.append(assistant_message)
            tool_results: list[ToolResultBlockParam] = []
            for block in tool_blocks:
                tool_result = await self._execute_tool(block.name, block.input)
                tool_results.append({"type": "tool_result", "tool_use_id": block.id, "content": tool_result})

            self.messages.append({"role": "user", "content": tool_results})

            # Get Claude's response to tool results and continue loop
            response = self.client.messages.create(
                model=self.config.anthropic.model,
                max_tokens=4096,
                system=SYSTEM_PROMPT,
                tools=TOOLS,
                messages=self.messages,
            )

    async def _execute_tool(self, tool_name: str, tool_input: dict) -> str:
        """Execute a tool and return the result."""
        try:
            if tool_name == "send_telegram_message":
                return await self._tool_send_message(tool_input["conversation_name"], tool_input["message"])

            elif tool_name == "read_conversation":
                return self._tool_read_conversation(tool_input["conversation_name"])

            elif tool_name == "list_conversations":
                return self._tool_list_conversations()

            elif tool_name == "search_messages":
                return self._tool_search_messages(tool_input["query"])

            else:
                return f"Unknown tool: {tool_name}"

        except Exception as e:
            return f"Error executing {tool_name}: {str(e)}"

    async def _tool_send_message(self, conversation_name: str, message: str) -> str:
        """Prepare to send a message to Telegram (with confirmation)."""
        conv = await self.telegram.find_conversation_by_name(conversation_name)
        if not conv:
            return f"Could not find conversation matching '{conversation_name}'"

        # Store pending send for confirmation
        self.pending_send = {"conversation": conv, "message": message}

        return f"Ready to send to {conv.name}. Message: \"{message}\". User should confirm with 'yes' or 'no'."

    async def _execute_send(self, conv, message: str) -> str:
        """Actually send the message after confirmation."""
        try:
            await self.telegram.send_message(conv.id, message)
            return f"Message sent to {conv.name}"
        except Exception as e:
            return f"Failed to send: {e}"

    def _tool_read_conversation(self, conversation_name: str) -> str:
        """Read messages from Obsidian file."""
        content = self.obsidian.read_conversation(conversation_name)
        if content is None:
            # Try partial match
            all_convs = self.obsidian.list_conversations()
            matches = [c for c in all_convs if conversation_name.lower() in c.lower()]
            if matches:
                content = self.obsidian.read_conversation(matches[0])
                if content:
                    return f"[Reading from: {matches[0]}]\n\n{content[:8000]}"

            return f"No synced messages found for '{conversation_name}'"

        # Truncate if too long
        if len(content) > 8000:
            content = content[:8000] + "\n\n[... truncated ...]"

        return content

    def _tool_list_conversations(self) -> str:
        """List all synced conversations."""
        conversations = self.obsidian.list_conversations()
        if not conversations:
            return "No conversations synced yet. Run 'python agent.py sync' first."

        return "Synced conversations:\n" + "\n".join(f"- {c}" for c in sorted(conversations))

    def _tool_search_messages(self, query: str) -> str:
        """Search across all conversation files."""
        results = []
        query_lower = query.lower()

        for conv_name in self.obsidian.list_conversations():
            content = self.obsidian.read_conversation(conv_name)
            if content and query_lower in content.lower():
                # Find matching lines
                for line in content.split("\n"):
                    if query_lower in line.lower():
                        results.append(f"[{conv_name}] {line.strip()}")

        if not results:
            return f"No messages found containing '{query}'"

        # Limit results
        if len(results) > 20:
            results = results[:20]
            results.append("... and more results")

        return "\n".join(results)


async def run_chat_loop(config: Config) -> None:
    """Run interactive chat loop."""
    from backend.codos_services.telegram_agent.src.obsidian import ObsidianWriter
    from backend.codos_services.telegram_agent.src.telegram_client import TelegramClientWrapper

    telegram = TelegramClientWrapper(
        config.telegram.api_id,
        config.telegram.api_hash,
        config.base_path,
    )
    obsidian = ObsidianWriter(config.obsidian.vault_path, config.obsidian.routing)

    await telegram.connect()

    try:
        assistant = ClaudeAssistant(config, telegram, obsidian)

        console.print("[bold]Telegram Agent[/bold] - Chat Mode")
        console.print("Commands: 'quit' to exit, 'sync' to sync messages\n")

        while True:
            try:
                user_input = console.input("[bold blue]You:[/bold blue] ").strip()
            except (EOFError, KeyboardInterrupt):
                break

            if not user_input:
                continue

            if user_input.lower() in ("quit", "exit", "q"):
                break

            if user_input.lower() == "sync":
                from backend.codos_services.telegram_agent.src.sync import SyncManager

                sync_manager = SyncManager(telegram, obsidian, config)
                await sync_manager.sync()
                continue

            console.print("[dim]Thinking...[/dim]")
            response = await assistant.chat(user_input)
            console.print(f"[bold green]Agent:[/bold green] {response}\n")

            # If there's a pending send, prompt for confirmation
            if assistant.pending_send:
                console.print("[yellow]Confirm send? (yes/no)[/yellow]")

    finally:
        await telegram.disconnect()
