#!/usr/bin/env python3
"""Simple phone login - pass phone and code as args."""

import asyncio
import sys

from telethon import TelegramClient
from telethon.sessions.string import StringSession
from telethon.tl.types import User

from backend.codos_adapters.telethon import client as telethon_client
from backend.codos_adapters.telethon.session import save_session_to_file
from backend.codos_services.telegram_agent.src.config import load_config


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

    await telethon_client.start(
        client,
        phone=phone,
        code_callback=lambda: code,
        password=lambda: password if password else input("2FA password: "),
    )

    # Save session
    save_session_to_file(client, config.base_path / "session.string")

    me = await client.get_me()
    if isinstance(me, User):
        print(f"Logged in as: {me.first_name} (@{me.username})")
    print(f"Session saved to: {config.base_path / 'session.string'}")

    await telethon_client.disconnect(client)


if __name__ == "__main__":
    asyncio.run(main())
