"""
Service status checker for MCP connectors.
Fast, reliable status checks without spawning CLI processes.
"""

import asyncio
import os

from dataclasses import dataclass

from .settings import settings

# Granola token path
GRANOLA_TOKEN_PATH = os.path.expanduser("~/Library/Application Support/Granola/supabase.json")


def get_telegram_session_path() -> str:
    """Get Telegram session path used by the running Telegram agent."""
    return str(settings.get_telegram_data_dir() / "session.string")


@dataclass
class ServiceStatus:
    connected: bool
    status: str
    account_id: str | None = None
    error: str | None = None
    is_verified: bool = True


async def check_granola_status() -> ServiceStatus:
    """Check if Granola is connected by verifying token exists."""
    try:
        if os.path.exists(GRANOLA_TOKEN_PATH):
            # Read and verify the token file has content
            with open(GRANOLA_TOKEN_PATH) as f:
                content = f.read().strip()
                if content and len(content) > 10:
                    return ServiceStatus(
                        connected=True,
                        status="connected",
                        account_id="granola-local",
                    )
        return ServiceStatus(connected=False, status="disconnected")
    except Exception as e:
        return ServiceStatus(connected=False, status="error", error=str(e))


async def check_telegram_status() -> ServiceStatus:
    """Check Telegram status by verifying session file exists."""
    try:
        session_path = get_telegram_session_path()
        if os.path.exists(session_path):
            # Check if session file has content (session.string is ~300-400 bytes)
            file_size = os.path.getsize(session_path)
            if file_size > 100:  # Valid session string is ~300-400 bytes
                return ServiceStatus(
                    connected=True,
                    status="connected",
                    account_id="telegram-session",
                )
        return ServiceStatus(connected=False, status="disconnected")
    except Exception as e:
        return ServiceStatus(connected=False, status="error", error=str(e))


# Services managed via claude.ai connectors — cannot detect programmatically.
# These are cloud-side MCP integrations configured at claude.ai/settings/connectors.
# `claude mcp list` only shows local servers, so we report disconnected by default.
CLAUDE_AI_MCP_SERVICES = ("slack", "notion", "linear", "gmail", "googlecalendar", "googledrive", "google")


async def check_service_status(service: str) -> ServiceStatus:
    """Check status for any service, routing to the appropriate checker."""
    if service == "granola":
        return await check_granola_status()
    elif service == "telegram":
        return await check_telegram_status()
    elif service in CLAUDE_AI_MCP_SERVICES:
        return ServiceStatus(
            connected=False,
            status=f"Connect {service.capitalize()} at claude.ai/settings/integrations",
            is_verified=False,
        )
    else:
        return ServiceStatus(connected=False, status="unknown", error=f"Unknown service: {service}")


async def check_all_services() -> dict[str, ServiceStatus]:
    """Check status for all known services in parallel."""
    granola_status, telegram_status = await asyncio.gather(
        check_granola_status(), check_telegram_status(),
        return_exceptions=True,
    )

    status_map: dict[str, ServiceStatus] = {}

    # claude.ai MCP services — can't detect, report unverified
    for svc in CLAUDE_AI_MCP_SERVICES:
        status_map[svc] = ServiceStatus(
            connected=False,
            status=f"Connect {svc.capitalize()} at claude.ai/settings/integrations",
            is_verified=False,
        )

    # Granola
    if isinstance(granola_status, Exception):
        status_map["granola"] = ServiceStatus(connected=False, status="error", error=str(granola_status))
    else:
        status_map["granola"] = granola_status

    # Telegram
    if isinstance(telegram_status, Exception):
        status_map["telegram"] = ServiceStatus(connected=False, status="error", error=str(telegram_status))
    else:
        status_map["telegram"] = telegram_status

    return status_map
