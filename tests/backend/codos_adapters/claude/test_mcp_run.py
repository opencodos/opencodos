"""Tests for the _run helper in mcp.py (lines 35-47)."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from backend.codos_adapters.claude.mcp import _run


class TestRun:
    @pytest.mark.asyncio
    async def test_raises_when_claude_not_found(self):
        with patch("backend.codos_adapters.claude.mcp.find_claude", return_value=None):
            with pytest.raises(FileNotFoundError, match="claude CLI not found"):
                await _run(["mcp", "list"])

    @pytest.mark.asyncio
    async def test_returns_stdout_and_returncode(self):
        mock_proc = AsyncMock()
        mock_proc.communicate.return_value = (b"hello\n", b"")
        mock_proc.returncode = 0

        with (
            patch("backend.codos_adapters.claude.mcp.find_claude", return_value="/usr/bin/claude"),
            patch("asyncio.create_subprocess_exec", return_value=mock_proc) as mock_exec,
        ):
            code, output = await _run(["mcp", "list"])

        assert code == 0
        assert output == "hello\n"
        mock_exec.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_none_returncode_becomes_zero(self):
        mock_proc = AsyncMock()
        mock_proc.communicate.return_value = (b"", b"")
        mock_proc.returncode = None

        with (
            patch("backend.codos_adapters.claude.mcp.find_claude", return_value="/usr/bin/claude"),
            patch("asyncio.create_subprocess_exec", return_value=mock_proc),
        ):
            code, output = await _run(["arg"])

        assert code == 0
