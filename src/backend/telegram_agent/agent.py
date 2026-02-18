#!/usr/bin/env python3
"""Telegram Agent - Main CLI entry point."""

import asyncio
import os
import sys
from pathlib import Path

from rich.console import Console

from .src.config import approve_pending, ignore_pending, load_config, save_selected_conversations

console = Console()

# Resolve config.yaml path: use ~/.codos/config/telegram/ (same as server.py)
_DATA_DIR = os.environ.get("ATLAS_DATA_DIR", str(Path.home() / ".codos"))
_TELEGRAM_DATA_DIR = Path(_DATA_DIR) / "config" / "telegram"
_CONFIG_PATH = str(_TELEGRAM_DATA_DIR / "config.yaml")
# Fall back to local config.yaml for dev mode (running from source tree)
_SOURCE_DIR = Path(__file__).parent
if not Path(_CONFIG_PATH).exists() and (_SOURCE_DIR / "config.yaml").exists():
    _CONFIG_PATH = str(_SOURCE_DIR / "config.yaml")

# Migrate session.string from source tree to ~/.codos if needed
_NEW_SESSION = _TELEGRAM_DATA_DIR / "session.string"
_OLD_SESSION = _SOURCE_DIR / "session.string"
if not _NEW_SESSION.exists() and _OLD_SESSION.exists():
    _TELEGRAM_DATA_DIR.mkdir(parents=True, exist_ok=True)
    import shutil
    shutil.copy2(str(_OLD_SESSION), str(_NEW_SESSION))
    console.print(f"[green]Migrated session from {_OLD_SESSION} → {_NEW_SESSION}[/green]")


async def cmd_login():
    """Handle login command."""
    from .src.telegram_client import TelegramClientWrapper

    config = load_config(config_path=_CONFIG_PATH, require_anthropic=False)
    client = TelegramClientWrapper(
        config.telegram.api_id,
        config.telegram.api_hash,
        config.base_path,
    )
    await client.login_with_qr()


async def cmd_select():
    """Handle select command - interactive conversation picker."""
    from .src.selector import run_selector
    from .src.telegram_client import TelegramClientWrapper

    config = load_config(config_path=_CONFIG_PATH, require_anthropic=False)

    telegram = TelegramClientWrapper(
        config.telegram.api_id,
        config.telegram.api_hash,
        config.base_path,
    )

    await telegram.connect()

    try:
        selected = await run_selector(telegram)

        if selected:
            save_selected_conversations(_CONFIG_PATH, selected)
            console.print(f"\n[green]Saved {len(selected)} conversations to config.yaml[/green]")
        else:
            console.print("\n[yellow]No conversations selected.[/yellow]")
    finally:
        await telegram.disconnect()


async def cmd_sync(notify_on_error: bool = True):
    """Handle sync command."""
    import fcntl

    from .src.obsidian import ObsidianWriter
    from .src.sync import SyncManager
    from .src.telegram_client import TelegramClientWrapper

    config = load_config(config_path=_CONFIG_PATH, require_anthropic=False)

    # Acquire Telegram session lock — prevents overlap with server wizard
    lock_path = Path.home() / ".codos" / ".telegram.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    lock_fd = open(lock_path, "w")
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        console.print("[yellow]Telegram session busy (wizard active), skipping sync[/yellow]")
        lock_fd.close()
        return {}

    # Write PID so other processes can find and kill us if needed
    lock_fd.write(str(os.getpid()))
    lock_fd.flush()

    telegram = None
    try:
        telegram = TelegramClientWrapper(
            config.telegram.api_id,
            config.telegram.api_hash,
            config.base_path,
        )
        obsidian = ObsidianWriter(config.obsidian.vault_path, config.obsidian.routing)

        await telegram.connect()

        sync_manager = SyncManager(telegram, obsidian, config)
        results = await sync_manager.sync()
        return results
    except Exception as e:
        error_msg = str(e)
        console.print(f"[red]{error_msg}[/red]")
        if notify_on_error:
            try:
                from .src.notify import notify_sync_failure

                notify_sync_failure(error_msg)
            except Exception:
                pass
        raise
    finally:
        if telegram:
            await telegram.disconnect()
        fcntl.flock(lock_fd, fcntl.LOCK_UN)
        lock_fd.close()


async def cmd_chat():
    """Handle chat command."""
    from .src.claude import run_chat_loop

    config = load_config(config_path=_CONFIG_PATH)
    await run_chat_loop(config)


async def cmd_list():
    """List whitelisted conversations."""
    config = load_config(config_path=_CONFIG_PATH, require_anthropic=False)

    whitelist = config.conversations.whitelist
    if not whitelist:
        console.print("[yellow]No conversations in whitelist. Run 'python agent.py select' first.[/yellow]")
        return

    console.print(f"\n[bold]Whitelisted Conversations ({len(whitelist)}):[/bold]\n")

    # Group by type
    by_type = {"private": [], "group": [], "channel": []}
    for conv in whitelist:
        conv_type = conv.get("type", "unknown")
        if conv_type in by_type:
            by_type[conv_type].append(conv)

    for conv_type, convs in by_type.items():
        if convs:
            console.print(f"[bold]{conv_type.upper()}S ({len(convs)}):[/bold]")
            for conv in convs:
                console.print(f"  - {conv['name']}")
            console.print()


async def cmd_discover():
    """Discover new chats and auto-add based on config."""
    from .src.obsidian import ObsidianWriter
    from .src.sync import SyncManager
    from .src.telegram_client import TelegramClientWrapper

    config = load_config(config_path=_CONFIG_PATH, require_anthropic=False)

    telegram = TelegramClientWrapper(
        config.telegram.api_id,
        config.telegram.api_hash,
        config.base_path,
    )
    obsidian = ObsidianWriter(config.obsidian.vault_path, config.obsidian.routing)

    await telegram.connect()

    try:
        sync_manager = SyncManager(telegram, obsidian, config)
        result = await sync_manager.discover_new_chats(_CONFIG_PATH)

        auto_added = result["auto_added"]
        pending = result["pending"]

        if auto_added:
            console.print(f"\n[green]Auto-added {len(auto_added)} new chats[/green]")
        if pending:
            console.print(f"[yellow]{len(pending)} chats pending approval[/yellow]")
            console.print("Run 'python agent.py pending' to see them")
    finally:
        await telegram.disconnect()


async def cmd_pending():
    """List conversations pending approval."""
    config = load_config(config_path=_CONFIG_PATH, require_anthropic=False)

    pending = config.conversations.pending
    if not pending:
        console.print("[green]No conversations pending approval.[/green]")
        return

    console.print(f"\n[bold]Pending Approval ({len(pending)}):[/bold]\n")
    for conv in pending:
        console.print(f"  [{conv['id']}] {conv['name']} ({conv['type']})")

    console.print("\n[dim]Use 'python agent.py approve <id>' or 'python agent.py ignore <id>'[/dim]")


def cmd_approve(conv_id: int):
    """Approve a pending conversation."""
    result = approve_pending(_CONFIG_PATH, conv_id)
    if result:
        console.print(f"[green]Approved:[/green] {result['name']}")
    else:
        console.print(f"[red]Conversation {conv_id} not found in pending list[/red]")


def cmd_ignore(conv_id: int):
    """Ignore a pending conversation."""
    result = ignore_pending(_CONFIG_PATH, conv_id)
    if result:
        console.print(f"[yellow]Ignored:[/yellow] {result['name']}")
    else:
        console.print(f"[red]Conversation {conv_id} not found in pending list[/red]")


def main():
    """Main entry point."""
    if len(sys.argv) < 2:
        console.print("[bold]Telegram Agent[/bold]")
        console.print("\nUsage:")
        console.print("  python agent.py login       - Login via QR code")
        console.print("  python agent.py select      - Select conversations to sync")
        console.print("  python agent.py sync        - Sync messages to Obsidian")
        console.print("  python agent.py discover    - Discover new chats (auto-add groups/DMs)")
        console.print("  python agent.py list        - List whitelisted conversations")
        console.print("  python agent.py pending     - List conversations pending approval")
        console.print("  python agent.py approve <id> - Approve a pending conversation")
        console.print("  python agent.py ignore <id>  - Ignore a pending conversation")
        console.print("  python agent.py chat        - Interactive chat mode")
        sys.exit(1)

    command = sys.argv[1].lower()

    try:
        if command == "login":
            asyncio.run(cmd_login())
        elif command == "select":
            asyncio.run(cmd_select())
        elif command == "sync":
            asyncio.run(cmd_sync())
        elif command == "discover":
            asyncio.run(cmd_discover())
        elif command == "chat":
            asyncio.run(cmd_chat())
        elif command == "list":
            asyncio.run(cmd_list())
        elif command == "pending":
            asyncio.run(cmd_pending())
        elif command == "approve":
            if len(sys.argv) < 3:
                console.print("[red]Usage: python agent.py approve <conversation_id>[/red]")
                sys.exit(1)
            cmd_approve(int(sys.argv[2]))
        elif command == "ignore":
            if len(sys.argv) < 3:
                console.print("[red]Usage: python agent.py ignore <conversation_id>[/red]")
                sys.exit(1)
            cmd_ignore(int(sys.argv[2]))
        else:
            console.print(f"[red]Unknown command: {command}[/red]")
            sys.exit(1)

    except FileNotFoundError as e:
        console.print(f"[red]{e}[/red]")
        sys.exit(1)
    except KeyboardInterrupt:
        console.print("\n[dim]Interrupted[/dim]")
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        raise


if __name__ == "__main__":
    main()
