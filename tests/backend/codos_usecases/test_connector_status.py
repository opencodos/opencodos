"""Tests for connector_status use-case."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from backend.codos_adapters.claude.mcp import McpServer, McpStatus
from backend.codos_models.connector import ConnectorStatus, ServiceStatus
from backend.codos_usecases.connector_status import (
    check_all_services,
    check_granola_status,
    check_mcp_service_status,
    check_service_status,
    check_telegram_status,
    get_telegram_session_path,
)


class TestGetTelegramSessionPath:
    def test_returns_string(self):
        result = get_telegram_session_path()
        assert isinstance(result, str)
        assert "session.string" in result


class TestCheckMcpServiceStatus:
    @pytest.mark.asyncio
    async def test_unknown_service_returns_error(self):
        result = await check_mcp_service_status("nonexistent")
        assert result.status == ConnectorStatus.ERROR
        assert "Not an MCP service" in result.error

    @pytest.mark.asyncio
    async def test_connected_server(self):
        servers = {
            "claude.ai Slack": McpServer(
                name="claude.ai Slack",
                url="https://mcp.slack.com/sse",
                status=McpStatus.CONNECTED,
            )
        }
        with patch(
            "backend.codos_usecases.connector_status.list_servers",
            new_callable=AsyncMock,
            return_value=servers,
        ):
            result = await check_mcp_service_status("slack")
        assert result.status == ConnectorStatus.CONNECTED
        assert result.account_id == "mcp-slack"

    @pytest.mark.asyncio
    async def test_server_not_in_list(self):
        with patch(
            "backend.codos_usecases.connector_status.list_servers",
            new_callable=AsyncMock,
            return_value={},
        ):
            result = await check_mcp_service_status("slack")
        assert result.status == ConnectorStatus.DISCONNECTED

    @pytest.mark.asyncio
    async def test_needs_auth_returns_disconnected(self):
        servers = {
            "claude.ai Gmail": McpServer(
                name="claude.ai Gmail",
                url="https://gmail.mcp.claude.com/mcp",
                status=McpStatus.NEEDS_AUTH,
            )
        }
        with patch(
            "backend.codos_usecases.connector_status.list_servers",
            new_callable=AsyncMock,
            return_value=servers,
        ):
            result = await check_mcp_service_status("gmail")
        assert result.status == ConnectorStatus.DISCONNECTED


class TestCheckGranolaStatus:
    @pytest.mark.asyncio
    async def test_connected_when_file_exists_with_content(self, tmp_path):
        token_file = tmp_path / "supabase.json"
        token_file.write_text('{"access_token": "abc123xyz"}')

        with patch(
            "backend.codos_usecases.connector_status.GRANOLA_TOKEN_PATH",
            str(token_file),
        ):
            result = await check_granola_status()
        assert result.status == ConnectorStatus.CONNECTED
        assert result.account_id == "granola-local"

    @pytest.mark.asyncio
    async def test_disconnected_when_file_missing(self, tmp_path):
        with patch(
            "backend.codos_usecases.connector_status.GRANOLA_TOKEN_PATH",
            str(tmp_path / "nonexistent.json"),
        ):
            result = await check_granola_status()
        assert result.status == ConnectorStatus.DISCONNECTED

    @pytest.mark.asyncio
    async def test_disconnected_when_file_too_short(self, tmp_path):
        token_file = tmp_path / "supabase.json"
        token_file.write_text("short")

        with patch(
            "backend.codos_usecases.connector_status.GRANOLA_TOKEN_PATH",
            str(token_file),
        ):
            result = await check_granola_status()
        assert result.status == ConnectorStatus.DISCONNECTED

    @pytest.mark.asyncio
    async def test_error_on_exception(self):
        with patch(
            "backend.codos_usecases.connector_status.os.path.exists",
            side_effect=PermissionError("denied"),
        ):
            result = await check_granola_status()
        assert result.status == ConnectorStatus.ERROR
        assert "denied" in result.error


class TestCheckTelegramStatus:
    @pytest.mark.asyncio
    async def test_connected_when_session_exists(self, tmp_path):
        session_file = tmp_path / "session.string"
        session_file.write_text("x" * 200)

        with patch(
            "backend.codos_usecases.connector_status.get_telegram_session_path",
            return_value=str(session_file),
        ):
            result = await check_telegram_status()
        assert result.status == ConnectorStatus.CONNECTED
        assert result.account_id == "telegram-session"

    @pytest.mark.asyncio
    async def test_disconnected_when_session_missing(self, tmp_path):
        with patch(
            "backend.codos_usecases.connector_status.get_telegram_session_path",
            return_value=str(tmp_path / "missing"),
        ):
            result = await check_telegram_status()
        assert result.status == ConnectorStatus.DISCONNECTED

    @pytest.mark.asyncio
    async def test_disconnected_when_session_too_small(self, tmp_path):
        session_file = tmp_path / "session.string"
        session_file.write_text("tiny")

        with patch(
            "backend.codos_usecases.connector_status.get_telegram_session_path",
            return_value=str(session_file),
        ):
            result = await check_telegram_status()
        assert result.status == ConnectorStatus.DISCONNECTED

    @pytest.mark.asyncio
    async def test_error_on_exception(self):
        with patch(
            "backend.codos_usecases.connector_status.get_telegram_session_path",
            side_effect=RuntimeError("boom"),
        ):
            result = await check_telegram_status()
        assert result.status == ConnectorStatus.ERROR
        assert "boom" in result.error


class TestCheckServiceStatus:
    @pytest.mark.asyncio
    async def test_routes_mcp_service(self):
        with patch(
            "backend.codos_usecases.connector_status.check_mcp_service_status",
            new_callable=AsyncMock,
            return_value=ServiceStatus(status=ConnectorStatus.CONNECTED),
        ) as mock:
            result = await check_service_status("slack")
        mock.assert_awaited_once_with("slack")
        assert result.status == ConnectorStatus.CONNECTED

    @pytest.mark.asyncio
    async def test_routes_granola(self):
        with patch(
            "backend.codos_usecases.connector_status.check_granola_status",
            new_callable=AsyncMock,
            return_value=ServiceStatus(status=ConnectorStatus.DISCONNECTED),
        ):
            result = await check_service_status("granola")
        assert result.status == ConnectorStatus.DISCONNECTED

    @pytest.mark.asyncio
    async def test_routes_telegram(self):
        with patch(
            "backend.codos_usecases.connector_status.check_telegram_status",
            new_callable=AsyncMock,
            return_value=ServiceStatus(status=ConnectorStatus.CONNECTED),
        ):
            result = await check_service_status("telegram")
        assert result.status == ConnectorStatus.CONNECTED

    @pytest.mark.asyncio
    async def test_unknown_service(self):
        result = await check_service_status("unknown_svc")
        assert result.status == ConnectorStatus.ERROR
        assert "Unknown service" in result.error


class TestCheckAllServices:
    @pytest.mark.asyncio
    async def test_returns_all_services(self):
        connected = ServiceStatus(status=ConnectorStatus.CONNECTED)
        with (
            patch(
                "backend.codos_usecases.connector_status.check_granola_status",
                new_callable=AsyncMock,
                return_value=connected,
            ),
            patch(
                "backend.codos_usecases.connector_status.check_telegram_status",
                new_callable=AsyncMock,
                return_value=connected,
            ),
            patch(
                "backend.codos_usecases.connector_status.check_mcp_service_status",
                new_callable=AsyncMock,
                return_value=connected,
            ),
        ):
            result = await check_all_services()

        assert "granola" in result
        assert "telegram" in result
        assert "slack" in result
        assert "notion" in result

    @pytest.mark.asyncio
    async def test_handles_exceptions_in_gather(self):
        err = RuntimeError("test error")
        ServiceStatus(status=ConnectorStatus.CONNECTED)

        with (
            patch(
                "backend.codos_usecases.connector_status.check_granola_status",
                new_callable=AsyncMock,
                side_effect=err,
            ),
            patch(
                "backend.codos_usecases.connector_status.check_telegram_status",
                new_callable=AsyncMock,
                side_effect=err,
            ),
            patch(
                "backend.codos_usecases.connector_status.check_mcp_service_status",
                new_callable=AsyncMock,
                side_effect=err,
            ),
        ):
            result = await check_all_services()

        assert result["granola"].status == ConnectorStatus.ERROR
        assert "test error" in result["granola"].error
        assert result["telegram"].status == ConnectorStatus.ERROR
        for svc in ("slack", "notion", "linear", "gmail", "googlecalendar"):
            assert result[svc].status == ConnectorStatus.ERROR
