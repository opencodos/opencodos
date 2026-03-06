"""
Central backend server for connector-ui.
Provides real-time integration status by checking actual service connections.
"""

import asyncio
import json
import os
import traceback
from contextlib import asynccontextmanager
from pathlib import Path

from backend.codos_utils.log import configure_logging

configure_logging("connector-backend")

from loguru import logger

import httpx
from .auth import require_api_key
from .entity import get_entity_id
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from .pipedream_client import remove_env_var
from pydantic import BaseModel
from .routes.agents import router as agents_router
from .routes.agents_config import router as agents_config_router
from .routes.agents_rest import router as agents_rest_router
from .routes.agents_ws import router as agents_ws_router
from .routes.context import router as context_router
from .routes.crm import router as crm_router
from .routes.health import router as health_router
from .routes.schedules import router as schedules_router
from .routes.setup import router as setup_router
from .routes.skills import router as skills_router
from .routes.workflows import router as workflows_router
from .routes.inbox import router as inbox_router
from .settings import ATLAS_CONFIG_DIR, reload_settings, settings
from .status_checker import (
    ServiceStatus,
    check_all_services,
    check_service_status,
)

# Env file locations (later files override earlier ones)
# Use settings.get_env_file_path() which handles bundle mode and paths.json
ENV_FILE_PATHS = [
    str(settings.get_env_file_path()),
]


def _load_env_file(file_path: str) -> None:
    """Load environment variables from a file."""
    if not os.path.exists(file_path):
        return
    try:
        with open(file_path, encoding="utf-8") as handle:
            for raw_line in handle:
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                if key:
                    # Override existing values (later files take priority)
                    os.environ[key] = value
    except Exception:
        # Best effort: avoid blocking server startup on env parsing.
        pass


# Load env files in order (later files override)
for env_path in ENV_FILE_PATHS:
    _load_env_file(env_path)

# Re-read settings now that .env vars are in os.environ
reload_settings()


# Response models
class IntegrationInfo(BaseModel):
    service: str
    name: str
    description: str
    icon: str


class ConnectedIntegration(BaseModel):
    service: str
    account_id: str
    status: str
    connected_at: str | None = None
    error: str | None = None


class StatusResponse(BaseModel):
    connected: bool
    status: str
    account_id: str | None = None
    error: str | None = None
    is_verified: bool = True


class ConnectRequest(BaseModel):
    user_id: str | None = None
    callback_url: str | None = None


class ConnectResponse(BaseModel):
    redirect_url: str
    connection_id: str


class AccountInfo(BaseModel):
    id: str
    name: str | None = None
    app: str | None = None
    healthy: bool | None = None


class AccountsResponse(BaseModel):
    accounts: list[AccountInfo]


class SetAccountRequest(BaseModel):
    account_id: str


class AutoBindResponse(BaseModel):
    success: bool
    service: str
    account_id: str | None = None
    message: str | None = None


def _log_debug(payload: dict) -> None:
    """Write NDJSON debug log line (best effort)."""
    vault_root = settings.get_vault_path()
    log_path = str(vault_root / ".cursor" / "debug.log")
    try:
        with open(log_path, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(payload) + "\n")
    except Exception:
        pass


# Entity ID functions moved to entity.py - use get_entity_id() imported above


# Available integrations (matches frontend)
AVAILABLE_INTEGRATIONS: list[IntegrationInfo] = [
    IntegrationInfo(service="slack", name="Slack", description="Team communication", icon="message-square"),
    IntegrationInfo(service="telegram", name="Telegram", description="Messaging platform", icon="send"),
    IntegrationInfo(service="notion", name="Notion", description="Workspace management", icon="book"),
    IntegrationInfo(
        service="google", name="Google Workspace", description="Gmail, Calendar, Drive, Docs, Sheets", icon="google"
    ),
    IntegrationInfo(service="granola", name="Granola", description="Call transcription and notes", icon="mic"),
    IntegrationInfo(service="linear", name="Linear", description="Issue tracking", icon="list"),
]

# Cache for status checks (TTL: 30 seconds)
_status_cache: dict[str, tuple[ServiceStatus, float]] = {}
CACHE_TTL = 30.0


async def get_cached_status(service: str) -> ServiceStatus:
    """Get service status with caching."""
    import time

    now = time.time()
    if service in _status_cache:
        status, timestamp = _status_cache[service]
        if now - timestamp < CACHE_TTL:
            return status

    status = await check_service_status(service)
    _status_cache[service] = (status, now)
    return status


def _ensure_bundle_vault() -> None:
    """In bundle mode, ensure vault + paths.json exist at startup.

    Vault is always ~/projects/codos_vault for bundled apps.
    This runs synchronously before the server accepts requests.
    """
    if not settings.is_bundle_mode:
        return

    from .routes.setup import (
        ATLAS_CONFIG_DIR,
        _create_folder_structure,
        _ensure_atlas_dir,
        _get_system_timezone,
    )
    from .entity import get_entity_id

    vault_path = Path.home() / "projects" / "codos_vault"
    codos_path = settings.get_codos_path()

    # Create vault directory + template files if missing
    if not vault_path.exists():
        logger.info(f"[startup] Creating vault at {vault_path}")
        _create_folder_structure(vault_path, is_codos=False)

    # Ensure ~/.codos/paths.json exists
    _ensure_atlas_dir()
    paths_file = ATLAS_CONFIG_DIR / "paths.json"
    if not paths_file.exists():
        logger.info(f"[startup] Writing {paths_file}")
        import json as _json
        from datetime import datetime

        paths_data = {
            "codosPath": str(codos_path),
            "vaultPath": str(vault_path),
            "timezone": _get_system_timezone(),
            "createdAt": datetime.utcnow().isoformat(),
        }
        with open(paths_file, "w") as f:
            _json.dump(paths_data, f, indent=2)

        # Also write config.json with entity
        config_file = ATLAS_CONFIG_DIR / "config.json"
        if not config_file.exists():
            entity_id = get_entity_id()
            config_data = {
                "entityId": entity_id,
                "createdAt": datetime.utcnow().isoformat(),
            }
            with open(config_file, "w") as f:
                _json.dump(config_data, f, indent=2)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """App lifespan handler."""
    _ensure_bundle_vault()
    print("Connector backend starting on port 8767...")
    yield
    print("Connector backend shutting down...")


app = FastAPI(
    title="Connector UI Backend",
    description="Central backend for checking real integration status",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        # Vite dev origins
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
        "http://127.0.0.1:5175",
        # Desktop runtime origins
        "http://localhost",
        "http://127.0.0.1",
        "http://tauri.localhost",
        "https://tauri.localhost",
        "tauri://localhost",
    ],
    allow_origin_regex=r"^(https?|tauri)://(localhost|127\.0\.0\.1|tauri\.localhost)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response


# Include setup routes
app.include_router(setup_router)
app.include_router(skills_router)
app.include_router(schedules_router)
app.include_router(agents_router)
app.include_router(context_router)
app.include_router(agents_ws_router)
app.include_router(agents_rest_router)
app.include_router(health_router)
app.include_router(crm_router)
app.include_router(workflows_router)
app.include_router(agents_config_router)
app.include_router(inbox_router)


class OpenUrlRequest(BaseModel):
    url: str


@app.post("/api/util/open-url")
async def open_url(payload: OpenUrlRequest):
    """Open a URL in the system default browser.

    Used by the desktop app (DMG) where Tauri IPC cannot pass arguments
    reliably due to WKWebView dropping POST bodies for custom URL schemes.
    """
    import webbrowser

    webbrowser.open(payload.url)
    return {"ok": True}


@app.exception_handler(Exception)
async def unhandled_exception_handler(request, exc):
    """Log full traceback for any unhandled exception."""
    request_id = os.urandom(8).hex()
    logger.error(
        f"Unhandled {type(exc).__name__} on {request.method} {request.url.path} [request_id={request_id}]\n{traceback.format_exc()}"
    )
    return Response(
        content=json.dumps({"detail": "Internal server error", "request_id": request_id}),
        status_code=500,
        media_type="application/json",
    )


@app.get(
    "/api/integrations",
    response_model=list[IntegrationInfo],
    dependencies=[Depends(require_api_key)],
)
async def get_available_integrations():
    """List all available integrations."""
    return AVAILABLE_INTEGRATIONS


_connected_cache: tuple[list[ConnectedIntegration], float] | None = None
_CONNECTED_CACHE_TTL = 30  # seconds


@app.get(
    "/api/integrations/connected",
    response_model=list[ConnectedIntegration],
    dependencies=[Depends(require_api_key)],
)
async def get_connected_integrations():
    """Get all integrations with their real connection status."""
    global _connected_cache
    import time as _time

    now = _time.time()
    if _connected_cache:
        cached_result, cached_at = _connected_cache
        if now - cached_at < _CONNECTED_CACHE_TTL:
            return cached_result

    status_map = await check_all_services()

    connected = []
    for service, status in status_map.items():
        if status.connected:
            connected.append(
                ConnectedIntegration(
                    service=service,
                    account_id=status.account_id or f"{service}-account",
                    status=status.status,
                    connected_at=None,  # Would need to track this separately
                    error=status.error,
                )
            )

    _connected_cache = (connected, _time.time())
    return connected


@app.get(
    "/api/integrations/{service}/status",
    response_model=StatusResponse,
    dependencies=[Depends(require_api_key)],
)
async def get_integration_status(service: str, refresh: bool = False):
    """Check the real connection status for a specific service.

    Args:
        service: The service ID to check
        refresh: If True, bypass cache and fetch fresh status (use after OAuth)
    """
    if refresh and service in _status_cache:
        del _status_cache[service]

    status = await get_cached_status(service)

    return StatusResponse(
        connected=status.connected,
        status=status.status,
        account_id=status.account_id,
        error=status.error,
        is_verified=status.is_verified,
    )


@app.post(
    "/api/integrations/{service}/connect",
    response_model=ConnectResponse,
    dependencies=[Depends(require_api_key)],
    deprecated=True,
)
async def connect_integration(service: str, payload: ConnectRequest | None = None):
    """DEPRECATED: Pipedream OAuth connect flow removed.

    Services connect via claude.ai Connectors (Slack, Notion, Linear, Gmail, Calendar, Drive).
    """
    raise HTTPException(
        status_code=410,
        detail=f"Pipedream OAuth removed. Connect {service} via claude.ai Settings > Integrations.",
    )


@app.get(
    "/api/integrations/{service}/accounts",
    response_model=AccountsResponse,
    dependencies=[Depends(require_api_key)],
)
async def list_integration_accounts(service: str):
    """DEPRECATED: Pipedream accounts endpoint removed."""
    return AccountsResponse(accounts=[])


@app.post(
    "/api/integrations/{service}/account",
    dependencies=[Depends(require_api_key)],
)
async def set_integration_account(service: str, request: SetAccountRequest):
    """DEPRECATED: Pipedream account binding removed."""
    raise HTTPException(status_code=410, detail="Pipedream account binding removed.")


@app.post(
    "/api/integrations/{service}/autobind",
    response_model=AutoBindResponse,
    dependencies=[Depends(require_api_key)],
)
async def autobind_integration_account(service: str):
    """DEPRECATED: Pipedream autobind removed."""
    return AutoBindResponse(success=False, service=service, message="Pipedream autobind removed")


class DisconnectResponse(BaseModel):
    success: bool
    message: str


@app.delete(
    "/api/integrations/{service}",
    response_model=DisconnectResponse,
    dependencies=[Depends(require_api_key)],
)
async def disconnect_integration(service: str):
    """Disconnect an integration."""
    # MCP-based services (Slack, Notion, Linear) — managed in claude.ai Settings
    if service in ("slack", "notion", "linear"):
        # Clean up legacy env vars if present
        legacy_keys = {
            "notion": ["NOTION_API_KEY", "PIPEDREAM_ACCOUNT_ID_NOTION"],
            "slack": ["PIPEDREAM_ACCOUNT_ID_SLACK"],
            "linear": ["PIPEDREAM_ACCOUNT_ID_LINEAR"],
        }
        for key in legacy_keys.get(service, []):
            remove_env_var(key)

        if service in _status_cache:
            del _status_cache[service]

        return DisconnectResponse(
            success=True,
            message=f"{service.title()} legacy credentials cleared. To fully disconnect, remove the connector in claude.ai Settings > Integrations.",
        )

    # Handle Telegram (session file)
    if service == "telegram":
        from .status_checker import get_telegram_session_path

        session_file = Path(get_telegram_session_path())
        if session_file.exists():
            session_file.unlink()
        if service in _status_cache:
            del _status_cache[service]
        return DisconnectResponse(success=True, message="Telegram disconnected")

    # Granola — local file, nothing to disconnect server-side
    if service == "granola":
        if service in _status_cache:
            del _status_cache[service]
        return DisconnectResponse(success=True, message="Granola disconnected")

    if service in _status_cache:
        del _status_cache[service]
    return DisconnectResponse(success=True, message=f"{service} disconnected")


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok", "service": "connector-backend"}


# ==================== Token-Based Authentication ====================


class SaveTokenRequest(BaseModel):
    token: str


class SaveTokenResponse(BaseModel):
    success: bool
    message: str


@app.post(
    "/api/integrations/{service}/save-token",
    response_model=SaveTokenResponse,
    dependencies=[Depends(require_api_key)],
    deprecated=True,
)
async def save_service_token(service: str, request: SaveTokenRequest):
    """DEPRECATED: Save an API token for a service that uses direct token auth.

    Notion now uses claude.ai MCP Connectors instead of direct API keys.
    This endpoint is kept temporarily for backward compatibility and will be
    removed in a future release.
    """
    if service == "notion":
        return SaveTokenResponse(
            success=False,
            message="Notion now uses claude.ai MCP Connectors. Please connect Notion via Settings > Integrations in Claude Desktop.",
        )

    raise HTTPException(status_code=400, detail=f"Token-based auth not supported for {service}. Use OAuth instead.")


# ==================== Audio Transcription ====================

from fastapi import File, UploadFile


@app.post(
    "/api/transcribe",
    dependencies=[Depends(require_api_key)],
)
async def transcribe_audio(file: UploadFile = File(...)):
    """Transcribe audio using AssemblyAI."""
    try:
        audio_data = await file.read()
        headers = {"authorization": settings.assemblyai_api_key or ""}

        async with httpx.AsyncClient() as client:
            # Step 1: Upload audio file
            upload_response = await client.post(
                "https://api.assemblyai.com/v2/upload",
                headers=headers,
                content=audio_data,
                timeout=60.0,
            )

            if upload_response.status_code != 200:
                raise HTTPException(status_code=upload_response.status_code, detail="Failed to upload audio")

            upload_url = upload_response.json()["upload_url"]

            # Step 2: Request transcription
            transcript_response = await client.post(
                "https://api.assemblyai.com/v2/transcript",
                headers=headers,
                json={"audio_url": upload_url},
                timeout=30.0,
            )

            if transcript_response.status_code != 200:
                raise HTTPException(status_code=transcript_response.status_code, detail="Failed to start transcription")

            transcript_id = transcript_response.json()["id"]

            # Step 3: Poll for completion
            while True:
                poll_response = await client.get(
                    f"https://api.assemblyai.com/v2/transcript/{transcript_id}",
                    headers=headers,
                    timeout=30.0,
                )
                result = poll_response.json()
                status = result["status"]

                if status == "completed":
                    return {"success": True, "transcript": result["text"]}
                elif status == "error":
                    raise HTTPException(status_code=500, detail=result.get("error", "Transcription failed"))

                await asyncio.sleep(1)

    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Transcription timed out")
    except HTTPException:
        raise
    except Exception as e:
        _log_debug(
            {
                "location": "server.py:transcribe_audio",
                "message": "Transcription failed",
                "data": {"error": str(e)},
                "timestamp": int(asyncio.get_event_loop().time() * 1000),
                "sessionId": "debug-session",
                "runId": "transcribe",
                "hypothesisId": "T",
            }
        )
        raise HTTPException(status_code=500, detail="Transcription failed")


# ==================== Slack Channel Management ====================


class SlackConversation(BaseModel):
    id: str
    name: str
    type: str  # public_channel, private_channel, dm
    member_count: int | None = None


class SlackConversationsResponse(BaseModel):
    team_id: str
    public_channels: list[SlackConversation]
    private_channels: list[SlackConversation]
    dms: list[SlackConversation]


class SlackConfigRequest(BaseModel):
    include_conversations: list[str]
    lookback_days: int = 7


class SlackConfigResponse(BaseModel):
    whitelist_ids: list[str]
    lookback_days: int


@app.get(
    "/api/integrations/slack/conversations",
    response_model=SlackConversationsResponse,
    dependencies=[Depends(require_api_key)],
)
async def get_slack_conversations():
    """Slack channel configuration is now managed via the workflow config modal."""
    return SlackConversationsResponse(
        team_id="",
        public_channels=[],
        private_channels=[],
        dms=[],
    )


@app.get(
    "/api/integrations/slack/config",
    response_model=SlackConfigResponse,
    dependencies=[Depends(require_api_key)],
)
async def get_slack_config():
    """Get current Slack channel whitelist from config.yaml."""
    try:
        from .slack_config import get_lookback_days, get_whitelist

        return SlackConfigResponse(
            whitelist_ids=get_whitelist(),
            lookback_days=get_lookback_days(),
        )
    except Exception as e:
        _log_debug(
            {
                "location": "server.py:get_slack_config",
                "message": "Failed to load config",
                "data": {"error": str(e)},
                "timestamp": int(asyncio.get_event_loop().time() * 1000),
                "sessionId": "debug-session",
                "runId": "slack-config",
                "hypothesisId": "S",
            }
        )
        return SlackConfigResponse(whitelist_ids=[], lookback_days=7)


@app.post(
    "/api/integrations/slack/config",
    dependencies=[Depends(require_api_key)],
)
async def save_slack_config(request: SlackConfigRequest):
    """Save Slack channel selection to config.yaml."""
    try:
        from .slack_config import set_whitelist

        set_whitelist(request.include_conversations, request.lookback_days)
        return {
            "success": True,
            "saved_count": len(request.include_conversations),
        }
    except Exception as e:
        _log_debug(
            {
                "location": "server.py:save_slack_config",
                "message": "Failed to save config",
                "data": {"error": str(e)},
                "timestamp": int(asyncio.get_event_loop().time() * 1000),
                "sessionId": "debug-session",
                "runId": "slack-config",
                "hypothesisId": "S",
            }
        )
        raise HTTPException(status_code=500, detail="Failed to save config")


# Telegram proxy configuration
TELEGRAM_AGENT_URL = settings.telegram_agent_url


@app.api_route(
    "/telegram/{path:path}",
    methods=["GET", "POST"],
    dependencies=[Depends(require_api_key)],
)
async def proxy_telegram(path: str, request: Request):
    """Proxy all /telegram/* requests to the Telegram-agent server."""
    # Use longer timeout for Telegram API calls (can be slow)
    timeout = httpx.Timeout(120.0, connect=10.0)

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            # Build the target URL
            url = f"{TELEGRAM_AGENT_URL}/telegram/{path}"

            # Forward query params
            if request.query_params:
                url = f"{url}?{request.query_params}"

            # Forward the request
            resp = await client.request(
                method=request.method,
                url=url,
                content=await request.body() if request.method == "POST" else None,
                headers={k: v for k, v in request.headers.items() if k.lower() not in ("host", "content-length")},
            )

            return Response(
                content=resp.content,
                status_code=resp.status_code,
                headers={
                    k: v for k, v in resp.headers.items() if k.lower() not in ("content-encoding", "transfer-encoding")
                },
            )
    except httpx.TimeoutException:
        _log_debug(
            {
                "location": "server.py:proxy_telegram",
                "message": "Telegram proxy timeout",
                "data": {"path": path, "method": request.method},
                "timestamp": int(asyncio.get_event_loop().time() * 1000),
                "sessionId": "debug-session",
                "runId": "telegram-proxy",
                "hypothesisId": "T",
            }
        )
        raise HTTPException(
            status_code=504,
            detail="Telegram API timeout. The Telegram service may be slow or unavailable. Please try again.",
        )
    except httpx.ConnectError as e:
        logger.error(f"Telegram agent connection failed: {e} (url={TELEGRAM_AGENT_URL}, path={path})")
        raise HTTPException(
            status_code=503, detail=f"Cannot connect to Telegram agent. Ensure it is running on {TELEGRAM_AGENT_URL}."
        )
    except httpx.HTTPError as e:
        _log_debug(
            {
                "location": "server.py:proxy_telegram",
                "message": "Telegram proxy HTTP error",
                "data": {"path": path, "error": str(e)},
                "timestamp": int(asyncio.get_event_loop().time() * 1000),
                "sessionId": "debug-session",
                "runId": "telegram-proxy",
                "hypothesisId": "T",
            }
        )
        raise HTTPException(status_code=502, detail="Telegram proxy error")


def run_server():
    """Entry point for `python -m backend connector`."""
    import uvicorn

    uvicorn.run(
        "backend.connector.server:app",
        host=settings.atlas_bind_host,
        port=settings.atlas_backend_port,
        reload=settings.uvicorn_reload,
        log_level="info",
        log_config=None,
    )


if __name__ == "__main__":
    run_server()
