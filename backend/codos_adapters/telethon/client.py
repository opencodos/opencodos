"""Typed wrappers for TelegramClient methods with incomplete stubs.

Telethon's type stubs are incomplete — ``connect()``, ``disconnect()``,
and ``start()`` are typed as returning coroutines at the class level but
pyright/mypy flag them.  Centralising the suppression here keeps every
call-site clean.
"""

from __future__ import annotations

from typing import Any

from telethon import TelegramClient


async def connect(client: TelegramClient) -> None:
    """Connect the client to Telegram."""
    await client.connect()  # type: ignore[misc,reportGeneralTypeIssues]


async def disconnect(client: TelegramClient) -> None:
    """Disconnect the client from Telegram."""
    await client.disconnect()  # type: ignore[misc,reportGeneralTypeIssues]


async def start(client: TelegramClient, **kwargs: Any) -> None:
    """Start the client (connect + authorize)."""
    await client.start(**kwargs)  # type: ignore[misc,reportGeneralTypeIssues]
