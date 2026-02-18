"""
Service status checker using Composio REST API.
Fast, reliable status checks without spawning CLI processes.
"""

import asyncio
import os
from dataclasses import dataclass

import httpx
from .pipedream_client import (
    SERVICE_TO_APP_SLUG,
    PipedreamClient,
    get_account_id,
    get_pipedream_config,
)
from .settings import settings

# Granola token path
GRANOLA_TOKEN_PATH = os.path.expanduser("~/Library/Application Support/Granola/supabase.json")


def get_telegram_session_path() -> str:
    """Get Telegram session path used by the running Telegram agent."""
    return str(settings.get_telegram_data_dir() / "session.string")


# Services managed by Pipedream Connect
PIPEDREAM_SERVICES = [
    "slack",
    "gmail",
    "googlecalendar",
    "linear",
    "github",
    "googledocs",
    "googledrive",
    "notion",
]


@dataclass
class ServiceStatus:
    connected: bool
    status: str
    account_id: str | None = None
    error: str | None = None


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


async def check_notion_status() -> ServiceStatus:
    """Check Notion status by validating the API key via direct Notion API call."""
    notion_token = settings.notion_api_key or ""
    if not notion_token:
        return ServiceStatus(connected=False, status="not_configured", error="NOTION_API_KEY not set")

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                "https://api.notion.com/v1/users/me",
                headers={
                    "Authorization": f"Bearer {notion_token}",
                    "Notion-Version": "2022-06-28",
                },
            )

            if response.status_code == 200:
                data = response.json()
                account_id = data.get("id", "notion-api")
                return ServiceStatus(
                    connected=True,
                    status="connected",
                    account_id=account_id,
                )
            elif response.status_code == 401:
                return ServiceStatus(connected=False, status="invalid_token", error="Invalid Notion API token")
            else:
                return ServiceStatus(connected=False, status="error", error=f"Notion API error: {response.status_code}")

    except httpx.TimeoutException:
        return ServiceStatus(connected=False, status="timeout", error="Notion API timeout")
    except Exception as e:
        return ServiceStatus(connected=False, status="error", error=str(e))


async def check_pipedream_service(service: str) -> ServiceStatus:
    config = get_pipedream_config()
    if not config:
        return ServiceStatus(
            connected=False,
            status="not_configured",
            error="Pipedream credentials not configured",
        )

    account_id = get_account_id(service)
    if not account_id:
        return ServiceStatus(
            connected=False,
            status="not_configured",
            error="Pipedream account ID not set",
        )

    app_slug = SERVICE_TO_APP_SLUG.get(service)
    if not app_slug:
        return ServiceStatus(
            connected=False,
            status="unknown",
            error="Unsupported service",
        )

    try:
        client = PipedreamClient(config)
        accounts = await client.list_accounts(app_slug)
        match = next((a for a in accounts if a.get("id") == account_id), None)
        if not match:
            return ServiceStatus(
                connected=False,
                status="not_connected",
                error="Account ID not found",
            )
        healthy = match.get("healthy", True)
        return ServiceStatus(
            connected=bool(healthy),
            status="connected" if healthy else "unhealthy",
            account_id=account_id,
            error=None if healthy else "Account unhealthy",
        )
    except Exception as e:
        return ServiceStatus(
            connected=False,
            status="error",
            error=str(e),
        )


async def check_pipedream_services() -> dict[str, ServiceStatus]:
    results: dict[str, ServiceStatus] = {}
    tasks = [check_pipedream_service(service) for service in PIPEDREAM_SERVICES]
    responses = await asyncio.gather(*tasks, return_exceptions=True)
    for service, response in zip(PIPEDREAM_SERVICES, responses, strict=False):
        if isinstance(response, Exception):
            results[service] = ServiceStatus(
                connected=False,
                status="error",
                error=str(response),
            )
        else:
            results[service] = response
    return results


async def check_service_status(service: str) -> ServiceStatus:
    """Check status for any service, routing to the appropriate checker."""
    if service == "granola":
        return await check_granola_status()
    elif service == "telegram":
        return await check_telegram_status()
    elif service == "notion":
        if get_account_id("notion") and get_pipedream_config():
            return await check_pipedream_service("notion")
        return await check_notion_status()
    elif service in PIPEDREAM_SERVICES:
        return await check_pipedream_service(service)
    else:
        return ServiceStatus(connected=False, status="unknown", error=f"Unknown service: {service}")


async def check_all_services() -> dict[str, ServiceStatus]:
    """Check status for all known services in parallel."""
    pipedream_task = check_pipedream_services()
    granola_task = check_granola_status()
    telegram_task = check_telegram_status()
    notion_task = (
        check_pipedream_service("notion")
        if (get_account_id("notion") and get_pipedream_config())
        else check_notion_status()
    )

    # Run all checks in parallel
    pipedream_statuses, granola_status, telegram_status, notion_status = await asyncio.gather(
        pipedream_task,
        granola_task,
        telegram_task,
        notion_task,
        return_exceptions=True,
    )

    # Build result map
    status_map = {}

    # Add Pipedream services
    if isinstance(pipedream_statuses, Exception):
        for service in PIPEDREAM_SERVICES:
            status_map[service] = ServiceStatus(
                connected=False,
                status="error",
                error=str(pipedream_statuses),
            )
    else:
        status_map.update(pipedream_statuses)

    # Add Granola
    if isinstance(granola_status, Exception):
        status_map["granola"] = ServiceStatus(
            connected=False,
            status="error",
            error=str(granola_status),
        )
    else:
        status_map["granola"] = granola_status

    # Add Telegram
    if isinstance(telegram_status, Exception):
        status_map["telegram"] = ServiceStatus(
            connected=False,
            status="error",
            error=str(telegram_status),
        )
    else:
        status_map["telegram"] = telegram_status

    # Add Notion (direct API, not Composio)
    if isinstance(notion_status, Exception):
        status_map["notion"] = ServiceStatus(
            connected=False,
            status="error",
            error=str(notion_status),
        )
    else:
        status_map["notion"] = notion_status

    return status_map
