#!/usr/bin/env python3
"""Step 2: Complete login with code."""

import asyncio
import sys

from telethon import TelegramClient
from telethon.sessions.string import StringSession
from telethon.tl.types import User

from backend.codos_adapters.telethon import client as telethon_client
from backend.codos_adapters.telethon.session import save_session_to_file
from backend.codos_services.telegram_agent.src.config import load_config


async def main():
    phone = sys.argv[1]
    code = sys.argv[2]
    password = sys.argv[3] if len(sys.argv) > 3 else None

    config = load_config(require_anthropic=False)

    # Load phone_code_hash
    hash_file = config.base_path / "phone_code_hash.txt"
    phone_code_hash = hash_file.read_text().strip()

    client = TelegramClient(
        StringSession(),
        config.telegram.api_id,
        config.telegram.api_hash,
    )
    await telethon_client.connect(client)

    try:
        await client.sign_in(phone=phone, code=code, phone_code_hash=phone_code_hash)
    except Exception as e:
        if "Two-steps verification" in str(e) or "password" in str(e).lower():
            if password:
                await client.sign_in(password=password)
            else:
                print("2FA_REQUIRED")
                await telethon_client.disconnect(client)
                sys.exit(2)
        else:
            raise

    # Save session
    save_session_to_file(client, config.base_path / "session.string")

    me = await client.get_me()
    if isinstance(me, User):
        print(f"Logged in as: {me.first_name} (@{me.username})")
    print("Session saved!")

    await telethon_client.disconnect(client)


if __name__ == "__main__":
    asyncio.run(main())
