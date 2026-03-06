#!/usr/bin/env python3
"""Generate QR code as image file for easier scanning."""

import asyncio
import sys
from pathlib import Path

import qrcode
from .src.config import load_config
from telethon import TelegramClient
from telethon.sessions import StringSession


async def main():
    config = load_config(require_anthropic=False)

    client = TelegramClient(
        StringSession(),
        config.telegram.api_id,
        config.telegram.api_hash,
    )
    await client.connect()

    qr_login = await client.qr_login()

    # Save QR as image
    img = qrcode.make(qr_login.url)
    qr_path = config.base_path / "login_qr.png"
    img.save(qr_path)
    print(f"QR code saved to: {qr_path}")
    print("Scan it with Telegram > Settings > Devices > Link Desktop Device")
    print("Waiting for scan...")

    try:
        await qr_login.wait(timeout=300)  # 5 min timeout

        session_string = client.session.save()
        session_path = config.base_path / "session.string"
        session_path.write_text(session_string)

        me = await client.get_me()
        print(f"\nLogged in as: {me.first_name} (@{me.username})")
        print(f"Session saved to: {session_path}")

    except TimeoutError:
        print("Timeout - please try again")
    finally:
        await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
