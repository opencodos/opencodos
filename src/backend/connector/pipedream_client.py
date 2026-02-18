from __future__ import annotations

import asyncio
import base64
import uuid
from dataclasses import dataclass
from pathlib import Path

import httpx
from .settings import settings

ENV_PATH = settings.get_env_file_path()

PIPEDREAM_API_BASE = "https://api.pipedream.com"

SERVICE_TO_APP_SLUG: dict[str, str] = {
    "slack": "slack_v2",
    "gmail": "gmail",
    "googlecalendar": "google_calendar",
    "github": "github",
    "linear": "linear",
    "notion": "notion",
    "googledocs": "google_docs",
    "googledrive": "google_drive",
}

SERVICE_TO_ACCOUNT_ENV: dict[str, str] = {
    "slack": "PIPEDREAM_ACCOUNT_ID_SLACK",
    "gmail": "PIPEDREAM_ACCOUNT_ID_GMAIL",
    "googlecalendar": "PIPEDREAM_ACCOUNT_ID_GOOGLECALENDAR",
    "github": "PIPEDREAM_ACCOUNT_ID_GITHUB",
    "linear": "PIPEDREAM_ACCOUNT_ID_LINEAR",
    "notion": "PIPEDREAM_ACCOUNT_ID_NOTION",
    "googledocs": "PIPEDREAM_ACCOUNT_ID_GOOGLEDOCS",
    "googledrive": "PIPEDREAM_ACCOUNT_ID_GOOGLEDRIVE",
}


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


def ensure_external_user_id() -> str | None:
    existing = settings.pipedream_external_user_id or _get_env_var("PIPEDREAM_EXTERNAL_USER_ID")
    if existing:
        return existing
    new_id = str(uuid.uuid4())
    try:
        set_env_var("PIPEDREAM_EXTERNAL_USER_ID", new_id)
        return new_id
    except Exception:
        return None


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


@dataclass
class PipedreamConfig:
    project_id: str
    client_id: str
    client_secret: str
    environment: str
    external_user_id: str


def get_pipedream_config() -> PipedreamConfig | None:
    project_id = settings.pipedream_project_id or _get_env_var("PIPEDREAM_PROJECT_ID")
    client_id = settings.pipedream_client_id or _get_env_var("PIPEDREAM_CLIENT_ID")
    client_secret = settings.pipedream_client_secret or _get_env_var("PIPEDREAM_CLIENT_SECRET")
    environment = settings.pipedream_env or _get_env_var("PIPEDREAM_PROJECT_ENVIRONMENT") or "production"
    external_user_id = ensure_external_user_id() or _get_env_var("PIPEDREAM_EXTERNAL_USER_ID")

    if not project_id or not client_id or not client_secret or not external_user_id:
        return None

    return PipedreamConfig(
        project_id=project_id,
        client_id=client_id,
        client_secret=client_secret,
        environment=environment,
        external_user_id=external_user_id,
    )


def _base64url_encode(value: str) -> str:
    return base64.urlsafe_b64encode(value.encode()).decode().rstrip("=")


def _append_params(url: str, params: dict[str, str] | None) -> str:
    if not params:
        return url
    from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

    parsed = urlparse(url)
    existing = parse_qs(parsed.query)
    for key, value in params.items():
        existing[key] = [value]
    new_query = urlencode(existing, doseq=True)
    return urlunparse(parsed._replace(query=new_query))


class PipedreamClient:
    def __init__(self, config: PipedreamConfig):
        self._config = config
        self._token: str | None = None
        self._expires_at: float = 0.0
        self._lock = asyncio.Lock()

    async def _get_token(self) -> str:
        now = asyncio.get_event_loop().time()
        if self._token and self._expires_at > now:
            return self._token

        async with self._lock:
            if self._token and self._expires_at > now:
                return self._token

            async with httpx.AsyncClient(timeout=20.0) as client:
                response = await client.post(
                    f"{PIPEDREAM_API_BASE}/v1/oauth/token",
                    json={
                        "client_id": self._config.client_id,
                        "client_secret": self._config.client_secret,
                        "grant_type": "client_credentials",
                        "scope": "*",
                    },
                    headers={
                        "content-type": "application/json",
                        "x-pd-environment": self._config.environment,
                    },
                )
                response.raise_for_status()
                data = response.json()
                token = data.get("access_token")
                expires_in = float(data.get("expires_in", 0))
                if not token:
                    raise RuntimeError("Pipedream token response missing access_token")
                # 2-minute buffer
                self._token = token
                self._expires_at = now + max(expires_in - 120, 0)
                return token

    async def create_connect_token(self) -> dict:
        token = await self._get_token()
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(
                f"{PIPEDREAM_API_BASE}/v1/connect/{self._config.project_id}/tokens",
                json={"external_user_id": self._config.external_user_id},
                headers={
                    "content-type": "application/json",
                    "authorization": f"Bearer {token}",
                    "x-pd-environment": self._config.environment,
                },
            )
            response.raise_for_status()
            return response.json()

    async def list_accounts(self, app_slug: str) -> list[dict]:
        token = await self._get_token()
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.get(
                f"{PIPEDREAM_API_BASE}/v1/connect/{self._config.project_id}/accounts",
                params={
                    "external_user_id": self._config.external_user_id,
                    "app": app_slug,
                },
                headers={
                    "authorization": f"Bearer {token}",
                    "x-pd-environment": self._config.environment,
                },
            )
            response.raise_for_status()
            data = response.json()
            return data.get("data", [])

    async def delete_account(self, account_id: str) -> None:
        token = await self._get_token()
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.delete(
                f"{PIPEDREAM_API_BASE}/v1/connect/{self._config.project_id}/accounts/{account_id}",
                headers={
                    "authorization": f"Bearer {token}",
                    "x-pd-environment": self._config.environment,
                },
            )
            response.raise_for_status()

    async def proxy_request(
        self,
        method: str,
        url: str,
        account_id: str,
        headers: dict[str, str] | None = None,
        params: dict[str, str] | None = None,
        body: dict | None = None,
    ) -> dict:
        token = await self._get_token()
        url_with_params = _append_params(url, params)
        url64 = _base64url_encode(url_with_params)
        proxy_url = f"{PIPEDREAM_API_BASE}/v1/connect/{self._config.project_id}/proxy/{url64}"
        proxy_params = {
            "external_user_id": self._config.external_user_id,
            "account_id": account_id,
        }

        downstream_headers = {f"x-pd-proxy-{k}": v for k, v in (headers or {}).items()}

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.request(
                method=method,
                url=proxy_url,
                params=proxy_params,
                json=body if body is not None else None,
                headers={
                    "authorization": f"Bearer {token}",
                    "x-pd-environment": self._config.environment,
                    **downstream_headers,
                },
            )
            response.raise_for_status()
            return response.json()
