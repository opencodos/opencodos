"""Legacy Pipedream client — env var helpers only.

Pipedream Connect has been removed. All services now use claude.ai MCP Connectors
or direct integrations. This module is kept for env var utility functions
that are still used during disconnect cleanup.
"""

from __future__ import annotations

from .settings import settings

ENV_PATH = settings.get_env_file_path()

# All Pipedream services have been removed
SERVICE_TO_APP_SLUG: dict[str, str] = {}
SERVICE_TO_ACCOUNT_ENV: dict[str, str] = {}


def _read_env_lines() -> list[str]:
    if not ENV_PATH.exists():
        return []
    try:
        return ENV_PATH.read_text().splitlines()
    except Exception:
        return []


def _get_env_var(name: str) -> str:
    """Read a variable from the .env file on disk (not os.environ).

    Used for Pipedream account IDs which are written to the .env file
    by set_env_var() and may not yet be in os.environ.
    """
    for raw_line in _read_env_lines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key == name:
            return value
    return ""


def set_env_var(name: str, value: str) -> None:
    lines = _read_env_lines()
    updated = False
    for idx, raw_line in enumerate(lines):
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _ = line.split("=", 1)
        if key == name:
            lines[idx] = f"{name}={value}"
            updated = True
            break
    if not updated:
        lines.append(f"{name}={value}")
    ENV_PATH.parent.mkdir(parents=True, exist_ok=True)
    ENV_PATH.write_text("\n".join(lines) + "\n")


def remove_env_var(name: str) -> None:
    lines = _read_env_lines()
    new_lines = []
    for raw_line in lines:
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            new_lines.append(raw_line)
            continue
        key, _ = line.split("=", 1)
        if key == name:
            continue
        new_lines.append(raw_line)
    ENV_PATH.parent.mkdir(parents=True, exist_ok=True)
    ENV_PATH.write_text("\n".join(new_lines) + "\n")


def get_account_env_key(service: str) -> str | None:
    return SERVICE_TO_ACCOUNT_ENV.get(service)


def get_account_id(service: str) -> str | None:
    key = get_account_env_key(service)
    if not key:
        return None
    value = _get_env_var(key)
    return value or None


def set_account_id(service: str, account_id: str) -> None:
    key = get_account_env_key(service)
    if not key:
        raise ValueError(f"Unknown service for Pipedream account env: {service}")
    set_env_var(key, account_id)


def clear_account_id(service: str) -> None:
    key = get_account_env_key(service)
    if not key:
        return
    remove_env_var(key)


def get_pipedream_config():
    """DEPRECATED: Always returns None. Pipedream has been removed."""
    return None
