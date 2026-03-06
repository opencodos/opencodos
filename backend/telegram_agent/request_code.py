#!/usr/bin/env python3
"""Step 1: Request code."""

import asyncio
import os
import sys
from pathlib import Path

from .src.config import load_config
from telethon import TelegramClient
from telethon.sessions import StringSession


async def main():
    phone = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("TELEGRAM_PHONE", "")
    if not phone:
        print("Usage: python -m telegram_agent.request_code <phone>\n  Or set TELEGRAM_PHONE env var")
        sys.exit(1)
    config = load_config(require_anthropic=False)

    client = TelegramClient(
        StringSession(),
        config.telegram.api_id,
        config.telegram.api_hash,
    )
    await client.connect()

    result = await client.send_code_request(phone)

    # Save phone_code_hash for next step
    hash_file = config.base_path / "phone_code_hash.txt"
    hash_file.write_text(f"{result.phone_code_hash}")

    print(f"Code sent to {phone}")
    print("phone_code_hash saved")

    await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
