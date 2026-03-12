#!/usr/bin/env python3
"""Phone number login for Telegram."""

import asyncio
import sys

from telethon import TelegramClient
from telethon.sessions.string import StringSession
from telethon.tl.types import User

from backend.codos_adapters.telethon import client as telethon_client
from backend.codos_adapters.telethon.session import save_session_to_file
from backend.codos_services.telegram_agent.src.config import load_config


async def main():
    if len(sys.argv) < 2:
        print("Usage: python login_phone.py +1234567890")
        sys.exit(1)

    phone = sys.argv[1]
    config = load_config(require_anthropic=False)

    client = TelegramClient(
        StringSession(),
        config.telegram.api_id,
        config.telegram.api_hash,
    )

    await telethon_client.connect(client)

    # Send code request
    await client.send_code_request(phone)
    print(f"Code sent to {phone}")
    print("CHECK_FOR_CODE")  # Marker for parsing

    # Wait for code input via file
    code_file = config.base_path / "login_code.txt"
    print(f"Waiting for code in {code_file}")

    # Poll for code file
    for _ in range(60):  # Wait up to 60 seconds
        if code_file.exists():
            code = code_file.read_text().strip()
            if code:
                code_file.unlink()  # Delete after reading
                break
        await asyncio.sleep(1)
    else:
        print("Timeout waiting for code")
        await telethon_client.disconnect(client)
        sys.exit(1)

    try:
        await client.sign_in(phone, code)
    except Exception as e:
        if "Two-steps verification" in str(e) or "password" in str(e).lower():
            print("2FA_REQUIRED")
            # Wait for password file
            password_file = config.base_path / "login_password.txt"
            for _ in range(60):
                if password_file.exists():
                    password = password_file.read_text().strip()
                    if password:
                        password_file.unlink()
                        break
                await asyncio.sleep(1)
            else:
                print("Timeout waiting for 2FA password")
                await telethon_client.disconnect(client)
                sys.exit(1)

            await client.sign_in(password=password)
        else:
            raise

    # Save session
    save_session_to_file(client, config.base_path / "session.string")

    me = await client.get_me()
    if isinstance(me, User):
        print(f"SUCCESS: Logged in as {me.first_name} (@{me.username})")

    await telethon_client.disconnect(client)


if __name__ == "__main__":
    asyncio.run(main())
