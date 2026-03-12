"""Tests for dependency_install use-case."""

from __future__ import annotations

import subprocess

import pytest

from backend.codos_usecases.dependency_install import (
    INSTALLABLE_DEPS,
    auto_install_bun,
    install_dependency,
)


class TestInstallDependency:
    def test_unsupported_dependency(self):
        success, message, output = install_dependency("unknown_dep")
        assert success is False
        assert "not supported" in message.lower()
        assert output is None

    def test_already_installed(self, monkeypatch):
        monkeypatch.setitem(
            INSTALLABLE_DEPS,
            "test_dep",
            {"check": lambda: True, "cmd": ["echo", "ok"], "shell_reload": False},
        )
        success, message, output = install_dependency("test_dep")
        assert success is True
        assert "already installed" in message

    def test_bun_in_installable_deps(self):
        assert "bun" in INSTALLABLE_DEPS
        assert INSTALLABLE_DEPS["bun"]["shell_reload"] is True

    def test_successful_install(self, monkeypatch):
        monkeypatch.setitem(
            INSTALLABLE_DEPS,
            "test_dep",
            {"check": lambda: False, "cmd": ["echo", "installed"], "shell_reload": False},
        )
        success, message, output = install_dependency("test_dep")
        assert success is True
        assert "installed successfully" in message
        assert output is not None

    def test_successful_install_with_shell_reload(self, monkeypatch, tmp_path):
        bun_bin = tmp_path / ".bun" / "bin" / "bun"
        bun_bin.parent.mkdir(parents=True)
        bun_bin.touch()
        monkeypatch.setattr("backend.codos_usecases.dependency_install.Path.home", lambda: tmp_path)
        monkeypatch.setitem(
            INSTALLABLE_DEPS,
            "bun",
            {"check": lambda: False, "cmd": ["echo", "ok"], "shell_reload": True},
        )
        success, message, output = install_dependency("bun")
        assert success is True
        assert "restart your terminal" in message or "source" in message

    def test_failed_install(self, monkeypatch):
        monkeypatch.setitem(
            INSTALLABLE_DEPS,
            "test_dep",
            {"check": lambda: False, "cmd": ["bash", "-c", "echo fail >&2; exit 1"], "shell_reload": False},
        )
        success, message, output = install_dependency("test_dep")
        assert success is False
        assert "failed" in message.lower()

    def test_install_timeout(self, monkeypatch):
        def _timeout_run(*args, **kwargs):
            raise subprocess.TimeoutExpired(cmd="test", timeout=120)

        monkeypatch.setitem(
            INSTALLABLE_DEPS,
            "test_dep",
            {"check": lambda: False, "cmd": ["sleep", "999"], "shell_reload": False},
        )
        monkeypatch.setattr("backend.codos_usecases.dependency_install.subprocess.run", _timeout_run)
        success, message, output = install_dependency("test_dep")
        assert success is False
        assert "timed out" in message.lower()

    def test_install_generic_exception(self, monkeypatch):
        def _raise(*args, **kwargs):
            raise OSError("disk full")

        monkeypatch.setitem(
            INSTALLABLE_DEPS,
            "test_dep",
            {"check": lambda: False, "cmd": ["echo"], "shell_reload": False},
        )
        monkeypatch.setattr("backend.codos_usecases.dependency_install.subprocess.run", _raise)
        success, message, output = install_dependency("test_dep")
        assert success is False
        assert "disk full" in message


class TestAutoInstallBun:
    @pytest.mark.asyncio
    async def test_success(self, monkeypatch):
        monkeypatch.setattr(
            "backend.codos_usecases.dependency_install.subprocess.run",
            lambda *a, **kw: type("R", (), {"returncode": 0})(),
        )
        success, message = await auto_install_bun()
        assert success is True
        assert "successfully" in message

    @pytest.mark.asyncio
    async def test_failure(self, monkeypatch):
        monkeypatch.setattr(
            "backend.codos_usecases.dependency_install.subprocess.run",
            lambda *a, **kw: type("R", (), {"returncode": 1, "stderr": "err"})(),
        )
        success, message = await auto_install_bun()
        assert success is False

    @pytest.mark.asyncio
    async def test_timeout(self, monkeypatch):
        def _raise(*a, **kw):
            raise subprocess.TimeoutExpired(cmd="bash", timeout=120)

        monkeypatch.setattr("backend.codos_usecases.dependency_install.subprocess.run", _raise)
        success, message = await auto_install_bun()
        assert success is False
        assert "timed out" in message.lower()

    @pytest.mark.asyncio
    async def test_generic_exception(self, monkeypatch):
        def _raise(*a, **kw):
            raise OSError("boom")

        monkeypatch.setattr("backend.codos_usecases.dependency_install.subprocess.run", _raise)
        success, message = await auto_install_bun()
        assert success is False
        assert "boom" in message
