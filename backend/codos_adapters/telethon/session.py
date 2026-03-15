"""Thin helpers that work around Telethon's incomplete type stubs."""

from __future__ import annotations

from pathlib import Path

from telethon import TelegramClient


def save_session_string(client: TelegramClient) -> str:
    """Extract the session string from a connected client.

    Telethon's session typing is incomplete, so this centralises the
    single ``type: ignore`` instead of repeating it at every call-site.
    """
    session = client.session
    if not session:
        raise RuntimeError("No session available")
    return session.save()  # type: ignore[reportAttributeAccessIssue]


def save_session_to_file(client: TelegramClient, path: Path) -> None:
    """Save the client's session string to *path*."""
    path.write_text(save_session_string(client))
