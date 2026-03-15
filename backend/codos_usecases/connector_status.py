"""Check connector status."""

from __future__ import annotations

import asyncio
import os

from backend.codos_adapters.claude.mcp import McpStatus, list_servers
from backend.codos_models.connector import MCP_SERVICES, ConnectorStatus, ServiceStatus
from backend.codos_models.settings import settings

GRANOLA_TOKEN_PATH = os.path.expanduser("~/Library/Application Support/Granola/supabase.json")


def get_telegram_session_path() -> str:
    return str(settings.get_telegram_session_path())


async def check_mcp_service_status(service: str) -> ServiceStatus:
    mcp_name = MCP_SERVICES.get(service)
    if mcp_name is None:
        return ServiceStatus(status=ConnectorStatus.ERROR, error=f"Not an MCP service: {service}")

    servers = await list_servers()

    if mcp_name not in servers:
        return ServiceStatus(status=ConnectorStatus.DISCONNECTED)

    server = servers[mcp_name]
    if server.status == McpStatus.CONNECTED:
        return ServiceStatus(status=ConnectorStatus.CONNECTED, account_id=f"mcp-{service}")

    return ServiceStatus(status=ConnectorStatus.DISCONNECTED)


async def check_granola_status() -> ServiceStatus:
    try:
        if os.path.exists(GRANOLA_TOKEN_PATH):
            with open(GRANOLA_TOKEN_PATH) as f:
                content = f.read().strip()
                if content and len(content) > 10:
                    return ServiceStatus(status=ConnectorStatus.CONNECTED, account_id="granola-local")
        return ServiceStatus(status=ConnectorStatus.DISCONNECTED)
    except Exception as e:
        return ServiceStatus(status=ConnectorStatus.ERROR, error=str(e))


async def check_telegram_status() -> ServiceStatus:
    try:
        session_path = get_telegram_session_path()
        if os.path.exists(session_path):
            file_size = os.path.getsize(session_path)
            if file_size > 100:
                return ServiceStatus(status=ConnectorStatus.CONNECTED, account_id="telegram-session")
        return ServiceStatus(status=ConnectorStatus.DISCONNECTED)
    except Exception as e:
        return ServiceStatus(status=ConnectorStatus.ERROR, error=str(e))


async def check_service_status(service: str) -> ServiceStatus:
    if service in MCP_SERVICES:
        return await check_mcp_service_status(service)
    if service == "granola":
        return await check_granola_status()
    if service == "telegram":
        return await check_telegram_status()
    return ServiceStatus(status=ConnectorStatus.ERROR, error=f"Unknown service: {service}")


async def check_all_services() -> dict[str, ServiceStatus]:
    granola_status, telegram_status, *mcp_statuses = await asyncio.gather(
        check_granola_status(),
        check_telegram_status(),
        *[check_mcp_service_status(svc) for svc in MCP_SERVICES],
        return_exceptions=True,
    )

    error_status = ServiceStatus(status=ConnectorStatus.ERROR)
    status_map: dict[str, ServiceStatus] = {}

    for svc, mcp_status in zip(MCP_SERVICES, mcp_statuses, strict=False):
        if isinstance(mcp_status, BaseException):
            status_map[svc] = error_status.model_copy(update={"error": str(mcp_status)})
        else:
            status_map[svc] = mcp_status

    if isinstance(granola_status, BaseException):
        status_map["granola"] = error_status.model_copy(update={"error": str(granola_status)})
    else:
        status_map["granola"] = granola_status

    if isinstance(telegram_status, BaseException):
        status_map["telegram"] = error_status.model_copy(update={"error": str(telegram_status)})
    else:
        status_map["telegram"] = telegram_status

    return status_map
