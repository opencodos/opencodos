"""Connector models and MCP service mapping."""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel


class ConnectorStatus(StrEnum):
    CONNECTED = "connected"
    DISCONNECTED = "disconnected"
    ERROR = "error"


class ServiceStatus(BaseModel):
    status: ConnectorStatus
    account_id: str | None = None
    error: str | None = None


# Codos service name -> MCP server name in `claude mcp list`
MCP_SERVICES: dict[str, str] = {
    "slack": "claude.ai Slack",
    "notion": "claude.ai Notion",
    "linear": "claude.ai Linear",
    "gmail": "claude.ai Gmail",
    "googlecalendar": "claude.ai Google Calendar",
}
