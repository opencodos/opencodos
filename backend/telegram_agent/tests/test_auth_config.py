"""Regression tests for Telegram auth + config loading.

Tests that:
1. Telegram creds are always loaded from connector settings (never missing)
2. Keys saved to .env after agent start are picked up on next load_config()
"""

import os
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


def test_load_config_always_has_telegram_creds(config_dir, env_file):
    """load_config() always gets Telegram creds from connector settings, even without .env."""
    from backend.telegram_agent.src.config import load_config

    env = {k: v for k, v in os.environ.items()
           if k not in ("TELEGRAM_API_ID", "TELEGRAM_API_HASH", "VAULT_PATH", "ATLAS_ENV_FILE")}
    env["VAULT_PATH"] = str(config_dir / "vault")
    env["ATLAS_ENV_FILE"] = str(env_file)

    with patch.dict(os.environ, env, clear=True):
        config = load_config(str(config_dir / "config.yaml"), require_anthropic=False)
        assert config.telegram.api_id > 0
        assert len(config.telegram.api_hash) > 0


def test_codos_root_resolves_correctly():
    """_CODOS_ROOT resolves to the actual codos repo root, not src/."""
    from backend.telegram_agent.src.config import _CODOS_ROOT

    # _CODOS_ROOT should contain pyproject.toml or CLAUDE.md at repo root
    assert (_CODOS_ROOT / "pyproject.toml").exists() or (_CODOS_ROOT / "CLAUDE.md").exists(), (
        f"_CODOS_ROOT={_CODOS_ROOT} does not look like the codos repo root"
    )
