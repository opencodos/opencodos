#!/usr/bin/env python3
"""Unified entry point for Codos Bot.

Subcommands:
    server  — Start the Telegram bot (used by Tauri)
    test    — Test Claude Code invocation
"""

import sys


def main():
    if len(sys.argv) < 2:
        # Default: run the bot server
        command = "server"
    else:
        command = sys.argv[1].lower()

    if command == "server":
        from .bot import main as bot_main

        bot_main()
    elif command == "test":
        from .bot import test_claude

        test_claude()
    else:
        print(f"Unknown command: {command}")
        print("Usage: codos-bot [server|test]")
        sys.exit(1)


if __name__ == "__main__":
    main()
