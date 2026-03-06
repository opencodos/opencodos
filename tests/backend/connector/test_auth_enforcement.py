from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from backend.connector.auth import require_api_key, validate_websocket_api_key
from backend.connector.settings import settings


def test_require_api_key_fails_closed_when_key_missing(monkeypatch):
    monkeypatch.setattr(settings, "atlas_allow_unauthenticated", False)
    monkeypatch.setattr(settings, "atlas_api_key", None)

    with pytest.raises(HTTPException) as exc:
        require_api_key(x_atlas_key=None)

    assert exc.value.status_code == 503


def test_require_api_key_accepts_matching_key(monkeypatch):
    monkeypatch.setattr(settings, "atlas_allow_unauthenticated", False)
    monkeypatch.setattr(settings, "atlas_api_key", "secret-key")

    require_api_key(x_atlas_key="secret-key")


def test_require_api_key_rejects_non_matching_key(monkeypatch):
    monkeypatch.setattr(settings, "atlas_allow_unauthenticated", False)
    monkeypatch.setattr(settings, "atlas_api_key", "secret-key")

    with pytest.raises(HTTPException) as exc:
        require_api_key(x_atlas_key="wrong-key")

    assert exc.value.status_code == 401


def test_ws_auth_accepts_query_param(monkeypatch):
    monkeypatch.setattr(settings, "atlas_allow_unauthenticated", False)
    monkeypatch.setattr(settings, "atlas_api_key", "secret-key")

    websocket = SimpleNamespace(headers={}, query_params={"atlas_key": "secret-key"})
    valid, detail = validate_websocket_api_key(websocket)
    assert valid is True
    assert detail == ""
