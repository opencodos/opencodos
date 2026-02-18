#!/usr/bin/env python3
"""Step 2: Complete login with code."""

import asyncio
import sys
from pathlib import Path

from .src.config import load_config
from telethon import TelegramClient
from telethon.sessions import StringSession


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
    await client.connect()

    try:
        await client.sign_in(phone=phone, code=code, phone_code_hash=phone_code_hash)
    except Exception as e:
        if "Two-steps verification" in str(e) or "password" in str(e).lower():
            if password:
                await client.sign_in(password=password)
            else:
                print("2FA_REQUIRED")
                await client.disconnect()
                sys.exit(2)
        else:
            raise

    # Save session
    session_string = client.session.save()
    session_path = config.base_path / "session.string"
    session_path.write_text(session_string)

    me = await client.get_me()
    print(f"Logged in as: {me.first_name} (@{me.username})")
    print("Session saved!")

    await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
