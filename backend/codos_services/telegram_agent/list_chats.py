#!/usr/bin/env python3
"""List top conversations for selection."""

import asyncio
import json
import sys

from backend.codos_services.telegram_agent.src.config import load_config
from backend.codos_services.telegram_agent.src.telegram_client import TelegramClientWrapper


async def main():
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 50

    config = load_config(require_anthropic=False)
    telegram = TelegramClientWrapper(
        config.telegram.api_id,
        config.telegram.api_hash,
        config.base_path,
    )

    await telegram.connect()

    try:
        conversations = await telegram.get_conversations(limit=limit)

        print(f"\n=== TOP {limit} CONVERSATIONS ===\n")

        # Group by type
        private = [c for c in conversations if c.type == "private"]
        groups = [c for c in conversations if c.type == "group"]
        channels = [c for c in conversations if c.type == "channel"]

        print(f"PRIVATE CHATS ({len(private)}):")
        for i, c in enumerate(private[:20], 1):
            print(f"  {i}. {c.name}")
        if len(private) > 20:
            print(f"  ... and {len(private) - 20} more")

        print(f"\nGROUPS ({len(groups)}):")
        for i, c in enumerate(groups[:20], 1):
            print(f"  {i}. {c.name}")
        if len(groups) > 20:
            print(f"  ... and {len(groups) - 20} more")

        print(f"\nCHANNELS ({len(channels)}):")
        for i, c in enumerate(channels[:10], 1):
            print(f"  {i}. {c.name}")
        if len(channels) > 10:
            print(f"  ... and {len(channels) - 10} more")

        # Save full list to JSON for reference
        output_file = config.base_path / "conversations_list.json"
        data = [{"id": c.id, "name": c.name, "type": c.type} for c in conversations]
        output_file.write_text(json.dumps(data, indent=2, ensure_ascii=False))
        print(f"\nFull list saved to: {output_file}")

    finally:
        await telegram.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
