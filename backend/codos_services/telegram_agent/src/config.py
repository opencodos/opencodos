"""Configuration loader and validator."""

import fcntl
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path

import yaml

from backend.codos_models.settings import settings
from backend.codos_utils.secrets import get_secrets_backend


@dataclass
class TelegramConfig:
    api_id: int
    api_hash: str


@dataclass
class AnthropicConfig:
    api_key: str
    model: str = "claude-sonnet-4-20250514"


@dataclass
class RoutingRule:
    default: str
    archived: str


@dataclass
class RoutingConfig:
    private: RoutingRule
    group: RoutingRule
    channel: RoutingRule

    def get_subfolder(self, conv_type: str, archived: bool) -> str:
        """Get the subfolder path based on conversation type and archived status."""
        rule = getattr(self, conv_type, self.private)
        return rule.archived if archived else rule.default


@dataclass
class ObsidianConfig:
    vault_path: Path
    routing: RoutingConfig | None = None


@dataclass
class SyncConfig:
    initial_lookback_days: int = 7
    # Sync filter options
    sync_unread_only: bool = False  # If True, only sync conversations with unread messages
    include_dms: bool = True
    include_groups: bool = True
    include_channels: bool = False
    include_muted: bool = False
    include_archived: bool = False
    mark_unread_after_sync: bool = False  # Re-mark as unread after processing


@dataclass
class DiscoveryConfig:
    enabled: bool = True
    auto_add_groups: bool = True
    auto_add_dms: bool = True
    auto_add_channels: bool = False
    notify_on_new: bool = True


@dataclass
class ConversationsConfig:
    whitelist: list[dict] = field(default_factory=list)
    ignored: list[dict] = field(default_factory=list)
    pending: list[dict] = field(default_factory=list)
    # Legacy support
    selected: list[dict] = field(default_factory=list)


@dataclass
class Config:
    telegram: TelegramConfig
    anthropic: AnthropicConfig
    obsidian: ObsidianConfig
    sync: SyncConfig
    conversations: ConversationsConfig
    discovery: DiscoveryConfig

    # Paths relative to config file
    base_path: Path = field(default_factory=Path)


def load_config(config_path: str = "config.yaml", require_anthropic: bool = True) -> Config:
    """Load and validate configuration from YAML file.

    Args:
        config_path: Path to config file
        require_anthropic: If False, don't error if Anthropic key is missing
    """
    config_file = Path(config_path)
    if not config_file.exists():
        raise FileNotFoundError(
            f"Config file not found: {config_path}\n"
            "Copy config.example.yaml to config.yaml and fill in your credentials."
        )

    with open(config_file) as f:
        raw = yaml.safe_load(f)

    # Telegram config — settings.py is the single source of truth
    telegram = TelegramConfig(
        api_id=int(settings.telegram_api_id),
        api_hash=settings.telegram_api_hash,
    )

    # Anthropic config - prefer secrets backend, fall back to config.yaml
    api_key = get_secrets_backend().get("ANTHROPIC_API_KEY") or raw.get("anthropic", {}).get("api_key", "")
    if not api_key and require_anthropic:
        raise ValueError("ANTHROPIC_API_KEY not set in environment or config.yaml")

    anthropic = AnthropicConfig(
        api_key=api_key or "",
        model=raw.get("anthropic", {}).get("model", "claude-sonnet-4-20250514"),
    )

    # Obsidian config - prefer config.yaml, fall back to settings (paths.json)
    vault_path_str = raw.get("obsidian", {}).get("vault_path")
    if not vault_path_str:
        vault_path_str = str(settings.get_vault_path())
    if vault_path_str:
        vault_path = Path(vault_path_str).expanduser()
        # Append Telegram inbox subpath if this is a root vault path
        if not str(vault_path).endswith("Telegram"):
            vault_path = vault_path / "1 - Inbox (Last 7 days)" / "Telegram"
    else:
        raise ValueError("vault_path not set in config.yaml or ~/.codos/paths.json")

    # Parse routing rules if present
    routing = None
    routing_raw = raw.get("obsidian", {}).get("routing")
    if routing_raw:
        routing = RoutingConfig(
            private=RoutingRule(
                default=routing_raw.get("private", {}).get("default", "DMs"),
                archived=routing_raw.get("private", {}).get("archived", "Archived/DMs"),
            ),
            group=RoutingRule(
                default=routing_raw.get("group", {}).get("default", "Groups"),
                archived=routing_raw.get("group", {}).get("archived", "Archived/Groups"),
            ),
            channel=RoutingRule(
                default=routing_raw.get("channel", {}).get("default", "Channels"),
                archived=routing_raw.get("channel", {}).get("archived", "Archived/Channels"),
            ),
        )

    obsidian = ObsidianConfig(vault_path=vault_path, routing=routing)

    # Sync config
    sync_raw = raw.get("sync", {})
    sync = SyncConfig(
        initial_lookback_days=sync_raw.get("initial_lookback_days", 7),
        sync_unread_only=sync_raw.get("sync_unread_only", False),
        include_dms=sync_raw.get("include_dms", True),
        include_groups=sync_raw.get("include_groups", True),
        include_channels=sync_raw.get("include_channels", False),
        include_muted=sync_raw.get("include_muted", False),
        include_archived=sync_raw.get("include_archived", False),
        mark_unread_after_sync=sync_raw.get("mark_unread_after_sync", False),
    )

    # Discovery config
    disc_raw = raw.get("discovery", {})
    discovery = DiscoveryConfig(
        enabled=disc_raw.get("enabled", True),
        auto_add_groups=disc_raw.get("auto_add_groups", True),
        auto_add_dms=disc_raw.get("auto_add_dms", True),
        auto_add_channels=disc_raw.get("auto_add_channels", False),
        notify_on_new=disc_raw.get("notify_on_new", True),
    )

    # Conversations config (supports both new whitelist and legacy selected)
    conv_raw = raw.get("conversations", {})
    whitelist = conv_raw.get("whitelist", [])
    selected = conv_raw.get("selected", [])

    # Use whitelist if present, fall back to selected for backwards compatibility
    effective_whitelist = whitelist if whitelist else selected

    conversations = ConversationsConfig(
        whitelist=effective_whitelist,
        ignored=conv_raw.get("ignored", []),
        pending=conv_raw.get("pending", []),
        selected=effective_whitelist,  # Keep selected in sync for legacy code
    )

    return Config(
        telegram=telegram,
        anthropic=anthropic,
        obsidian=obsidian,
        sync=sync,
        conversations=conversations,
        discovery=discovery,
        base_path=config_file.parent.resolve(),
    )


@contextmanager
def _config_lock(config_path: str):
    """File lock around config.yaml read-modify-write."""
    lock_path = Path(config_path).with_suffix(".lock")
    lock_fd = open(lock_path, "w")
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX)
        yield
    finally:
        fcntl.flock(lock_fd, fcntl.LOCK_UN)
        lock_fd.close()


def save_selected_conversations(config_path: str, selected: list[dict]) -> None:
    """Save selected conversations back to config file (legacy)."""
    save_whitelist(config_path, selected)


def save_whitelist(config_path: str, whitelist: list[dict]) -> None:
    """Save whitelist conversations to config file."""
    with _config_lock(config_path):
        config_file = Path(config_path)

        with open(config_file) as f:
            raw = yaml.safe_load(f)

        if "conversations" not in raw:
            raw["conversations"] = {}
        raw["conversations"]["whitelist"] = whitelist

        with open(config_file, "w") as f:
            yaml.dump(raw, f, default_flow_style=False, allow_unicode=True, sort_keys=False)


def add_to_whitelist(config_path: str, conversation: dict) -> None:
    """Add a single conversation to the whitelist."""
    with _config_lock(config_path):
        config_file = Path(config_path)

        with open(config_file) as f:
            raw = yaml.safe_load(f)

        whitelist = raw.get("conversations", {}).get("whitelist", [])

        # Check if already in whitelist
        existing_ids = {c["id"] for c in whitelist}
        if conversation["id"] not in existing_ids:
            whitelist.append(conversation)
            raw["conversations"]["whitelist"] = whitelist

            with open(config_file, "w") as f:
                yaml.dump(raw, f, default_flow_style=False, allow_unicode=True, sort_keys=False)


def add_to_ignored(config_path: str, conversation: dict) -> None:
    """Add a single conversation to the ignored list."""
    with _config_lock(config_path):
        config_file = Path(config_path)

        with open(config_file) as f:
            raw = yaml.safe_load(f)

        ignored = raw.get("conversations", {}).get("ignored", [])

        # Check if already in ignored
        existing_ids = {c["id"] for c in ignored}
        if conversation["id"] not in existing_ids:
            ignored.append(conversation)
            raw["conversations"]["ignored"] = ignored

            with open(config_file, "w") as f:
                yaml.dump(raw, f, default_flow_style=False, allow_unicode=True, sort_keys=False)


def add_to_pending(config_path: str, conversation: dict) -> None:
    """Add a single conversation to the pending approval list."""
    with _config_lock(config_path):
        config_file = Path(config_path)

        with open(config_file) as f:
            raw = yaml.safe_load(f)

        pending = raw.get("conversations", {}).get("pending", [])

        # Check if already in pending, whitelist, or ignored
        whitelist = raw.get("conversations", {}).get("whitelist", [])
        ignored = raw.get("conversations", {}).get("ignored", [])

        all_known_ids = {c["id"] for c in whitelist + ignored + pending}
        if conversation["id"] not in all_known_ids:
            pending.append(conversation)
            raw["conversations"]["pending"] = pending

            with open(config_file, "w") as f:
                yaml.dump(raw, f, default_flow_style=False, allow_unicode=True, sort_keys=False)


def approve_pending(config_path: str, conversation_id: int) -> dict | None:
    """Move a conversation from pending to whitelist. Returns the conversation if found."""
    with _config_lock(config_path):
        config_file = Path(config_path)

        with open(config_file) as f:
            raw = yaml.safe_load(f)

        pending = raw.get("conversations", {}).get("pending", [])
        whitelist = raw.get("conversations", {}).get("whitelist", [])

        # Find and remove from pending
        conversation = None
        for i, conv in enumerate(pending):
            if conv["id"] == conversation_id:
                conversation = pending.pop(i)
                break

        if conversation:
            whitelist.append(conversation)
            raw["conversations"]["pending"] = pending
            raw["conversations"]["whitelist"] = whitelist

            with open(config_file, "w") as f:
                yaml.dump(raw, f, default_flow_style=False, allow_unicode=True, sort_keys=False)

    return conversation


def ignore_pending(config_path: str, conversation_id: int) -> dict | None:
    """Move a conversation from pending to ignored. Returns the conversation if found."""
    with _config_lock(config_path):
        config_file = Path(config_path)

        with open(config_file) as f:
            raw = yaml.safe_load(f)

        pending = raw.get("conversations", {}).get("pending", [])
        ignored = raw.get("conversations", {}).get("ignored", [])

        # Find and remove from pending
        conversation = None
        for i, conv in enumerate(pending):
            if conv["id"] == conversation_id:
                conversation = pending.pop(i)
                break

        if conversation:
            ignored.append(conversation)
            raw["conversations"]["pending"] = pending
            raw["conversations"]["ignored"] = ignored

            with open(config_file, "w") as f:
                yaml.dump(raw, f, default_flow_style=False, allow_unicode=True, sort_keys=False)

    return conversation
