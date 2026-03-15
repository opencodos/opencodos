#!/usr/bin/env python3
"""
Telegram Session String Generator

This script generates a session string that can be used for Telegram authentication
with the Telegram MCP server. The session string allows for portable authentication
without storing session files.

Usage:
    python session_string_generator.py

Requirements:
    - telethon

Note on ID Formats:
When using the MCP server, please be aware that all `chat_id` and `user_id`
parameters support integer IDs, string representations of IDs (e.g., "123456"),
and usernames (e.g., "@mychannel").
"""

import sys

from telethon.sessions.string import StringSession
from telethon.sync import TelegramClient


def main() -> None:
    from backend.codos_models.settings import settings

    API_ID = int(settings.telegram_api_id)
    API_HASH = settings.telegram_api_hash

    print("\n----- Telegram Session String Generator -----\n")
    print("This script will generate a session string for your Telegram account.")
    print("You will be asked to enter your phone number and the verification code sent to your Telegram app.")
    print("The generated session string will be saved to the secrets backend.")
    print("\nYour credentials will NOT be stored on any server and are only used for local authentication.\n")

    try:
        # Connect to Telegram and generate the session string
        with TelegramClient(StringSession(), API_ID, API_HASH) as client:
            # The client.session.save() function from StringSession returns the session string
            session_string = StringSession.save(client.session)

            print("\nAuthentication successful!")
            print("\n----- Your Session String -----")
            print(f"\n{session_string}\n")
            print("\nIMPORTANT: Keep this string private and never share it with anyone!")

            # Save to secrets backend
            choice = input("\nWould you like to save this session string to the secrets backend? (y/N): ")
            if choice.lower() == "y":
                try:
                    from backend.codos_utils.secrets import get_secrets_backend

                    get_secrets_backend().set("TELEGRAM_SESSION_STRING", session_string)
                    print("\nSession string saved to secrets backend!")
                except Exception as e:
                    print(f"\nError saving session string: {e}")
                    print("You can save it manually with:")
                    print(f"  python -m backend secrets set TELEGRAM_SESSION_STRING {session_string}")

    except Exception as e:
        print(f"\nError: {e}")
        print("Failed to generate session string. Please try again.")
        sys.exit(1)


if __name__ == "__main__":
    main()
