"""Format Claude Code output for Telegram using HTML mode"""

import html
import re

# Telegram message limit
MAX_MESSAGE_LENGTH = 4096


def escape_html(text: str) -> str:
    """Escape HTML special characters"""
    return html.escape(text)


def markdown_to_html(text: str) -> str:
    """Convert common markdown to Telegram HTML"""
    # Escape HTML first
    text = escape_html(text)

    # Convert **bold** to <b>bold</b>
    text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)

    # Convert *italic* to <i>italic</i> (but not if it's **)
    text = re.sub(r"(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)", r"<i>\1</i>", text)

    # Convert `code` to <code>code</code>
    text = re.sub(r"`([^`]+)`", r"<code>\1</code>", text)

    # Convert ```code blocks``` to <pre>code</pre>
    text = re.sub(r"```(\w*)\n?(.*?)```", r"<pre>\2</pre>", text, flags=re.DOTALL)

    # Convert [text](url) to <a href="url">text</a>
    text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', text)

    return text


def format_response(text: str, execution_time: float | None = None, is_error: bool = False) -> str:
    """Format Claude Code response for Telegram HTML"""
    # Header with status and timing
    if is_error:
        header = "❌ <b>error</b>"
    else:
        header = "✅ <b>done</b>"

    if execution_time is not None:
        if execution_time >= 60:
            minutes = int(execution_time // 60)
            seconds = int(execution_time % 60)
            header += f" · {minutes}m {seconds}s"
        else:
            header += f" · {execution_time:.1f}s"

    # Convert markdown in body to HTML
    body = markdown_to_html(text)

    # Combine header and body
    formatted = f"{header}\n\n{body}"

    return formatted


def split_message(text: str, max_length: int = MAX_MESSAGE_LENGTH) -> list[str]:
    """Split long messages into chunks that fit Telegram's limit"""
    if len(text) <= max_length:
        return [text]

    messages = []
    current_chunk = ""

    # Try to split on newlines first
    lines = text.split("\n")

    for line in lines:
        # If adding this line would exceed limit
        if len(current_chunk) + len(line) + 1 > max_length:
            if current_chunk:
                messages.append(current_chunk.rstrip())
            current_chunk = line + "\n"

            # If single line is too long, split it
            while len(current_chunk) > max_length:
                messages.append(current_chunk[:max_length])
                current_chunk = current_chunk[max_length:]
        else:
            current_chunk += line + "\n"

    if current_chunk.strip():
        messages.append(current_chunk.rstrip())

    return messages


def format_session_info(info: dict | None) -> str:
    """Format session info for /status command (HTML)"""
    if not info:
        return "No active session"

    return (
        f"📊 <b>Session Info</b>\n\n"
        f"Session ID: <code>{info['session_id'][:8]}...</code>\n"
        f"Created: {info['created_at'][:10]}\n"
        f"Last used: {info['last_used'][:16]}\n"
        f"Messages: {info['message_count']}"
    )
