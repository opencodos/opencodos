"""Regression tests for Telegram auth + config loading.

Tests that:
1. Missing TELEGRAM_API_ID/HASH raises ValueError (not unhandled crash)
2. /telegram/auth/initiate returns 400 (not 500) when creds are missing
3. Keys saved to .env after agent start are picked up on next load_config()
"""

import os
import textwrap
from pathlib import Path
from unittest.mock import patch

import pytest
import yaml


@pytest.fixture
def config_dir(tmp_path):
    """Create a minimal config.yaml with placeholder creds."""
    config = {
        "telegram": {"api_id": 0, "api_hash": "placeholder"},
        "anthropic": {"api_key": "sk-test"},
        "obsidian": {"vault_path": str(tmp_path / "vault")},
        "sync": {},
        "conversations": {"whitelist": []},
    }
    config_file = tmp_path / "config.yaml"
    with open(config_file, "w") as f:
        yaml.dump(config, f)
    (tmp_path / "vault").mkdir()
    return tmp_path


@pytest.fixture
def env_file(tmp_path):
    """Create a .env file path (initially empty)."""
    env_path = tmp_path / ".env"
    env_path.touch()
    return env_path


def test_load_config_missing_creds_raises_value_error(config_dir, env_file):
    """load_config() with no TELEGRAM_API_ID in env and api_id: 0 in yaml → ValueError."""
    from backend.telegram_agent.src.config import load_config

    # Point ATLAS_ENV_FILE to empty file so _reload_dotenv doesn't load real keys
    env = {k: v for k, v in os.environ.items()
           if k not in ("TELEGRAM_API_ID", "TELEGRAM_API_HASH", "VAULT_PATH", "ATLAS_ENV_FILE")}
    env["VAULT_PATH"] = str(config_dir / "vault")
    env["ATLAS_ENV_FILE"] = str(env_file)

    with patch.dict(os.environ, env, clear=True):
        with pytest.raises(ValueError, match="TELEGRAM_API_ID"):
            load_config(str(config_dir / "config.yaml"), require_anthropic=False)


def test_load_config_picks_up_env_after_save(config_dir, env_file):
    """Keys saved to .env after agent start are picked up on next load_config() call."""
    from backend.telegram_agent.src.config import load_config

    # Start with no creds
    env = {k: v for k, v in os.environ.items()
           if k not in ("TELEGRAM_API_ID", "TELEGRAM_API_HASH", "VAULT_PATH", "ATLAS_ENV_FILE")}
    env["VAULT_PATH"] = str(config_dir / "vault")
    env["ATLAS_ENV_FILE"] = str(env_file)

    with patch.dict(os.environ, env, clear=True):
        # First call: no creds → ValueError
        with pytest.raises(ValueError, match="TELEGRAM_API_ID"):
            load_config(str(config_dir / "config.yaml"), require_anthropic=False)

        # Simulate wizard saving keys to .env
        env_file.write_text(
            "TELEGRAM_API_ID=12345\n"
            "TELEGRAM_API_HASH=abcdef1234567890abcdef1234567890\n"
        )

        # Second call: should pick up new keys from .env
        config = load_config(str(config_dir / "config.yaml"), require_anthropic=False)
        assert config.telegram.api_id == 12345
        assert config.telegram.api_hash == "abcdef1234567890abcdef1234567890"


def test_initiate_auth_returns_400_for_missing_creds(config_dir):
    """POST /telegram/auth/initiate with missing creds returns 400, not 500."""
    from fastapi.testclient import TestClient

    env = {k: v for k, v in os.environ.items()
           if k not in ("TELEGRAM_API_ID", "TELEGRAM_API_HASH", "VAULT_PATH", "ATLAS_ENV_FILE")}
    env["VAULT_PATH"] = str(config_dir / "vault")
    env["ATLAS_ENV_FILE"] = str(config_dir / "nonexistent.env")

    with patch.dict(os.environ, env, clear=True):
        # Patch _CONFIG_PATH to use our test config
        import backend.telegram_agent.server as server
        original_config_path = server._CONFIG_PATH
        server._CONFIG_PATH = str(config_dir / "config.yaml")
        try:
            client = TestClient(server.app)
            resp = client.post("/telegram/auth/initiate")
            assert resp.status_code == 400
            assert "TELEGRAM_API_ID" in resp.json()["detail"]
        finally:
            server._CONFIG_PATH = original_config_path


def test_codos_root_resolves_correctly():
    """_CODOS_ROOT resolves to the actual codos repo root, not src/."""
    from backend.telegram_agent.src.config import _CODOS_ROOT

    # _CODOS_ROOT should contain pyproject.toml or CLAUDE.md at repo root
    assert (_CODOS_ROOT / "pyproject.toml").exists() or (_CODOS_ROOT / "CLAUDE.md").exists(), (
        f"_CODOS_ROOT={_CODOS_ROOT} does not look like the codos repo root"
    )
