#!/usr/bin/env python3
"""Simple phone login - pass phone and code as args."""

import asyncio
import sys
from pathlib import Path

from .src.config import load_config
from telethon import TelegramClient
from telethon.sessions import StringSession


async def main():
    if len(sys.argv) < 3:
        print("Usage: python login_simple.py PHONE CODE [2FA_PASSWORD]")
        sys.exit(1)

    phone = sys.argv[1]
    code = sys.argv[2]
    password = sys.argv[3] if len(sys.argv) > 3 else None

    config = load_config(require_anthropic=False)

    client = TelegramClient(
        StringSession(),
        config.telegram.api_id,
        config.telegram.api_hash,
    )

    await client.start(
        phone=phone, code_callback=lambda: code, password=lambda: password if password else input("2FA password: ")
    )

    # Save session
    session_string = client.session.save()
    session_path = config.base_path / "session.string"
    session_path.write_text(session_string)

    me = await client.get_me()
    print(f"Logged in as: {me.first_name} (@{me.username})")
    print(f"Session saved to: {session_path}")

    await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
