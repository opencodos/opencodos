from __future__ import annotations

import pytest
from pydantic_settings import BaseSettings, PydanticBaseSettingsSource

from backend.codos_utils.secrets.json_file import JsonFileBackend
from backend.codos_utils.secrets.settings_source import SecretsBackendSource


@pytest.fixture()
def secrets_file(tmp_path, monkeypatch):
    """Point the secrets backend at a temp JSON file."""
    path = tmp_path / "secrets.json"
    backend = JsonFileBackend(path=path)
    monkeypatch.setattr(
        "backend.codos_utils.secrets.settings_source.get_secrets_backend",
        lambda: backend,
    )
    return backend


class _TestSettings(BaseSettings):
    api_key: str | None = None
    other_key: str = "default"
    port: int = 8000

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


class TestSecretsBackendSource:
    def test_reads_secret_into_field(self, secrets_file):
        secrets_file.set("API_KEY", "from-secrets")
        s = _TestSettings()
        assert s.api_key == "from-secrets"

    def test_missing_secret_uses_default(self, secrets_file):
        s = _TestSettings()
        assert s.api_key is None
        assert s.other_key == "default"

    def test_env_var_takes_priority(self, secrets_file, monkeypatch):
        secrets_file.set("API_KEY", "from-secrets")
        monkeypatch.setenv("API_KEY", "from-env")
        s = _TestSettings()
        assert s.api_key == "from-env"

    def test_init_takes_priority_over_both(self, secrets_file, monkeypatch):
        secrets_file.set("API_KEY", "from-secrets")
        monkeypatch.setenv("API_KEY", "from-env")
        s = _TestSettings(api_key="from-init")
        assert s.api_key == "from-init"

    def test_only_matching_fields_populated(self, secrets_file):
        secrets_file.set("UNRELATED_SECRET", "value")
        s = _TestSettings()
        assert s.api_key is None

    def test_int_field_coerced_from_string(self, secrets_file):
        secrets_file.set("PORT", "9999")
        s = _TestSettings()
        assert s.port == 9999
