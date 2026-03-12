"""
Single source of truth for entity_id.
All modules should import from here to ensure consistency.
"""

import hashlib
import json
import os
import subprocess
import uuid

from backend.codos_utils.paths import CONFIG_FILE

_cached_entity_id: str | None = None


def _get_system_name() -> str:
    """Get the user's full name from the system."""
    try:
        result = subprocess.run(["id", "-F"], capture_output=True, text=True, timeout=5)
        if result.returncode == 0:
            return result.stdout.strip()
    except Exception:
        pass
    return os.environ.get("USER", "user")


def _generate_entity_id(user_name: str) -> str:
    """Generate unique entity_id from user name + machine ID."""
    machine_id = uuid.getnode()  # MAC address as int
    unique_str = f"{user_name}-{machine_id}"
    return hashlib.sha256(unique_str.encode()).hexdigest()[:16]


def get_entity_id() -> str:
    """
    Get entity_id. Single source of truth.

    Order:
    1. Return cached value if available
    2. Read from config.json if exists
    3. Generate deterministically and persist

    This ensures the same entity_id is used across all code paths
    within a single machine/process.
    """
    global _cached_entity_id

    if _cached_entity_id:
        return _cached_entity_id

    config_path = CONFIG_FILE

    # Try to read from config.json
    if config_path.exists():
        try:
            with open(config_path) as f:
                config = json.load(f)
            entity_id_val = config.get("entityId")
            if entity_id_val and isinstance(entity_id_val, str):
                _cached_entity_id = entity_id_val
                return _cached_entity_id
        except (OSError, json.JSONDecodeError):
            pass

    # Generate deterministically (same machine = same result)
    user_name = _get_system_name()
    entity_id = _generate_entity_id(user_name)

    # Persist to config.json atomically
    config_path.parent.mkdir(parents=True, exist_ok=True)

    config = {}
    if config_path.exists():
        try:
            with open(config_path) as f:
                config = json.load(f)
        except (OSError, json.JSONDecodeError):
            pass

    config["entityId"] = entity_id

    # Atomic write: write to temp file, then rename
    tmp_path = config_path.with_suffix(".tmp")
    with open(tmp_path, "w") as f:
        json.dump(config, f, indent=2)
    tmp_path.rename(config_path)

    _cached_entity_id = entity_id
    return entity_id


def compute_current_user_entity() -> str:
    """Entity ID for current OS user, bypassing cache/config."""
    return _generate_entity_id(_get_system_name())


def clear_cache() -> None:
    """Clear the cached entity_id. Use when config.json is modified externally."""
    global _cached_entity_id
    _cached_entity_id = None
