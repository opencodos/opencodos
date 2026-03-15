from __future__ import annotations

from pathlib import Path

import pytest

from backend.codos_models.exceptions import DependencyNotInstalledException
from backend.codos_models.settings import Settings, reload_settings


@pytest.fixture()
def s() -> Settings:
    return Settings()


class TestPathAccessors:
    def test_get_codos_path(self, s):
        result = s.get_codos_path()
        assert isinstance(result, Path)
        assert result == Path(s.codos_root).expanduser()

    def test_get_vault_path(self, s):
        result = s.get_vault_path()
        assert isinstance(result, Path)
        assert result == Path(s.vault_path).expanduser()

    def test_get_source_tree_root(self, s):
        assert s.get_source_tree_root() == s.get_codos_path()

    def test_get_log_dir_creates_directory(self, s, tmp_path, monkeypatch):
        monkeypatch.setattr("backend.codos_models.settings.LOGS_ROOT", tmp_path / "logs")
        result = s.get_log_dir()
        assert result.is_dir()

    def test_get_telegram_data_dir(self, s, tmp_path, monkeypatch):
        monkeypatch.setattr(s, "codos_data_dir", str(tmp_path))
        result = s.get_telegram_data_dir()
        assert result == tmp_path / "config" / "telegram"
        assert result.is_dir()

    def test_get_telegram_session_path(self, s, tmp_path, monkeypatch):
        monkeypatch.setattr(s, "codos_data_dir", str(tmp_path))
        assert s.get_telegram_session_path().name == "session.string"

    def test_get_telegram_config_path(self, s, tmp_path, monkeypatch):
        monkeypatch.setattr(s, "codos_data_dir", str(tmp_path))
        assert s.get_telegram_config_path().name == "config.yaml"

    def test_get_backend_venv_python(self, s):
        result = s.get_backend_venv_python()
        assert result == s.get_codos_path() / "backend" / ".venv" / "bin" / "python"


class TestBunPath:
    def test_bun_not_found_raises(self, s, monkeypatch):
        monkeypatch.setattr("shutil.which", lambda _: None)
        monkeypatch.setattr(Path, "home", lambda: Path("/nonexistent"))
        with pytest.raises(DependencyNotInstalledException, match="bun not found"):
            _ = s.bun_path


class TestReload:
    def test_reload_settings(self):
        import backend.codos_models.settings as mod

        original = mod.settings
        try:
            new = reload_settings()
            assert isinstance(new, Settings)
        finally:
            mod.settings = original

    def test_reload_picks_up_new_paths_json(self, tmp_path, monkeypatch):
        """reload_settings() must clear the lru_cache so new paths.json values take effect."""
        import json

        import backend.codos_models.settings as mod
        from backend.codos_utils.paths import load_paths

        original = mod.settings

        # Write a paths.json with new values
        paths_file = tmp_path / "paths.json"
        paths_file.write_text(json.dumps({"codos_path": "/new/codos", "vault_path": "/new/vault"}))
        monkeypatch.setattr("backend.codos_utils.paths.PATHS_FILE", paths_file)

        try:
            reloaded = reload_settings()
            assert reloaded.codos_root == "/new/codos"
            assert reloaded.vault_path == "/new/vault"
        finally:
            load_paths.cache_clear()
            mod.settings = original
