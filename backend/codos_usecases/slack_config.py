"""Slack configuration loader for gateway-backend and sync scripts."""

from pathlib import Path
from typing import TypedDict, cast

import yaml

from backend.codos_models.settings import settings

LEGACY_CONFIG_PATH = Path(__file__).parent / "config.yaml"


class ConversationsConfig(TypedDict, total=False):
    whitelist: list[str]
    ignored: list[str]


class SyncConfig(TypedDict, total=False):
    initial_lookback_days: int
    schedule_hours: int


class SlackConfig(TypedDict, total=False):
    sync: SyncConfig
    conversations: ConversationsConfig
    team_id: str | None


def _load_vault_path() -> Path:
    """Resolve vault path from settings."""
    return settings.get_vault_path()


def _primary_config_path() -> Path:
    """Canonical config path used by ingestion/Slack/slack-sync.ts."""
    return _load_vault_path() / "3 - Ingestion" / "Slack" / "config.yaml"


def _read_config(path: Path) -> SlackConfig:
    with open(path, encoding="utf-8") as f:
        return cast(SlackConfig, yaml.safe_load(f) or {})


def load_config() -> SlackConfig:
    """Load Slack sync configuration from YAML.

    Priority:
    1. Vault config used by sync runtime
    2. Legacy repo-local config (backward compatibility)
    3. Defaults
    """
    primary = _primary_config_path()
    if primary.exists():
        return _read_config(primary)
    if LEGACY_CONFIG_PATH.exists():
        return _read_config(LEGACY_CONFIG_PATH)
    return {
        "sync": {"initial_lookback_days": 7, "schedule_hours": 1},
        "conversations": {"whitelist": [], "ignored": []},
        "team_id": None,
    }


def save_config(config: SlackConfig) -> None:
    """Save Slack sync configuration to canonical vault location."""
    config_path = _primary_config_path()
    config_path.parent.mkdir(parents=True, exist_ok=True)
    with open(config_path, "w", encoding="utf-8") as f:
        yaml.dump(config, f, default_flow_style=False, allow_unicode=True)


def get_whitelist() -> list[str]:
    """Get list of channel IDs to sync."""
    config = load_config()
    return config.get("conversations", {}).get("whitelist", [])


def get_ignored() -> list[str]:
    """Get list of channel IDs to skip."""
    config = load_config()
    return config.get("conversations", {}).get("ignored", [])


def get_lookback_days() -> int:
    """Get initial lookback days for sync."""
    config = load_config()
    return config.get("sync", {}).get("initial_lookback_days", 7)


def set_whitelist(channel_ids: list[str], lookback_days: int | None = None) -> None:
    """Update whitelist and optionally lookback days."""
    config = load_config()
    if "conversations" not in config:
        config["conversations"] = {}
    config["conversations"]["whitelist"] = channel_ids
    if lookback_days is not None:
        if "sync" not in config:
            config["sync"] = {}
        config["sync"]["initial_lookback_days"] = lookback_days
    save_config(config)


def set_team_id(team_id: str) -> None:
    """Store the Slack team ID."""
    config = load_config()
    config["team_id"] = team_id
    save_config(config)
