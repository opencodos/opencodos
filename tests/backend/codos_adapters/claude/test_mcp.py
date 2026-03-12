from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from backend.codos_adapters.claude.mcp import (
    McpServer,
    McpStatus,
    _parse_mcp_list_output,
    invalidate_cache,
    list_servers,
)

SAMPLE_OUTPUT = """\
Checking MCP server statuses...

claude.ai Notion: https://mcp.notion.com/mcp - ✓ Connected
claude.ai Gmail: https://gmail.mcp.claude.com/mcp - ! Needs authentication
claude.ai Slack: https://mcp.slack.com/sse - ✓ Connected
"""


class TestParseMcpListOutput:
    def test_parses_connected_servers(self):
        result = _parse_mcp_list_output(SAMPLE_OUTPUT)
        assert "claude.ai Notion" in result
        assert result["claude.ai Notion"].status == McpStatus.CONNECTED
        assert result["claude.ai Notion"].url == "https://mcp.notion.com/mcp"

    def test_parses_needs_auth(self):
        result = _parse_mcp_list_output(SAMPLE_OUTPUT)
        gmail = result["claude.ai Gmail"]
        assert gmail.status == McpStatus.NEEDS_AUTH
        assert gmail.url == "https://gmail.mcp.claude.com/mcp"

    def test_returns_all_servers(self):
        result = _parse_mcp_list_output(SAMPLE_OUTPUT)
        assert len(result) == 3

    def test_empty_output(self):
        assert _parse_mcp_list_output("") == {}

    def test_skips_checking_line(self):
        assert _parse_mcp_list_output("Checking MCP server statuses...\n") == {}

    def test_skips_malformed_lines(self):
        assert _parse_mcp_list_output("some random text\n") == {}


class TestInvalidateCache:
    def test_invalidate(self):
        import backend.codos_adapters.claude.mcp as mod

        mod._list_cache = ({"fake": McpServer("fake", "http://x", McpStatus.CONNECTED)}, 0.0)
        invalidate_cache()
        assert mod._list_cache is None


class TestListServers:
    @pytest.fixture(autouse=True)
    def _clear_cache(self):
        invalidate_cache()
        yield
        invalidate_cache()

    @pytest.mark.asyncio
    async def test_returns_parsed_servers(self):
        with patch(
            "backend.codos_adapters.claude.mcp._run",
            new_callable=AsyncMock,
            return_value=(0, SAMPLE_OUTPUT),
        ):
            result = await list_servers()
        assert len(result) == 3
        assert "claude.ai Slack" in result

    @pytest.mark.asyncio
    async def test_caches_result(self):
        mock_run = AsyncMock(return_value=(0, SAMPLE_OUTPUT))
        with patch("backend.codos_adapters.claude.mcp._run", mock_run):
            first = await list_servers()
            second = await list_servers()
        assert first is second
        mock_run.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_returns_empty_on_file_not_found(self):
        with patch(
            "backend.codos_adapters.claude.mcp._run",
            side_effect=FileNotFoundError("claude not found"),
        ):
            result = await list_servers()
        assert result == {}

    @pytest.mark.asyncio
    async def test_returns_empty_on_timeout(self):
        with patch(
            "backend.codos_adapters.claude.mcp._run",
            side_effect=TimeoutError,
        ):
            result = await list_servers()
        assert result == {}


class TestMcpServer:
    def test_frozen(self):
        server = McpServer(name="test", url="http://x", status=McpStatus.CONNECTED)
        with pytest.raises(AttributeError):
            server.name = "other"
