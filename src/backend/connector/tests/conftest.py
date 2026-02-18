import types
from unittest.mock import MagicMock
import sys

import pytest

# Pre-mock loguru before server.py is imported.
# server.py does `from backend.lib.log import configure_logging`
# which requires loguru (not installed in the test env).
if "loguru" not in sys.modules:
    _loguru = types.ModuleType("loguru")
    _loguru.logger = MagicMock()
    sys.modules["loguru"] = _loguru


@pytest.fixture
def mock_settings(monkeypatch):
    """Patch settings for testing.

    auth.py binds its own `settings` reference at import time, so we must
    patch it there as well as in the settings module.
    """
    from backend.connector.settings import settings

    monkeypatch.setattr(settings, "atlas_api_key", "test-key-123")
    monkeypatch.setattr(settings, "atlas_allow_unauthenticated", False)
    # auth.py imports settings as _settings_mod and reads _settings_mod.settings at call time,
    # so patching the settings object above is sufficient.
    return settings


@pytest.fixture
def auth_headers():
    return {"X-Atlas-Key": "test-key-123"}


@pytest.fixture
def client(mock_settings):
    from backend.connector.server import app
    from fastapi.testclient import TestClient

    return TestClient(app)
