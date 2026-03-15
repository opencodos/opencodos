#!/usr/bin/env python3
"""Fast login - request code and poll for response quickly."""

import asyncio
import os
import sys

from telethon import TelegramClient
from telethon.sessions.string import StringSession
from telethon.tl.types import User

from backend.codos_adapters.telethon import client as telethon_client
from backend.codos_adapters.telethon.session import save_session_to_file
from backend.codos_services.telegram_agent.src.config import load_config


async def main():
    phone = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("TELEGRAM_PHONE", "")
    if not phone:
        print("Usage: python -m telegram_agent.fast_login <phone>\n  Or set TELEGRAM_PHONE env var")
        sys.exit(1)
    config = load_config(require_anthropic=False)

    client = TelegramClient(
        StringSession(),
        config.telegram.api_id,
        config.telegram.api_hash,
    )
    await telethon_client.connect(client)

    # Request code
    result = await client.send_code_request(phone)
    print(f"CODE_SENT to {phone}")
    print("Write code to login_code.txt")
    sys.stdout.flush()

    # Poll for code file very quickly
    code_file = config.base_path / "login_code.txt"
    code_file.unlink(missing_ok=True)  # Clear any old code

    code = None
    for _ in range(120):  # 60 seconds with 0.5s intervals
        if code_file.exists():
            code = code_file.read_text().strip()
            if code and len(code) >= 5:
                code_file.unlink()
                print(f"Got code: {code}")
                break
        await asyncio.sleep(0.5)

    if not code:
        print("TIMEOUT waiting for code")
        await telethon_client.disconnect(client)
        sys.exit(1)

    # Sign in
    try:
        await client.sign_in(phone=phone, code=code, phone_code_hash=result.phone_code_hash)
        print("SIGN_IN_SUCCESS")
    except Exception as e:
        err_str = str(e).lower()
        if "two-steps" in err_str or "password" in err_str or "2fa" in err_str:
            print("2FA_REQUIRED - write password to login_password.txt")
            sys.stdout.flush()

            password_file = config.base_path / "login_password.txt"
            password_file.unlink(missing_ok=True)

            password = None
            for _ in range(120):
                if password_file.exists():
                    password = password_file.read_text().strip()
                    if password:
                        password_file.unlink()
                        break
                await asyncio.sleep(0.5)

            if not password:
                print("TIMEOUT waiting for 2FA password")
                await telethon_client.disconnect(client)
                sys.exit(1)

            await client.sign_in(password=password)
            print("2FA_SUCCESS")
        else:
            print(f"ERROR: {e}")
            await telethon_client.disconnect(client)
            sys.exit(1)

    # Save session
    save_session_to_file(client, config.base_path / "session.string")

    me = await client.get_me()
    if isinstance(me, User):
        print(f"LOGGED_IN: {me.first_name} (@{me.username})")

    await telethon_client.disconnect(client)


if __name__ == "__main__":
    asyncio.run(main())
