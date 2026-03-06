"""Centralized settings for the connector-backend.

All configuration is read from environment variables via Pydantic BaseSettings.
server.py loads .env files into os.environ before this module is first imported,
so BaseSettings picks them up automatically — no env_file needed here.

Usage:
    from settings import settings
    print(settings.vault_path)
    print(settings.get_codos_path())

After .env writes (e.g. setup wizard), call reload_settings() to re-read.
"""

import json
import shutil
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ATLAS_CONFIG_DIR = Path.home() / ".codos"
SESSIONS_DIR = ATLAS_CONFIG_DIR / "sessions"
DB_PATH = ATLAS_CONFIG_DIR / "sessions.db"
_DEFAULT_VAULT = str(Path.home() / "codos_vault")


def _detect_source_tree_root() -> str | None:
    """Auto-detect source tree root by walking up from this file."""
    try:
        current = Path(__file__).resolve()
        for parent in current.parents:
            if (parent / "skills").exists() and (parent / "backend" / "connector").exists():
                return str(parent)
    except Exception:
        pass
    return None


def _load_codos_path_from_paths_json() -> str | None:
    """Read codos_path from ~/.codos/paths.json (written by setup wizard)."""
    paths_file = ATLAS_CONFIG_DIR / "paths.json"
    if paths_file.exists():
        try:
            with open(paths_file) as f:
                paths = json.load(f)
            value = paths.get("codos_path")
            if value:
                return str(Path(value).expanduser())
        except Exception:
            pass
    return None


def _load_vault_path_from_paths_json() -> str | None:
    """Read vault_path from ~/.codos/paths.json (written by setup wizard)."""
    paths_file = ATLAS_CONFIG_DIR / "paths.json"
    if paths_file.exists():
        try:
            with open(paths_file) as f:
                paths = json.load(f)
            value = paths.get("vault_path")
            if value:
                return str(Path(value).expanduser())
        except Exception:
            pass
    return None


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore")

    # Paths
    vault_path: str = _DEFAULT_VAULT
    codos_root: str | None = None  # CODOS_ROOT env var (set by Tauri)
    atlas_env_file: str | None = None
    atlas_data_dir: str = str(Path.home() / ".codos")  # Writable state directory

    # Bundle mode
    bundle_root: str | None = None  # BUNDLE_ROOT env var (set by Tauri in bundle mode)

    # Bundled executables
    atlas_bundled_claude: str | None = None
    atlas_bundled_bun: str | None = None

    # Server
    atlas_bind_host: str = "127.0.0.1"
    atlas_backend_port: int = 8767
    telegram_agent_port: int = 8768
    uvicorn_reload: bool = False

    # Auth
    atlas_api_key: str | None = None
    atlas_allow_unauthenticated: bool = False

    # Default Telegram API credentials (distributed with the app)
    telegram_api_id: str = "27156480"
    telegram_api_hash: str = "ce5830d5b5917b84a4dd04aa203deb2e"

    # API keys
    notion_api_key: str | None = None
    assemblyai_api_key: str | None = None

    # Attachment limits
    atlas_attachment_max_chars: int = 12000
    atlas_attachment_total_max_chars: int = 30000

    @property
    def is_bundle_mode(self) -> bool:
        if self.bundle_root is not None:
            return True
        if self.codos_root and ".app/Contents/" in self.codos_root:
            return True
        return False

    def get_codos_path(self) -> Path:
        """Get the codos root path.

        Resolution order:
        1. CODOS_ROOT env var (set by Tauri)
        2. ~/.codos/paths.json codosPath (set by setup wizard)
        3. Auto-detect from settings.py file location
        4. Fallback: ~/codos
        """
        if self.codos_root:
            return Path(self.codos_root)
        from_json = _load_codos_path_from_paths_json()
        if from_json:
            return Path(from_json)
        auto = _detect_source_tree_root()
        if auto:
            return Path(auto)
        return Path.home() / "codos"

    def get_vault_path(self) -> Path:
        """Get the vault path.

        Resolution order:
        1. VAULT_PATH env var (if different from default)
        2. ~/.codos/paths.json vault_path (set by setup wizard)
        3. Default: ~/codos_vault
        """
        if self.vault_path != _DEFAULT_VAULT:
            return Path(self.vault_path).expanduser()
        from_json = _load_vault_path_from_paths_json()
        if from_json:
            return Path(from_json)
        return Path(self.vault_path).expanduser()

    def get_source_tree_root(self) -> Path:
        """Get source tree root (dev mode only). Raises in bundle mode."""
        if self.is_bundle_mode:
            raise RuntimeError("source_tree_root not available in bundle mode")
        return self.get_codos_path()

    def get_bundle_root(self) -> Path:
        """Get bundle resource root (bundle mode only). Raises in dev mode."""
        if not self.is_bundle_mode:
            raise RuntimeError("bundle_root not available in dev mode")
        if self.bundle_root:
            return Path(self.bundle_root)
        return self.get_codos_path()

    def get_env_file_path(self) -> Path:
        """Get the canonical .env file path.

        In bundle mode, ATLAS_ENV_FILE is set by Tauri.
        In dev mode, falls back to {source_tree}/dev/Ops/.env.
        """
        if self.atlas_env_file:
            return Path(self.atlas_env_file)
        return self.get_codos_path() / "dev" / "Ops" / ".env"

    def get_telegram_data_dir(self) -> Path:
        """Get writable directory for Telegram state (~/.codos/config/telegram/)."""
        p = Path(self.atlas_data_dir) / "config" / "telegram"
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def bun_path(self) -> str:
        """Resolve bun binary path. Raises if not found."""
        bundled = self.atlas_bundled_bun
        if bundled and Path(bundled).exists():
            return bundled
        found = shutil.which("bun")
        if found:
            return found
        home_bun = Path.home() / ".bun" / "bin" / "bun"
        if home_bun.exists():
            return str(home_bun)
        raise RuntimeError("bun not found. Install with: curl -fsSL https://bun.sh/install | bash")

    @property
    def telegram_agent_url(self) -> str:
        return f"http://localhost:{self.telegram_agent_port}"


settings = Settings()


def reload_settings() -> Settings:
    """Reload after .env writes (e.g. setup wizard)."""
    global settings
    settings = Settings()
    return settings
