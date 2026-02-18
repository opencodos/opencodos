import hmac

from . import settings as _settings_mod
from fastapi import Header, HTTPException, WebSocket


def _validate_api_key_value(value: str | None) -> tuple[bool, int, str]:
    """Validate Atlas API key value.

    Returns:
        (is_valid, status_code, detail)
    """
    settings = _settings_mod.settings
    if settings.atlas_allow_unauthenticated:
        return True, 200, ""

    expected = (settings.atlas_api_key or "").strip()
    if not expected:
        return False, 503, "Server misconfigured: ATLAS_API_KEY is not set"

    provided = (value or "").strip()
    if not provided or not hmac.compare_digest(provided, expected):
        return False, 401, "Unauthorized"

    return True, 200, ""


def validate_websocket_api_key(websocket: WebSocket) -> tuple[bool, str]:
    """Validate API key for a WebSocket request."""
    provided = websocket.headers.get("x-atlas-key") or websocket.query_params.get("atlas_key")
    valid, status_code, detail = _validate_api_key_value(provided)
    if valid:
        return True, ""
    if status_code == 503:
        return False, "Server misconfigured"
    return False, detail


def require_api_key(
    x_atlas_key: str | None = Header(default=None, alias="X-Atlas-Key"),
) -> None:
    """Require X-Atlas-Key header (fail closed unless explicitly overridden)."""
    valid, status_code, detail = _validate_api_key_value(x_atlas_key)
    if not valid:
        raise HTTPException(status_code=status_code, detail=detail)
