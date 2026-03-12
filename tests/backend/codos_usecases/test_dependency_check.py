"""Tests for dependency_check use-case."""

from __future__ import annotations

from types import SimpleNamespace

from backend.codos_models.exceptions import DependencyNotInstalledException
from backend.codos_usecases.dependency_check import (
    check_claude_login,
    get_bun_info,
    get_claude_info,
)


class TestGetClaudeInfo:
    def test_not_found(self, monkeypatch):
        monkeypatch.setattr(
            "backend.codos_usecases.dependency_check.find_claude",
            lambda: None,
        )
        installed, version, path = get_claude_info()
        assert installed is False
        assert version is None
        assert path is None

    def test_found_with_version(self, monkeypatch):
        monkeypatch.setattr(
            "backend.codos_usecases.dependency_check.find_claude",
            lambda: "/usr/local/bin/claude",
        )
        monkeypatch.setattr(
            "backend.codos_usecases.dependency_check.subprocess.run",
            lambda *a, **kw: SimpleNamespace(returncode=0, stdout="1.2.3\n", stderr=""),
        )
        installed, version, path = get_claude_info()
        assert installed is True
        assert version == "1.2.3"
        assert path == "/usr/local/bin/claude"

    def test_returncode_127(self, monkeypatch):
        monkeypatch.setattr(
            "backend.codos_usecases.dependency_check.find_claude",
            lambda: "/usr/local/bin/claude",
        )
        monkeypatch.setattr(
            "backend.codos_usecases.dependency_check.subprocess.run",
            lambda *a, **kw: SimpleNamespace(returncode=127, stdout="", stderr="node not found"),
        )
        installed, version, path = get_claude_info()
        assert installed is False
        assert version is None
        assert path == "/usr/local/bin/claude"

    def test_exception_assumes_installed(self, monkeypatch):
        monkeypatch.setattr(
            "backend.codos_usecases.dependency_check.find_claude",
            lambda: "/usr/local/bin/claude",
        )

        def _raise(*a, **kw):
            raise OSError("boom")

        monkeypatch.setattr(
            "backend.codos_usecases.dependency_check.subprocess.run",
            _raise,
        )
        installed, version, path = get_claude_info()
        assert installed is True
        assert version is None
        assert path == "/usr/local/bin/claude"


class TestCheckClaudeLogin:
    def test_not_found(self, monkeypatch):
        monkeypatch.setattr(
            "backend.codos_usecases.dependency_check.find_claude",
            lambda: None,
        )
        logged_in, email, debug = check_claude_login()
        assert logged_in is False
        assert "not found" in debug

    def test_logged_in_json(self, monkeypatch):
        monkeypatch.setattr(
            "backend.codos_usecases.dependency_check.find_claude",
            lambda: "/usr/local/bin/claude",
        )
        monkeypatch.setattr(
            "backend.codos_usecases.dependency_check.subprocess.run",
            lambda *a, **kw: SimpleNamespace(
                returncode=0,
                stdout='{"loggedIn": true, "email": "user@example.com"}',
                stderr="",
            ),
        )
        logged_in, email, debug = check_claude_login()
        assert logged_in is True
        assert email == "user@example.com"
        assert debug is None

    def test_not_logged_in_json(self, monkeypatch):
        monkeypatch.setattr(
            "backend.codos_usecases.dependency_check.find_claude",
            lambda: "/usr/local/bin/claude",
        )
        monkeypatch.setattr(
            "backend.codos_usecases.dependency_check.subprocess.run",
            lambda *a, **kw: SimpleNamespace(
                returncode=1,
                stdout='{"loggedIn": false}',
                stderr="",
            ),
        )
        logged_in, email, debug = check_claude_login()
        assert logged_in is False
        assert debug is not None

    def test_json_in_stderr(self, monkeypatch):
        monkeypatch.setattr(
            "backend.codos_usecases.dependency_check.find_claude",
            lambda: "/usr/local/bin/claude",
        )
        monkeypatch.setattr(
            "backend.codos_usecases.dependency_check.subprocess.run",
            lambda *a, **kw: SimpleNamespace(
                returncode=1,
                stdout="",
                stderr='{"loggedIn": true, "email": "test@test.com"}',
            ),
        )
        logged_in, email, debug = check_claude_login()
        assert logged_in is True
        assert email == "test@test.com"

    def test_no_json_output(self, monkeypatch):
        monkeypatch.setattr(
            "backend.codos_usecases.dependency_check.find_claude",
            lambda: "/usr/local/bin/claude",
        )
        monkeypatch.setattr(
            "backend.codos_usecases.dependency_check.subprocess.run",
            lambda *a, **kw: SimpleNamespace(
                returncode=1,
                stdout="garbage output",
                stderr="more garbage",
            ),
        )
        logged_in, email, debug = check_claude_login()
        assert logged_in is False
        assert debug is not None

    def test_exception_assumes_logged_in(self, monkeypatch):
        monkeypatch.setattr(
            "backend.codos_usecases.dependency_check.find_claude",
            lambda: "/usr/local/bin/claude",
        )

        def _raise(*a, **kw):
            raise OSError("boom")

        monkeypatch.setattr(
            "backend.codos_usecases.dependency_check.subprocess.run",
            _raise,
        )
        logged_in, email, debug = check_claude_login()
        assert logged_in is True


class TestGetBunInfo:
    def test_not_installed(self, monkeypatch):
        def _raise():
            raise DependencyNotInstalledException("bun not found")

        monkeypatch.setattr(
            "backend.codos_usecases.dependency_check.settings",
            type("S", (), {"bun_path": property(lambda self: _raise())})(),
        )
        installed, version, path = get_bun_info()
        assert installed is False
        assert version is None

    def test_installed(self, monkeypatch):
        monkeypatch.setattr(
            "backend.codos_usecases.dependency_check.settings",
            type("S", (), {"bun_path": "/usr/local/bin/bun"})(),
        )
        monkeypatch.setattr(
            "backend.codos_usecases.dependency_check.subprocess.run",
            lambda *a, **kw: SimpleNamespace(returncode=0, stdout="1.0.0\n"),
        )
        installed, version, path = get_bun_info()
        assert installed is True
        assert version == "1.0.0"
        assert path == "/usr/local/bin/bun"
