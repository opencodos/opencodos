#!/usr/bin/env python3
"""Unified entry point for Telegram Agent.

Subcommands:
    server  — Start the FastAPI server (used by Tauri)
    sync    — Run message sync to Obsidian
    login   — Login via QR code
    select  — Interactive conversation picker
    discover — Discover new chats
    list    — List whitelisted conversations
    pending — List conversations pending approval
    approve <id> — Approve a pending conversation
    ignore  <id> — Ignore a pending conversation
    chat    — Interactive Claude chat mode
"""

import sys


def main():
    if len(sys.argv) < 2:
        print("Usage: telegram-agent <command>")
        print("Commands: server, sync, login, select, discover, list, pending, approve, ignore, chat")
        sys.exit(1)

    command = sys.argv[1].lower()

    if command == "server":
        import os

        from backend.codos_utils.log import configure_logging

        configure_logging("telegram-agent", log_file="/tmp/codos-telegram.log")

        import uvicorn
        from .server import app

        bind_host = os.getenv("TELEGRAM_AGENT_HOST", "127.0.0.1")
        bind_port = int(os.getenv("TELEGRAM_AGENT_PORT", "8768"))
        uvicorn.run(app, host=bind_host, port=bind_port, log_config=None)
    else:
        # Delegate all other commands to agent.py's main()
        # Shift argv so agent.py sees ["agent.py", command, ...]
        from .agent import main as agent_main

        agent_main()


if __name__ == "__main__":
    main()
