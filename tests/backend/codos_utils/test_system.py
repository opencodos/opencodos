"""Tests for system utilities."""

from __future__ import annotations

from backend.codos_utils.system import get_system_name, get_system_timezone


class TestGetSystemName:
    def test_returns_string(self):
        result = get_system_name()
        assert isinstance(result, str)
        assert len(result) > 0

    def test_falls_back_to_env(self, monkeypatch):
        monkeypatch.setattr(
            "backend.codos_utils.system.subprocess.run",
            lambda *a, **kw: (_ for _ in ()).throw(FileNotFoundError),
        )
        monkeypatch.setenv("USER", "testuser")
        assert get_system_name() == "testuser"

    def test_falls_back_to_default(self, monkeypatch):
        monkeypatch.setattr(
            "backend.codos_utils.system.subprocess.run",
            lambda *a, **kw: (_ for _ in ()).throw(FileNotFoundError),
        )
        monkeypatch.delenv("USER", raising=False)
        assert get_system_name() == "User"


class TestGetSystemTimezone:
    def test_returns_string(self):
        result = get_system_timezone()
        assert isinstance(result, str)
        assert len(result) > 0

    def test_falls_back_to_tz_env(self, monkeypatch, tmp_path):
        monkeypatch.setattr(
            "backend.codos_utils.system.Path",
            lambda _: tmp_path / "nonexistent",
        )
        monkeypatch.setenv("TZ", "Europe/Berlin")
        assert get_system_timezone() == "Europe/Berlin"

    def test_falls_back_to_utc(self, monkeypatch, tmp_path):
        monkeypatch.setattr(
            "backend.codos_utils.system.Path",
            lambda _: tmp_path / "nonexistent",
        )
        monkeypatch.delenv("TZ", raising=False)
        assert get_system_timezone() == "UTC"
