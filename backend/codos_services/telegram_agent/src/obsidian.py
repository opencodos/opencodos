"""Obsidian-compatible markdown file writer."""

import re
from datetime import UTC, datetime
from pathlib import Path

import yaml

from backend.codos_services.telegram_agent.src.config import RoutingConfig
from backend.codos_services.telegram_agent.src.telegram_client import TelegramMessage


class ObsidianWriter:
    """Write Telegram messages to Obsidian-compatible markdown files."""

    def __init__(self, vault_path: Path, routing: RoutingConfig | None = None):
        self.vault_path = vault_path
        self.routing = routing
        self.vault_path.mkdir(parents=True, exist_ok=True)

    def _sanitize_filename(self, name: str) -> str:
        """Convert conversation name to safe filename."""
        # Remove/replace invalid characters
        safe = re.sub(r'[<>:"/\\|?*]', "", name)
        safe = safe.strip()
        return safe or "unnamed"

    def _get_file_path(
        self,
        conversation_name: str,
        conversation_type: str = "private",
        archived: bool = False,
    ) -> Path:
        """Get the markdown file path for a conversation.

        Args:
            conversation_name: Display name of the conversation
            conversation_type: "private", "group", or "channel"
            archived: Whether the conversation is archived
        """
        filename = self._sanitize_filename(conversation_name)

        # Determine subfolder based on routing rules
        if self.routing:
            subfolder = self.routing.get_subfolder(conversation_type, archived)
            folder_path = self.vault_path / subfolder
            folder_path.mkdir(parents=True, exist_ok=True)
            return folder_path / f"{filename}.md"

        return self.vault_path / f"{filename}.md"

    def write_messages(
        self,
        conversation_name: str,
        conversation_id: int,
        conversation_type: str,
        messages: list[TelegramMessage],
        append: bool = True,
        archived: bool = False,
        matched_contact_id: str | None = None,
        matched_contact_name: str | None = None,
        match_confidence: float | None = None,
        unread_count: int = 0,
    ) -> Path:
        """Write messages to a markdown file.

        Args:
            conversation_name: Display name of the conversation
            conversation_id: Telegram conversation ID
            conversation_type: "private", "group", or "channel"
            messages: List of messages to write
            append: If True, merge new messages with existing file
            archived: Whether the conversation is archived

        Returns:
            Path to the written file
        """
        file_path = self._get_file_path(conversation_name, conversation_type, archived)

        # Load existing content if appending
        existing_frontmatter: dict[str, object] = {}
        existing_body = ""
        last_message_id = None

        if file_path.exists():
            existing_body, existing_frontmatter = self._read_file_parts(file_path)
            last_message_id = existing_frontmatter.get("last_message_id")

        # Build frontmatter
        frontmatter: dict[str, object] = {
            "telegram_id": str(conversation_id),
            "type": conversation_type,
            "last_synced": datetime.now(UTC).isoformat(),
        }

        # Add CRM match data if available
        if matched_contact_id:
            frontmatter["matched_contact_id"] = matched_contact_id
        if matched_contact_name:
            frontmatter["matched_contact_name"] = matched_contact_name
        if match_confidence is not None:
            frontmatter["match_confidence"] = round(match_confidence, 2)

        frontmatter.update(existing_frontmatter)
        frontmatter["last_synced"] = datetime.now(UTC).isoformat()
        frontmatter["unread_count"] = unread_count

        # Preserve CRM fields from new data (don't let existing overwrite)
        if matched_contact_id:
            frontmatter["matched_contact_id"] = matched_contact_id
        if matched_contact_name:
            frontmatter["matched_contact_name"] = matched_contact_name
        if match_confidence is not None:
            frontmatter["match_confidence"] = round(match_confidence, 2)

        # Filter out messages already written based on frontmatter
        if isinstance(last_message_id, int):
            messages = [m for m in messages if m.id > last_message_id]
        elif isinstance(last_message_id, str) and last_message_id.isdigit():
            messages = [m for m in messages if m.id > int(last_message_id)]

        if not messages and existing_body:
            # No new messages; just update frontmatter
            self._write_file(file_path, frontmatter, existing_body)
            return file_path

        if not existing_body:
            # First write: format all messages
            content = self._format_messages(
                conversation_name,
                {
                    msg.id: {
                        "id": msg.id,
                        "date": msg.date,
                        "sender": msg.sender_name,
                        "text": msg.text,
                        "reply_to_text": msg.reply_to_text,
                        "reply_to_sender": msg.reply_to_sender,
                    }
                    for msg in messages
                },
            )
            frontmatter["last_message_id"] = max(msg.id for msg in messages) if messages else None
            self._write_file(file_path, frontmatter, content)
            return file_path

        # Append new messages to existing body while preserving newest-first order
        updated_body = self._append_messages_to_body(
            conversation_name=conversation_name,
            existing_body=existing_body,
            messages=messages,
        )

        if messages:
            frontmatter["last_message_id"] = max(msg.id for msg in messages)

        # Write file
        self._write_file(file_path, frontmatter, updated_body)

        return file_path

    def update_frontmatter(
        self, conversation_name: str, conversation_type: str, archived: bool = False, **updates
    ) -> Path | None:
        """Update frontmatter fields on an existing file without modifying messages."""
        file_path = self._get_file_path(conversation_name, conversation_type, archived)
        if not file_path.exists():
            return None
        existing_body, existing_frontmatter = self._read_file_parts(file_path)
        existing_frontmatter.update(updates)
        existing_frontmatter["last_synced"] = datetime.now(UTC).isoformat()
        self._write_file(file_path, existing_frontmatter, existing_body)
        return file_path

    def _format_messages(self, conversation_name: str, messages: dict[int, dict]) -> str:
        """Format messages into markdown."""
        if not messages:
            return f"# {conversation_name}\n\n*No messages yet*"

        # Sort by date (newest first within each day, days newest first)
        sorted_msgs = sorted(messages.values(), key=lambda m: m["date"], reverse=True)

        # Group messages by date
        by_date: dict[str, list[dict]] = {}
        for msg in sorted_msgs:
            date_str = msg["date"].strftime("%Y-%m-%d")
            if date_str not in by_date:
                by_date[date_str] = []
            by_date[date_str].append(msg)

        lines = [f"# {conversation_name}", ""]

        for date_str in sorted(by_date.keys(), reverse=True):
            lines.append(f"## {date_str}")
            lines.append("")

            day_messages = sorted(by_date[date_str], key=lambda m: m["date"], reverse=True)
            for msg in day_messages:
                time_str = msg["date"].strftime("%H:%M")
                lines.append(f"### {time_str} - {msg['sender']}")
                # Add reply context if present
                reply_text = msg.get("reply_to_text")
                if reply_text:
                    reply_preview = reply_text.replace("\n", " ")[:80]
                    sender = msg.get("reply_to_sender") or "Unknown"
                    lines.append(f"> *↩ {sender}:*")
                    lines.append(f"> {reply_preview}")
                    lines.append("")
                # Escape any markdown in the message text
                text = msg["text"].replace("\n", "\n> ")
                lines.append(text)
                lines.append("")

        return "\n".join(lines)

    def _read_file_parts(self, file_path: Path) -> tuple[str, dict]:
        """Read existing markdown file, extracting body and frontmatter."""
        content = file_path.read_text()

        frontmatter: dict[str, object] = {}
        body = content

        if content.startswith("---"):
            parts = content.split("---", 2)
            if len(parts) >= 3:
                try:
                    frontmatter = yaml.safe_load(parts[1]) or {}
                except yaml.YAMLError:
                    pass
                body = parts[2].strip()

        return body, frontmatter

    def _append_messages_to_body(
        self,
        conversation_name: str,
        existing_body: str,
        messages: list[TelegramMessage],
    ) -> str:
        """Append new messages to an existing body, preserving newest-first order."""
        if not messages:
            return existing_body

        # Prepare new messages grouped by date (newest first)
        sorted_msgs = sorted(messages, key=lambda m: m.date, reverse=True)
        by_date: dict[str, list[TelegramMessage]] = {}
        for msg in sorted_msgs:
            date_str = msg.date.strftime("%Y-%m-%d")
            by_date.setdefault(date_str, []).append(msg)

        def format_message_lines(day_msgs: list[TelegramMessage]) -> list[str]:
            lines: list[str] = []
            for msg in sorted(day_msgs, key=lambda m: m.date, reverse=True):
                time_str = msg.date.strftime("%H:%M")
                lines.append(f"### {time_str} - {msg.sender_name}")
                # Add reply context if present
                if msg.reply_to_text:
                    reply_preview = msg.reply_to_text.replace("\n", " ")[:80]
                    sender = msg.reply_to_sender or "Unknown"
                    lines.append(f"> *↩ {sender}:*")
                    lines.append(f"> {reply_preview}")
                    lines.append("")
                text = msg.text.replace("\n", "\n> ")
                lines.append(text)
                lines.append("")
            return lines

        lines = existing_body.splitlines()
        title_line = None
        body_start = 0
        if lines and lines[0].startswith("# "):
            title_line = lines[0]
            body_start = 1
            if len(lines) > 1 and lines[1] == "":
                body_start = 2
        body_lines = lines[body_start:]

        # Find first date section in existing body
        first_date_index = None
        first_date = None
        for i, line in enumerate(body_lines):
            if line.startswith("## "):
                first_date_index = i
                first_date = line[3:].strip()
                break

        # If latest date already exists, insert under that header
        if first_date and first_date in by_date and first_date_index is not None:
            insert_at = first_date_index + 1
            if insert_at < len(body_lines) and body_lines[insert_at] == "":
                insert_at += 1
            body_lines = body_lines[:insert_at] + format_message_lines(by_date[first_date]) + body_lines[insert_at:]
            del by_date[first_date]

        # Prepend remaining new date sections (newest first)
        prefix_lines: list[str] = []
        for date_str in sorted(by_date.keys(), reverse=True):
            prefix_lines.append(f"## {date_str}")
            prefix_lines.append("")
            prefix_lines.extend(format_message_lines(by_date[date_str]))

        updated_body_lines = prefix_lines + body_lines

        final_title = title_line or f"# {conversation_name}"
        return "\n".join([final_title, ""] + updated_body_lines).strip() + "\n"

    def _sort_and_dedupe_body(self, body: str) -> str:
        """Sort date sections newest-first and remove duplicate messages."""
        lines = body.splitlines()

        # Extract title
        title_line = None
        body_start = 0
        if lines and lines[0].startswith("# "):
            title_line = lines[0]
            body_start = 1
            if len(lines) > 1 and lines[1] == "":
                body_start = 2

        # Parse into date sections
        sections: dict[str, list[str]] = {}
        current_date = None
        current_lines: list[str] = []

        for line in lines[body_start:]:
            if line.startswith("## ") and re.match(r"## \d{4}-\d{2}-\d{2}", line):
                if current_date:
                    sections.setdefault(current_date, []).extend(current_lines)
                current_date = line[3:].strip()
                current_lines = []
            elif current_date:
                current_lines.append(line)

        if current_date:
            sections.setdefault(current_date, []).extend(current_lines)

        # Deduplicate messages within each date (by full content: header + text)
        # Multiple messages can have the same time+sender, so we must include text
        for date_str in sections:
            seen = set()
            deduped = []
            current_msg: list[str] = []
            current_header = None

            for line in sections[date_str]:
                if line.startswith("### "):
                    if current_header:
                        # Build key from header + message content
                        content_key = current_header + "|" + "".join(current_msg[1:])
                        if content_key not in seen:
                            seen.add(content_key)
                            deduped.extend(current_msg)
                    current_header = line
                    current_msg = [line]
                else:
                    current_msg.append(line)

            if current_header:
                content_key = current_header + "|" + "".join(current_msg[1:])
                if content_key not in seen:
                    deduped.extend(current_msg)

            sections[date_str] = deduped

        # Rebuild body with dates sorted newest-first
        result_lines = [title_line, ""] if title_line else []
        for date_str in sorted(sections.keys(), reverse=True):
            result_lines.append(f"## {date_str}")
            result_lines.append("")
            result_lines.extend(sections[date_str])

        return "\n".join(result_lines)

    def _write_file(self, file_path: Path, frontmatter: dict, content: str) -> None:
        """Write file with YAML frontmatter."""
        # Sort date sections and dedupe before writing
        content = self._sort_and_dedupe_body(content)

        fm_str = yaml.dump(frontmatter, default_flow_style=False, sort_keys=False, allow_unicode=True)

        full = f"---\n{fm_str}---\n\n{content}"
        file_path.write_text(full)

    def read_conversation(self, conversation_name: str) -> str | None:
        """Read the content of a conversation file."""
        file_path = self._get_file_path(conversation_name)
        if not file_path.exists():
            return None

        content = file_path.read_text()

        # Strip frontmatter
        if content.startswith("---"):
            parts = content.split("---", 2)
            if len(parts) >= 3:
                return parts[2].strip()

        return content

    def list_conversations(self) -> list[str]:
        """List all conversation files in the vault."""
        return [f.stem for f in self.vault_path.glob("*.md")]

    def get_last_message_info(self, conversation_name: str) -> dict | None:
        """Get info about the last synced message for a conversation."""
        file_path = self._get_file_path(conversation_name)
        if not file_path.exists():
            return None

        content = file_path.read_text()

        if content.startswith("---"):
            parts = content.split("---", 2)
            if len(parts) >= 3:
                try:
                    frontmatter = yaml.safe_load(parts[1]) or {}
                    return {
                        "last_synced": frontmatter.get("last_synced"),
                        "telegram_id": frontmatter.get("telegram_id"),
                        "last_message_id": frontmatter.get("last_message_id"),
                    }
                except yaml.YAMLError:
                    pass

        return None
