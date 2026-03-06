#!/usr/bin/env python3
"""Migrate existing Telegram files to type-based subfolders and update archived status."""

import asyncio
import re
import shutil
import sys
from pathlib import Path

import yaml
from rich.console import Console
from .src.config import load_config
from .src.telegram_client import TelegramClientWrapper

console = Console()


def sanitize_filename(name: str) -> str:
    """Convert conversation name to safe filename."""
    safe = re.sub(r'[<>:"/\\|?*]', "", name)
    return safe.strip() or "unnamed"


async def main():
    config = load_config(require_anthropic=False)

    # Connect to Telegram to get archived status
    telegram = TelegramClientWrapper(
        config.telegram.api_id,
        config.telegram.api_hash,
        config.base_path,
    )
    await telegram.connect()

    try:
        console.print("[bold]Fetching conversation archived status from Telegram...[/bold]")

        # Get all conversations with archived status
        conversations = await telegram.get_conversations(limit=500)
        conv_map = {conv.id: conv for conv in conversations}

        # Load current config
        with open("config.yaml") as f:
            raw_config = yaml.safe_load(f)

        selected = raw_config.get("conversations", {}).get("selected", [])
        vault_path = Path(config.obsidian.vault_path)

        updated_count = 0
        moved_count = 0

        # Update archived status and prepare file moves
        for conv_info in selected:
            conv_id = conv_info["id"]
            conv = conv_map.get(conv_id)

            if conv:
                # Update archived status
                old_archived = conv_info.get("archived", False)
                new_archived = conv.archived

                if old_archived != new_archived:
                    conv_info["archived"] = new_archived
                    updated_count += 1
                    console.print(f"  Updated: {conv.name} archived={new_archived}")
                elif "archived" not in conv_info:
                    conv_info["archived"] = new_archived
                    updated_count += 1
            else:
                # Conversation not found, default to not archived
                if "archived" not in conv_info:
                    conv_info["archived"] = False
                    updated_count += 1

        # Save updated config
        with open("config.yaml", "w") as f:
            yaml.dump(raw_config, f, default_flow_style=False, allow_unicode=True, sort_keys=False)

        console.print(f"\n[green]Updated {updated_count} conversation(s) with archived status[/green]")

        # Now migrate existing files
        routing = config.obsidian.routing
        if not routing:
            console.print("[yellow]No routing rules configured, skipping file migration[/yellow]")
            return

        console.print("\n[bold]Migrating files to subfolders...[/bold]")

        # Create target folders
        for folder in ["DMs", "Groups", "Channels", "Archived/DMs", "Archived/Groups", "Archived/Channels"]:
            (vault_path / folder).mkdir(parents=True, exist_ok=True)

        # Move files
        for conv_info in selected:
            name = conv_info["name"]
            conv_type = conv_info.get("type", "private")
            archived = conv_info.get("archived", False)

            filename = sanitize_filename(name) + ".md"
            old_path = vault_path / filename

            # Determine new subfolder
            subfolder = routing.get_subfolder(conv_type, archived)
            new_path = vault_path / subfolder / filename

            if old_path.exists() and not new_path.exists():
                shutil.move(str(old_path), str(new_path))
                moved_count += 1
                console.print(f"  Moved: {filename} -> {subfolder}/")
            elif old_path.exists() and new_path.exists():
                console.print(f"  [yellow]Skipped (both exist): {filename}[/yellow]")

        console.print(f"\n[green]Migration complete: {moved_count} file(s) moved[/green]")

    finally:
        await telegram.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
