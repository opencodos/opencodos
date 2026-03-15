"""Tests for slack_config use-case."""

from __future__ import annotations

from pathlib import Path

import yaml

from backend.codos_usecases.slack_config import (
    get_ignored,
    get_lookback_days,
    get_whitelist,
    load_config,
    save_config,
    set_team_id,
    set_whitelist,
)


def _make_vault(tmp_path: Path) -> Path:
    """Create a minimal vault structure and return the vault path."""
    vault = tmp_path / "vault"
    config_dir = vault / "3 - Ingestion" / "Slack"
    config_dir.mkdir(parents=True)
    return vault


def _write_config(vault: Path, config: dict) -> None:
    config_path = vault / "3 - Ingestion" / "Slack" / "config.yaml"
    config_path.write_text(yaml.dump(config))


class TestLoadConfig:
    def test_loads_from_vault(self, tmp_path, monkeypatch):
        vault = _make_vault(tmp_path)
        _write_config(
            vault,
            {
                "sync": {"initial_lookback_days": 14},
                "conversations": {"whitelist": ["C123"]},
            },
        )
        monkeypatch.setattr(
            "backend.codos_usecases.slack_config._load_vault_path",
            lambda: vault,
        )
        config = load_config()
        assert config["sync"]["initial_lookback_days"] == 14
        assert config["conversations"]["whitelist"] == ["C123"]

    def test_falls_back_to_legacy(self, tmp_path, monkeypatch):
        vault = tmp_path / "vault"
        vault.mkdir()
        monkeypatch.setattr(
            "backend.codos_usecases.slack_config._load_vault_path",
            lambda: vault,
        )
        legacy = tmp_path / "legacy.yaml"
        legacy.write_text(yaml.dump({"sync": {"initial_lookback_days": 3}}))
        monkeypatch.setattr(
            "backend.codos_usecases.slack_config.LEGACY_CONFIG_PATH",
            legacy,
        )
        config = load_config()
        assert config["sync"]["initial_lookback_days"] == 3

    def test_returns_defaults(self, tmp_path, monkeypatch):
        vault = tmp_path / "vault"
        vault.mkdir()
        monkeypatch.setattr(
            "backend.codos_usecases.slack_config._load_vault_path",
            lambda: vault,
        )
        monkeypatch.setattr(
            "backend.codos_usecases.slack_config.LEGACY_CONFIG_PATH",
            tmp_path / "nonexistent.yaml",
        )
        config = load_config()
        assert config["sync"]["initial_lookback_days"] == 7
        assert config["conversations"]["whitelist"] == []
        assert config["team_id"] is None


class TestSaveConfig:
    def test_writes_yaml(self, tmp_path, monkeypatch):
        vault = _make_vault(tmp_path)
        monkeypatch.setattr(
            "backend.codos_usecases.slack_config._load_vault_path",
            lambda: vault,
        )
        save_config({"sync": {"initial_lookback_days": 10}})
        config_path = vault / "3 - Ingestion" / "Slack" / "config.yaml"
        data = yaml.safe_load(config_path.read_text())
        assert data["sync"]["initial_lookback_days"] == 10


class TestGetWhitelist:
    def test_returns_whitelist(self, tmp_path, monkeypatch):
        vault = _make_vault(tmp_path)
        _write_config(vault, {"conversations": {"whitelist": ["C1", "C2"]}})
        monkeypatch.setattr(
            "backend.codos_usecases.slack_config._load_vault_path",
            lambda: vault,
        )
        assert get_whitelist() == ["C1", "C2"]

    def test_returns_empty_default(self, tmp_path, monkeypatch):
        vault = tmp_path / "vault"
        vault.mkdir()
        monkeypatch.setattr(
            "backend.codos_usecases.slack_config._load_vault_path",
            lambda: vault,
        )
        monkeypatch.setattr(
            "backend.codos_usecases.slack_config.LEGACY_CONFIG_PATH",
            tmp_path / "nope.yaml",
        )
        assert get_whitelist() == []


class TestGetIgnored:
    def test_returns_ignored(self, tmp_path, monkeypatch):
        vault = _make_vault(tmp_path)
        _write_config(vault, {"conversations": {"ignored": ["C99"]}})
        monkeypatch.setattr(
            "backend.codos_usecases.slack_config._load_vault_path",
            lambda: vault,
        )
        assert get_ignored() == ["C99"]


class TestGetLookbackDays:
    def test_returns_configured_value(self, tmp_path, monkeypatch):
        vault = _make_vault(tmp_path)
        _write_config(vault, {"sync": {"initial_lookback_days": 30}})
        monkeypatch.setattr(
            "backend.codos_usecases.slack_config._load_vault_path",
            lambda: vault,
        )
        assert get_lookback_days() == 30

    def test_returns_default(self, tmp_path, monkeypatch):
        vault = tmp_path / "vault"
        vault.mkdir()
        monkeypatch.setattr(
            "backend.codos_usecases.slack_config._load_vault_path",
            lambda: vault,
        )
        monkeypatch.setattr(
            "backend.codos_usecases.slack_config.LEGACY_CONFIG_PATH",
            tmp_path / "nope.yaml",
        )
        assert get_lookback_days() == 7


class TestSetWhitelist:
    def test_sets_whitelist_and_lookback(self, tmp_path, monkeypatch):
        vault = _make_vault(tmp_path)
        monkeypatch.setattr(
            "backend.codos_usecases.slack_config._load_vault_path",
            lambda: vault,
        )
        monkeypatch.setattr(
            "backend.codos_usecases.slack_config.LEGACY_CONFIG_PATH",
            tmp_path / "nope.yaml",
        )
        set_whitelist(["C1", "C2"], lookback_days=14)
        config_path = vault / "3 - Ingestion" / "Slack" / "config.yaml"
        data = yaml.safe_load(config_path.read_text())
        assert data["conversations"]["whitelist"] == ["C1", "C2"]
        assert data["sync"]["initial_lookback_days"] == 14

    def test_sets_whitelist_without_lookback(self, tmp_path, monkeypatch):
        vault = _make_vault(tmp_path)
        monkeypatch.setattr(
            "backend.codos_usecases.slack_config._load_vault_path",
            lambda: vault,
        )
        monkeypatch.setattr(
            "backend.codos_usecases.slack_config.LEGACY_CONFIG_PATH",
            tmp_path / "nope.yaml",
        )
        set_whitelist(["C3"])
        config_path = vault / "3 - Ingestion" / "Slack" / "config.yaml"
        data = yaml.safe_load(config_path.read_text())
        assert data["conversations"]["whitelist"] == ["C3"]


class TestSetTeamId:
    def test_stores_team_id(self, tmp_path, monkeypatch):
        vault = _make_vault(tmp_path)
        monkeypatch.setattr(
            "backend.codos_usecases.slack_config._load_vault_path",
            lambda: vault,
        )
        monkeypatch.setattr(
            "backend.codos_usecases.slack_config.LEGACY_CONFIG_PATH",
            tmp_path / "nope.yaml",
        )
        set_team_id("T12345")
        config_path = vault / "3 - Ingestion" / "Slack" / "config.yaml"
        data = yaml.safe_load(config_path.read_text())
        assert data["team_id"] == "T12345"
