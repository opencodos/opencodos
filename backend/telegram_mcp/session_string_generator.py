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
    - python-dotenv

Note on ID Formats:
When using the MCP server, please be aware that all `chat_id` and `user_id`
parameters support integer IDs, string representations of IDs (e.g., "123456"),
and usernames (e.g., "@mychannel").
"""

import os
import sys

from dotenv import load_dotenv
from telethon.sessions import StringSession
from telethon.sync import TelegramClient

# Load environment variables from .env file
load_dotenv()


def main() -> None:
    from backend.connector.settings import settings

    API_ID = int(settings.telegram_api_id)
    API_HASH = settings.telegram_api_hash

    print("\n----- Telegram Session String Generator -----\n")
    print("This script will generate a session string for your Telegram account.")
    print("You will be asked to enter your phone number and the verification code sent to your Telegram app.")
    print("The generated session string can be added to your .env file.")
    print("\nYour credentials will NOT be stored on any server and are only used for local authentication.\n")

    try:
        # Connect to Telegram and generate the session string
        with TelegramClient(StringSession(), API_ID, API_HASH) as client:
            # The client.session.save() function from StringSession returns the session string
            session_string = StringSession.save(client.session)

            print("\nAuthentication successful!")
            print("\n----- Your Session String -----")
            print(f"\n{session_string}\n")
            print("Add this to your .env file as:")
            print(f"TELEGRAM_SESSION_STRING={session_string}")
            print("\nIMPORTANT: Keep this string private and never share it with anyone!")

            # Optional: auto-update the .env file
            choice = input("\nWould you like to automatically update your .env file with this session string? (y/N): ")
            if choice.lower() == "y":
                try:
                    # Read the current .env file
                    with open(".env") as file:
                        env_contents = file.readlines()

                    # Update or add the SESSION_STRING line
                    session_string_line_found = False
                    for i, line in enumerate(env_contents):
                        if line.startswith("TELEGRAM_SESSION_STRING="):
                            env_contents[i] = f"TELEGRAM_SESSION_STRING={session_string}\n"
                            session_string_line_found = True
                            break

                    if not session_string_line_found:
                        env_contents.append(f"TELEGRAM_SESSION_STRING={session_string}\n")

                    # Write back to the .env file
                    with open(".env", "w") as file:
                        file.writelines(env_contents)

                    print("\n.env file updated successfully!")
                except Exception as e:
                    print(f"\nError updating .env file: {e}")
                    print("Please manually add the session string to your .env file.")

    except Exception as e:
        print(f"\nError: {e}")
        print("Failed to generate session string. Please try again.")
        sys.exit(1)


if __name__ == "__main__":
    main()
