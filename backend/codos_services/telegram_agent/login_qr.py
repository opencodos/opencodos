#!/usr/bin/env python3
"""Generate QR code as image file for easier scanning."""

import asyncio

import qrcode
from telethon import TelegramClient
from telethon.sessions.string import StringSession
from telethon.tl.types import User

from backend.codos_adapters.telethon import client as telethon_client
from backend.codos_adapters.telethon.session import save_session_to_file
from backend.codos_services.telegram_agent.src.config import load_config


async def main():
    config = load_config(require_anthropic=False)

    client = TelegramClient(
        StringSession(),
        config.telegram.api_id,
        config.telegram.api_hash,
    )
    await telethon_client.connect(client)

    qr_login = await client.qr_login()

    # Save QR as image
    img = qrcode.make(qr_login.url)
    qr_path = config.base_path / "login_qr.png"
    with open(qr_path, "wb") as f:
        img.save(f)
    print(f"QR code saved to: {qr_path}")
    print("Scan it with Telegram > Settings > Devices > Link Desktop Device")
    print("Waiting for scan...")

    try:
        await qr_login.wait(timeout=300)  # 5 min timeout

        save_session_to_file(client, config.base_path / "session.string")

        me = await client.get_me()
        if isinstance(me, User):
            print(f"\nLogged in as: {me.first_name} (@{me.username})")
        print(f"Session saved to: {config.base_path / 'session.string'}")

    except TimeoutError:
        print("Timeout - please try again")
    finally:
        await telethon_client.disconnect(client)


if __name__ == "__main__":
    asyncio.run(main())
