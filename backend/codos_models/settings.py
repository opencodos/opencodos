"""Centralized settings for the Codos backend.

Configuration is read from (in priority order):
1. Constructor arguments
2. Environment variables (non-secret config: ports, paths, bundle flags)
3. Secrets backend (API keys stored via the pluggable secrets system)

Path constants are defined in ``codos_utils.paths`` and re-exported here
for convenience.

Usage:
    from backend.codos_models.settings import settings
    print(settings.vault_path)
    print(settings.get_codos_path())

After secrets writes (e.g. setup wizard), call reload_settings() to re-read.
"""

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, PydanticBaseSettingsSource, SettingsConfigDict

from backend.codos_models.exceptions import DependencyNotInstalledException
from backend.codos_utils.deps import find_bun
from backend.codos_utils.paths import (
    CODOS_CONFIG_DIR,
    LOGS_ROOT,
    load_codos_path,
    load_paths,
    load_vault_path,
)
from backend.codos_utils.paths import (
    CONFIG_FILE as CONFIG_FILE,
)
from backend.codos_utils.paths import (
    DB_PATH as DB_PATH,
)
from backend.codos_utils.paths import (
    PATHS_FILE as PATHS_FILE,
)
from backend.codos_utils.paths import (
    SESSIONS_DIR as SESSIONS_DIR,
)
from backend.codos_utils.secrets.settings_source import SecretsBackendSource


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore")

    vault_path: str = Field(default_factory=load_vault_path)
    codos_root: str = Field(default_factory=load_codos_path)
    codos_data_dir: str = str(CODOS_CONFIG_DIR)

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

    def get_codos_path(self) -> Path:
        return Path(self.codos_root).expanduser()

    def get_vault_path(self) -> Path:
        return Path(self.vault_path).expanduser()

    def get_source_tree_root(self) -> Path:
        return self.get_codos_path()

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        return (
            init_settings,
            env_settings,
            SecretsBackendSource(settings_cls),
        )

    def get_log_dir(self) -> Path:
        p = Path(LOGS_ROOT)
        p.mkdir(parents=True, exist_ok=True)
        return p

    def get_telegram_data_dir(self) -> Path:
        p = Path(self.codos_data_dir) / "config" / "telegram"
        p.mkdir(parents=True, exist_ok=True)
        return p

    def get_telegram_session_path(self) -> Path:
        """Get Telegram session file path (~/.codos/config/telegram/session.string)."""
        return self.get_telegram_data_dir() / "session.string"

    def get_telegram_config_path(self) -> Path:
        """Get Telegram config.yaml path (~/.codos/config/telegram/config.yaml)."""
        return self.get_telegram_data_dir() / "config.yaml"

    def get_backend_venv_python(self) -> Path:
        return self.get_codos_path() / "backend" / ".venv" / "bin" / "python"

    @property
    def bun_path(self) -> str:
        found = find_bun()
        if found:
            return found
        raise DependencyNotInstalledException("bun not found. Install with: curl -fsSL https://bun.sh/install | bash")

    @property
    def frontend_dist_dir(self) -> Path | None:
        """Return path to built frontend dist if it exists, else None."""
        dist = self.get_codos_path() / "dev" / "frontend" / "dist"
        return dist if dist.is_dir() else None

    @property
    def telegram_agent_url(self) -> str:
        return f"http://localhost:{self.telegram_agent_port}"


settings = Settings()


def reload_settings() -> Settings:
    """Reload after secrets backend writes (e.g. setup wizard)."""
    global settings
    load_paths.cache_clear()
    settings = Settings()
    return settings
