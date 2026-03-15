"""Tests for path utilities."""

from __future__ import annotations

import pytest

from backend.codos_utils.paths import ensure_config_dir, mask_secret, normalize_path


class TestNormalizePath:
    def test_expands_tilde(self):
        result = normalize_path("~/some/dir")
        assert "~" not in str(result)
        assert result.is_absolute()

    def test_resolves_relative(self):
        result = normalize_path("./relative/path")
        assert result.is_absolute()


class TestEnsureConfigDir:
    def test_creates_and_returns(self, tmp_path, monkeypatch):
        config_dir = tmp_path / ".codos"
        monkeypatch.setattr("backend.codos_utils.paths.CODOS_CONFIG_DIR", config_dir)
        result = ensure_config_dir()
        assert result == config_dir
        assert config_dir.is_dir()

    def test_idempotent(self, tmp_path, monkeypatch):
        config_dir = tmp_path / ".codos"
        monkeypatch.setattr("backend.codos_utils.paths.CODOS_CONFIG_DIR", config_dir)
        ensure_config_dir()
        ensure_config_dir()
        assert config_dir.is_dir()


class TestMaskSecret:
    def test_long_secret(self):
        assert mask_secret("sk-1234567890abcdef") == "sk-1••••cdef"

    def test_short_secret(self):
        assert mask_secret("short") == "••••••••"

    def test_exactly_12_chars(self):
        assert mask_secret("123456789012") == "1234••••9012"

    def test_empty_string(self):
        assert mask_secret("") == ""


class TestLoadPaths:
    def test_raises_when_paths_file_missing(self, tmp_path, monkeypatch):
        monkeypatch.setattr(
            "backend.codos_utils.paths.PATHS_FILE",
            tmp_path / "nonexistent.json",
        )
        from backend.codos_utils.paths import load_paths

        load_paths.cache_clear()
        with pytest.raises(FileNotFoundError, match="not found"):
            load_paths()
        load_paths.cache_clear()
