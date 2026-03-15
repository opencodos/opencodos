"""Shared path constants and paths.json reader.

Fixed paths (not user-configurable) live here. codos_models.settings
re-exports these and adds configurable overrides.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import BaseModel

CODOS_CONFIG_DIR = Path.home() / ".codos"
CONFIG_FILE = CODOS_CONFIG_DIR / "config.json"
PATHS_FILE = CODOS_CONFIG_DIR / "paths.json"
SECRETS_FILE = CODOS_CONFIG_DIR / "secrets.json"
SESSIONS_DIR = CODOS_CONFIG_DIR / "sessions"
DB_PATH = CODOS_CONFIG_DIR / "sessions.db"
LOGS_ROOT = CODOS_CONFIG_DIR / "logs"


class CodosPaths(BaseModel):
    codos_path: str
    vault_path: str


@lru_cache(maxsize=1)
def load_paths() -> CodosPaths:
    """Read and cache ~/.codos/paths.json."""
    if not PATHS_FILE.exists():
        raise FileNotFoundError(f"{PATHS_FILE} not found. Run 'bash scripts/bootstrap.sh --start' to set up Codos.")
    with open(PATHS_FILE) as f:
        return CodosPaths.model_validate_json(f.read())


def load_codos_path() -> str:
    return load_paths().codos_path


def load_vault_path() -> str:
    return load_paths().vault_path


def normalize_path(raw_path: str) -> Path:
    """Expand ``~`` and resolve a user-provided path string."""
    return Path(raw_path).expanduser().resolve()


def ensure_config_dir() -> Path:
    """Ensure ``~/.codos`` directory exists and return its path."""
    CODOS_CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    return CODOS_CONFIG_DIR


def mask_secret(value: str) -> str:
    """Show first 4 and last 4 characters, mask the middle."""
    if not value or len(value) < 12:
        return "••••••••" if value else ""
    return f"{value[:4]}••••{value[-4:]}"
