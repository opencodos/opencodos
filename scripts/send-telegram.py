#!/usr/bin/env python3
"""Send a Telegram message (and optional file) via Telethon + StringSession.

Usage:
    python3 send-telegram.py --chat "My Group Chat" --message "hey"
    python3 send-telegram.py --chat "My Group Chat" --message "here's the doc" --file /path/to/file.pdf
    python3 send-telegram.py --chat-id 123456789 --message "hey"
"""

import argparse
import asyncio
import sys
from pathlib import Path

# Allow importing backend.codos_models.settings from scripts/
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from telethon import TelegramClient
from telethon.sessions import StringSession

from backend.codos_models.settings import settings

SESSION_PATH = Path.home() / ".codos" / "config" / "telegram" / "session.string"


def load_config():
    api_id = int(settings.telegram_api_id)
    api_hash = settings.telegram_api_hash
    session_string = SESSION_PATH.read_text().strip()
    if not session_string:
        print("ERROR: Session string is empty", file=sys.stderr)
        sys.exit(1)
    return api_id, api_hash, session_string


async def resolve_chat(client, chat_name):
    """Find a dialog by name (case-insensitive substring match)."""
    chat_name_lower = chat_name.lower()
    async for dialog in client.iter_dialogs():
        if dialog.name and chat_name_lower in dialog.name.lower():
            return dialog
    return None


async def send(args):
    api_id, api_hash, session_string = load_config()

    client = TelegramClient(StringSession(session_string), api_id, api_hash)
    await client.connect()

    if not await client.is_user_authorized():
        print("ERROR: Session is not authorized. Re-authenticate.", file=sys.stderr)
        await client.disconnect()
        sys.exit(1)

    # Resolve target chat
    target = None
    if args.chat_id:
        target = args.chat_id
    elif args.chat:
        dialog = await resolve_chat(client, args.chat)
        if not dialog:
            print(f"ERROR: No chat found matching '{args.chat}'", file=sys.stderr)
            await client.disconnect()
            sys.exit(1)
        target = dialog.entity
        print(f"Resolved chat: {dialog.name} (id={dialog.id})")
    else:
        print("ERROR: Provide --chat or --chat-id", file=sys.stderr)
        await client.disconnect()
        sys.exit(1)

    # Send
    if args.file:
        file_path = Path(args.file)
        if not file_path.exists():
            print(f"ERROR: File not found: {args.file}", file=sys.stderr)
            await client.disconnect()
            sys.exit(1)
        msg = await client.send_file(target, file_path, caption=args.message or "")
    else:
        if not args.message:
            print("ERROR: --message is required when not sending a file", file=sys.stderr)
            await client.disconnect()
            sys.exit(1)
        msg = await client.send_message(target, args.message)

    print(f"Sent. Message ID: {msg.id}")
    await client.disconnect()


def main():
    parser = argparse.ArgumentParser(description="Send Telegram message via Telethon")
    parser.add_argument("--chat", help="Chat name (substring match against dialogs)")
    parser.add_argument("--chat-id", type=int, help="Chat ID (numeric)")
    parser.add_argument("--message", "-m", help="Message text (or caption for files)")
    parser.add_argument("--file", "-f", help="Path to file to send")
    args = parser.parse_args()

    if not args.chat and not args.chat_id:
        parser.error("Provide --chat or --chat-id")

    asyncio.run(send(args))


if __name__ == "__main__":
    main()
