#!/usr/bin/env python3
"""
Codos Bot - Telegram interface for Claude Code

Process name marker for safe killing: CODOS_TG_BOT

Usage:
    python bot.py          # Run the bot
    python bot.py --test   # Test Claude Code invocation
"""

import asyncio
import base64
import io
import os
import subprocess
import sys
import time
from typing import Literal

# Voice transcription
import assemblyai as aai
from anthropic import AsyncAnthropic
from anthropic.types import Base64ImageSourceParam, ImageBlockParam, MessageParam, TextBlock, TextBlockParam
from loguru import logger
from telegram import Message, Update
from telegram.constants import ChatAction
from telegram.ext import (
    Application,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)
from telegram.request import HTTPXRequest

from backend.codos_services.codos_bot.config import (
    ANTHROPIC_API_KEY,
    ASSEMBLYAI_API_KEY,
    AUTHORIZED_USERS,
    BOT_TOKEN,
    CLAUDE_BIN,
    CLAUDE_MODEL,
    CLAUDE_TIMEOUT,
    WORKSPACE_DIR,
)
from backend.codos_services.codos_bot.formatter import format_response, format_session_info, split_message
from backend.codos_services.codos_bot.session_manager import SessionManager
from backend.codos_utils.log import configure_logging

if ASSEMBLYAI_API_KEY:
    aai.settings.api_key = ASSEMBLYAI_API_KEY

configure_logging("codos-bot", intercept_stdlib=False)

# Initialize session manager
session_manager = SessionManager()


def is_authorized(user_id: int) -> bool:
    """Check if user is authorized to use the bot"""
    if not AUTHORIZED_USERS:
        logger.warning("No authorized users configured! Rejecting all requests.")
        return False
    return user_id in AUTHORIZED_USERS


def _require_update_context(update: Update) -> tuple[int, int, Message]:
    """Extract and validate user_id, chat_id and message from an Update, raising if missing."""
    if not update.effective_user or not update.effective_chat or not update.message:
        raise ValueError("Missing user, chat, or message in update")
    return update.effective_user.id, update.effective_chat.id, update.message


# Tools allowed to run without interactive approval
ALLOWED_TOOLS = [
    # MCP runner script - enables Telegram, Slack, Gmail, Calendar, etc.
    f'Bash("{os.environ.get("CODOS_PATH", "")}/dev/Ops/mcp/run-mcp.sh":*)',
    # Skills
    "Skill(msg)",
    "Skill(brief)",
    "Skill(profile)",
    # File operations
    "Edit",
    "Write",
    "Read",
    "Glob",
    "Grep",
    # Agents
    "Task",
    # Safe bash commands
    "Bash(ls:*)",
    "Bash(cat:*)",
    "Bash(head:*)",
    "Bash(tail:*)",
    "Bash(wc:*)",
    "Bash(date:*)",
    "Bash(echo:*)",
    "Bash(bun run:*)",
]


async def run_claude(prompt: str, session_id: str, is_new_session: bool = False) -> tuple[str, float, bool]:
    """
    Run Claude Code with the given prompt and session ID.
    Returns (output, execution_time, is_error)
    """
    start_time = time.time()

    # Base command arguments
    # Using dangerously-skip-permissions to allow MCP commands (Telegram, Slack, etc.)
    base_args = [
        CLAUDE_BIN,
        "-p",
        prompt,
        "--model",
        CLAUDE_MODEL,
        "--dangerously-skip-permissions",
    ]

    # Use --resume for existing sessions, --session-id for new ones
    if is_new_session:
        cmd = base_args + ["--session-id", session_id]
    else:
        # Try to resume existing session
        cmd = base_args + ["--resume", session_id]

    logger.info(f"Running Claude Code with session {session_id[:8]}... (new={is_new_session})")

    try:
        env = os.environ.copy()
        home = os.environ.get("HOME", "")
        # Ensure homebrew node + bun are on PATH (don't use nvm — v22 causes CLI hangs)
        env["PATH"] = f"/opt/homebrew/bin:{home}/.bun/bin:{env.get('PATH', '')}"
        # Use subscription instead of API credits for Claude Code CLI
        # See: https://github.com/anthropics/claude-code/issues/3040
        env.pop("ANTHROPIC_API_KEY", None)
        # Prevent "cannot launch inside another Claude Code session" error
        env.pop("CLAUDECODE", None)

        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=WORKSPACE_DIR,
            env=env,
        )

        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=CLAUDE_TIMEOUT)
        except TimeoutError:
            process.kill()
            await process.wait()
            execution_time = time.time() - start_time
            return f"⏱️ Timeout after {CLAUDE_TIMEOUT}s", execution_time, True

        execution_time = time.time() - start_time
        stderr_text = stderr.decode("utf-8").strip()
        stdout_text = stdout.decode("utf-8").strip()

        # If resume failed because session doesn't exist, retry with new session
        if process.returncode != 0 and not is_new_session:
            if "not found" in stderr_text.lower() or "no conversation" in stderr_text.lower():
                logger.info("Session not found, creating new session...")
                return await run_claude(prompt, session_id, is_new_session=True)

        if process.returncode != 0:
            error_msg = stderr_text or "Unknown error"
            return f"Error: {error_msg}", execution_time, True

        return stdout_text, execution_time, False

    except Exception as e:
        execution_time = time.time() - start_time
        logger.exception("Error running Claude Code")
        return f"Exception: {str(e)}", execution_time, True


async def send_typing_periodically(chat_id: int, context: ContextTypes.DEFAULT_TYPE, stop_event: asyncio.Event):
    """Send typing indicator every 5 seconds until stopped"""
    while not stop_event.is_set():
        try:
            await context.bot.send_chat_action(chat_id=chat_id, action=ChatAction.TYPING)
        except Exception:
            pass
        await asyncio.sleep(5)


async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle incoming text messages"""
    user_id, chat_id, message = _require_update_context(update)
    message_text = message.text or ""

    # Authorization check
    if not is_authorized(user_id):
        logger.warning(f"Unauthorized access attempt from user {user_id}")
        await message.reply_text("⛔ Unauthorized")
        return

    logger.info(f"Message from {user_id}: {message_text[:50]}...")

    # Include reply-to context so Claude understands what the user is responding to
    reply = message.reply_to_message
    if reply and reply.text:
        message_text = f"[Replying to: {reply.text}]\n\n{message_text}"

    # Get session ID for this chat
    session_id = session_manager.get_session_id(chat_id)

    # Start typing indicator
    stop_typing = asyncio.Event()
    typing_task = asyncio.create_task(send_typing_periodically(chat_id, context, stop_typing))

    try:
        # Run Claude Code
        output, execution_time, is_error = await run_claude(message_text, session_id)

        # Format response
        formatted = format_response(output, execution_time, is_error)

        # Split if too long and send
        messages = split_message(formatted)
        for msg in messages:
            await message.reply_text(msg, parse_mode="HTML")

    finally:
        # Stop typing indicator
        stop_typing.set()
        typing_task.cancel()
        try:
            await typing_task
        except asyncio.CancelledError:
            pass


def transcribe_voice_sync(voice_bytes: bytes) -> str:
    """Transcribe voice message using AssemblyAI (synchronous)"""
    if not ASSEMBLYAI_API_KEY:
        return "[Voice transcription not configured]"

    try:
        config = aai.TranscriptionConfig(
            language_detection=True,  # Auto-detect language
            punctuate=True,
            format_text=True,
        )
        transcriber = aai.Transcriber()
        transcript = transcriber.transcribe(io.BytesIO(voice_bytes), config=config)

        if transcript.status == aai.TranscriptStatus.error:
            return f"[Transcription error: {transcript.error}]"

        return transcript.text or "[Could not transcribe audio]"
    except Exception as e:
        logger.exception("Voice transcription failed")
        return f"[Transcription failed: {str(e)}]"


ImageMediaType = Literal["image/jpeg", "image/png", "image/gif", "image/webp"]


async def analyze_image_async(image_bytes: bytes, media_type: ImageMediaType, user_prompt: str | None = None) -> str:
    """Analyze image using Claude Vision API."""
    if not ANTHROPIC_API_KEY:
        return "[Image analysis not configured - missing ANTHROPIC_API_KEY]"

    client = AsyncAnthropic(api_key=ANTHROPIC_API_KEY)

    base64_image = base64.b64encode(image_bytes).decode("utf-8")

    prompt = user_prompt or "Describe this image in detail. If there is any text visible, extract and include it."

    try:
        messages: list[MessageParam] = [
            {
                "role": "user",
                "content": [
                    ImageBlockParam(
                        type="image",
                        source=Base64ImageSourceParam(type="base64", media_type=media_type, data=base64_image),
                    ),
                    TextBlockParam(type="text", text=prompt),
                ],
            }
        ]
        message = await client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1024,
            messages=messages,
        )
        block = message.content[0]
        return block.text if isinstance(block, TextBlock) else str(block)
    except Exception as e:
        logger.exception("Image analysis failed")
        return f"[Image analysis failed: {str(e)}]"


async def handle_voice(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle incoming voice messages"""
    user_id, chat_id, message = _require_update_context(update)

    if not is_authorized(user_id):
        logger.warning(f"Unauthorized voice from user {user_id}")
        await message.reply_text("⛔ Unauthorized")
        return

    logger.info(f"Voice message from {user_id}")

    # Download voice file
    voice = message.voice
    if not voice:
        raise ValueError("Missing voice in message")
    voice_file = await voice.get_file()
    voice_bytes = await voice_file.download_as_bytearray()

    # Transcribe
    await message.reply_text("🎤 Transcribing...")
    loop = asyncio.get_event_loop()
    text = await loop.run_in_executor(None, transcribe_voice_sync, bytes(voice_bytes))

    if text.startswith("["):
        await message.reply_text(text)
        return

    logger.info(f"Transcribed: {text[:50]}...")

    # Get session and run Claude
    session_id = session_manager.get_session_id(chat_id)

    stop_typing = asyncio.Event()
    typing_task = asyncio.create_task(send_typing_periodically(chat_id, context, stop_typing))

    try:
        output, execution_time, is_error = await run_claude(text, session_id)
        formatted = format_response(output, execution_time, is_error)
        messages = split_message(formatted)
        for msg in messages:
            await message.reply_text(msg, parse_mode="HTML")
    finally:
        stop_typing.set()
        typing_task.cancel()
        try:
            await typing_task
        except asyncio.CancelledError:
            pass


async def handle_photo(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle incoming photo messages."""
    user_id, chat_id, message = _require_update_context(update)

    if not is_authorized(user_id):
        logger.warning(f"Unauthorized photo from user {user_id}")
        await message.reply_text("⛔ Unauthorized")
        return

    logger.info(f"Photo from {user_id}")

    # Download photo (get largest size)
    photo = message.photo[-1]
    photo_file = await photo.get_file()
    photo_bytes = await photo_file.download_as_bytearray()

    # Get caption if provided
    caption = message.caption or ""

    # Determine media type from file path
    file_path = photo_file.file_path or ""
    media_type: ImageMediaType
    if file_path.endswith(".png"):
        media_type = "image/png"
    elif file_path.endswith(".gif"):
        media_type = "image/gif"
    elif file_path.endswith(".webp"):
        media_type = "image/webp"
    else:
        media_type = "image/jpeg"  # Default

    # Analyze image
    await message.reply_text("🖼️ Analyzing image...")

    description = await analyze_image_async(bytes(photo_bytes), media_type)

    if description.startswith("["):
        await message.reply_text(description)
        return

    # Build prompt for Claude Code
    if caption:
        prompt = f"[Image description: {description}]\n\nUser message: {caption}"
    else:
        prompt = (
            f"I'm sharing an image with you.\n\n[Image description: {description}]\n\n"
            "Please acknowledge what you see and ask if I need anything specific done with it."
        )

    # Get session and run Claude Code
    session_id = session_manager.get_session_id(chat_id)

    stop_typing = asyncio.Event()
    typing_task = asyncio.create_task(send_typing_periodically(chat_id, context, stop_typing))

    try:
        output, execution_time, is_error = await run_claude(prompt, session_id)
        formatted = format_response(output, execution_time, is_error)
        messages = split_message(formatted)
        for msg in messages:
            await message.reply_text(msg, parse_mode="HTML")
    finally:
        stop_typing.set()
        typing_task.cancel()
        try:
            await typing_task
        except asyncio.CancelledError:
            pass


async def handle_document(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle document/file messages"""
    user_id, chat_id, message = _require_update_context(update)

    if not is_authorized(user_id):
        await message.reply_text("⛔ Unauthorized")
        return

    document = message.document
    if not document:
        raise ValueError("Missing document in message")
    file_name = document.file_name or "unknown"
    file_size = document.file_size or 0
    mime_type = document.mime_type or ""

    logger.info(f"Document from {user_id}: {file_name} ({mime_type}, {file_size} bytes)")

    # Size limit: 10MB
    if file_size > 10 * 1024 * 1024:
        await message.reply_text("⚠️ File too large (max 10MB)")
        return

    # Download file
    doc_file = await document.get_file()
    file_bytes = await doc_file.download_as_bytearray()

    # Get caption if provided
    caption = message.caption or ""

    # Determine how to handle based on mime type
    is_text = mime_type.startswith("text/") or file_name.endswith(
        (".txt", ".md", ".json", ".yaml", ".yml", ".csv", ".py", ".js", ".ts", ".sh", ".html", ".css", ".xml", ".log")
    )

    if is_text:
        try:
            content = bytes(file_bytes).decode("utf-8")
            # Truncate if too long
            if len(content) > 10000:
                content = content[:10000] + "\n\n[... truncated, showing first 10k chars ...]"
            prompt = f"User shared a file: {file_name}\n\nFile contents:\n```\n{content}\n```"
            if caption:
                prompt += f"\n\nUser message: {caption}"
        except UnicodeDecodeError:
            await message.reply_text(f"⚠️ Could not read {file_name} as text")
            return
    else:
        # Binary file - just describe it
        prompt = f"User shared a file: {file_name} ({mime_type}, {file_size} bytes)"
        if caption:
            prompt += f"\n\nUser message: {caption}"
        else:
            prompt += "\n\nThis is a binary file. Ask the user what they'd like to do with it."

    # Get session and run Claude Code
    session_id = session_manager.get_session_id(chat_id)

    stop_typing = asyncio.Event()
    typing_task = asyncio.create_task(send_typing_periodically(chat_id, context, stop_typing))

    try:
        output, execution_time, is_error = await run_claude(prompt, session_id)
        formatted = format_response(output, execution_time, is_error)
        messages = split_message(formatted)
        for msg in messages:
            await message.reply_text(msg, parse_mode="HTML")
    finally:
        stop_typing.set()
        typing_task.cancel()
        try:
            await typing_task
        except asyncio.CancelledError:
            pass


async def cmd_new(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle /new command - start a fresh session"""
    user_id, chat_id, message = _require_update_context(update)

    if not is_authorized(user_id):
        await message.reply_text("⛔ Unauthorized")
        return

    new_session_id = session_manager.reset_session(chat_id)
    await message.reply_text(f"🆕 New session started\nSession ID: `{new_session_id[:8]}...`", parse_mode="HTML")


async def cmd_status(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle /status command - show session info"""
    user_id, chat_id, message = _require_update_context(update)

    if not is_authorized(user_id):
        await message.reply_text("⛔ Unauthorized")
        return

    info = session_manager.get_session_info(chat_id)
    await message.reply_text(format_session_info(info), parse_mode="HTML")


async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle /start command"""
    if not update.effective_user or not update.message:
        raise ValueError("Missing user or message in update")
    user_id = update.effective_user.id

    if not is_authorized(user_id):
        await update.message.reply_text(
            f"⛔ Unauthorized\n\nYour user ID: <code>{user_id}</code>\n"
            "Add this to AUTHORIZED_USER_IDS in the secrets backend",
            parse_mode="HTML",
        )
        return

    await update.message.reply_text(
        "👋 <b>Codos Bot</b>\n\n"
        "Send any message to interact with Claude Code.\n\n"
        "<b>Commands:</b>\n"
        "/new - Start fresh session\n"
        "/status - Show session info\n"
        "/help - Show this message",
        parse_mode="HTML",
    )


async def cmd_help(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle /help command"""
    await cmd_start(update, context)


def test_claude():
    """Test Claude Code invocation"""
    print("Testing Claude Code invocation...")
    print(f"Workspace: {WORKSPACE_DIR}")

    result = subprocess.run(
        [CLAUDE_BIN, "-p", "Say 'Hello from Codos Bot!' in one line", "--model", CLAUDE_MODEL],
        capture_output=True,
        text=True,
        cwd=WORKSPACE_DIR,
        timeout=60,
    )

    print(f"Return code: {result.returncode}")
    print(f"Stdout: {result.stdout[:500]}")
    if result.stderr:
        print(f"Stderr: {result.stderr[:500]}")


def main():
    """Run the bot"""
    if "--test" in sys.argv:
        test_claude()
        return

    if not BOT_TOKEN:
        print("ERROR: TELEGRAM_BOT_TOKEN not set in secrets backend")
        sys.exit(1)

    if not AUTHORIZED_USERS:
        print("WARNING: No AUTHORIZED_USER_IDS set in secrets backend")
        print("The bot will reject all messages until configured.")

    logger.info("Starting Codos Bot...")
    logger.info(f"Workspace: {WORKSPACE_DIR}")
    logger.info(f"Authorized users: {AUTHORIZED_USERS}")

    # Create application with extended timeouts for slow networks
    request = HTTPXRequest(
        connect_timeout=30.0,
        read_timeout=30.0,
        write_timeout=30.0,
        pool_timeout=30.0,
    )
    app = Application.builder().token(BOT_TOKEN).request(request).build()

    # Error handler — log errors and exit on repeated polling failures so launchd restarts us
    _consecutive_errors = 0

    async def error_handler(update: object, context: ContextTypes.DEFAULT_TYPE) -> None:
        nonlocal _consecutive_errors
        logger.error(f"Exception while handling update: {context.error}")
        if "Conflict" in str(context.error):
            logger.critical("Polling conflict detected — another instance may be running. Exiting.")
            os._exit(1)
        _consecutive_errors += 1
        if _consecutive_errors >= 10:
            logger.critical(f"{_consecutive_errors} consecutive errors — exiting for launchd restart")
            os._exit(1)

    # Add handlers
    app.add_error_handler(error_handler)
    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("help", cmd_help))
    app.add_handler(CommandHandler("new", cmd_new))
    app.add_handler(CommandHandler("clear", cmd_new))  # Alias
    app.add_handler(CommandHandler("status", cmd_status))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))
    app.add_handler(MessageHandler(filters.VOICE, handle_voice))
    app.add_handler(MessageHandler(filters.PHOTO, handle_photo))
    app.add_handler(MessageHandler(filters.Document.ALL, handle_document))

    # Run
    logger.info("Bot is running. Press Ctrl+C to stop.")
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
