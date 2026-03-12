#!/usr/bin/env python3
"""Check if we can detect archived chats."""

import asyncio
from pathlib import Path

from telethon import TelegramClient
from telethon.sessions.string import StringSession

from backend.codos_adapters.telethon import client as telethon_client
from backend.codos_services.telegram_agent.src.config import load_config


async def main():
    config = load_config(require_anthropic=False)

    client = TelegramClient(
        StringSession(Path(config.base_path / "session.string").read_text().strip()),
        config.telegram.api_id,
        config.telegram.api_hash,
    )
    await telethon_client.connect(client)

    print("Checking dialog properties...\n")

    count = 0
    async for dialog in client.iter_dialogs(limit=20):
        archived = dialog.archived
        folder_id = dialog.folder_id
        print(
            f"{dialog.name[:30]:30} | "
            f"type={('private' if dialog.is_user else 'group' if dialog.is_group else 'channel'):8} | "
            f"archived={archived} | folder_id={folder_id}"
        )
        count += 1

    # Also check archived folder specifically
    print("\n--- ARCHIVED CHATS ---")
    async for dialog in client.iter_dialogs(folder=1, limit=10):  # folder=1 is Archive
        print(
            f"{dialog.name[:30]:30} | "
            f"type={('private' if dialog.is_user else 'group' if dialog.is_group else 'channel'):8}"
        )

    await telethon_client.disconnect(client)


if __name__ == "__main__":
    asyncio.run(main())
