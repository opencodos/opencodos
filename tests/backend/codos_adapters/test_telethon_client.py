"""Tests for telethon client wrappers."""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from backend.codos_adapters.telethon.client import connect, disconnect, start


@pytest.fixture
def mock_client():
    client = AsyncMock()
    client.connect = AsyncMock()
    client.disconnect = AsyncMock()
    client.start = AsyncMock()
    return client


class TestConnect:
    @pytest.mark.asyncio
    async def test_calls_client_connect(self, mock_client):
        await connect(mock_client)
        mock_client.connect.assert_awaited_once()


class TestDisconnect:
    @pytest.mark.asyncio
    async def test_calls_client_disconnect(self, mock_client):
        await disconnect(mock_client)
        mock_client.disconnect.assert_awaited_once()


class TestStart:
    @pytest.mark.asyncio
    async def test_calls_client_start_with_kwargs(self, mock_client):
        await start(mock_client, bot_token="test-token")
        mock_client.start.assert_awaited_once_with(bot_token="test-token")
