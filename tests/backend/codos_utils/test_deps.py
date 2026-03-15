from __future__ import annotations

from pathlib import Path

import pytest

from backend.codos_utils.deps import find_bun, find_claude

_real_exists = Path.exists


@pytest.fixture()
def _isolate_fs(monkeypatch, tmp_path):
    """Ensure only paths under tmp_path report as existing."""
    monkeypatch.setattr("shutil.which", lambda _: None)
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setattr(Path, "exists", lambda p: _real_exists(p) if str(p).startswith(str(tmp_path)) else False)


class TestFindBun:
    def test_found_in_path(self, monkeypatch):
        monkeypatch.setattr("shutil.which", lambda _: "/usr/local/bin/bun")
        assert find_bun() == "/usr/local/bin/bun"

    @pytest.mark.usefixtures("_isolate_fs")
    def test_found_in_home(self, tmp_path):
        bun = tmp_path / ".bun" / "bin" / "bun"
        bun.parent.mkdir(parents=True)
        bun.touch()
        assert find_bun() == str(bun)

    @pytest.mark.usefixtures("_isolate_fs")
    def test_not_found(self):
        assert find_bun() is None


class TestFindClaude:
    def test_found_in_path(self, monkeypatch):
        monkeypatch.setattr("shutil.which", lambda _: "/usr/local/bin/claude")
        assert find_claude() == "/usr/local/bin/claude"

    @pytest.mark.usefixtures("_isolate_fs")
    def test_found_in_common_path(self, tmp_path):
        claude = tmp_path / ".local" / "bin" / "claude"
        claude.parent.mkdir(parents=True)
        claude.touch()
        assert find_claude() == str(claude)

    @pytest.mark.usefixtures("_isolate_fs")
    def test_found_in_nvm(self, tmp_path):
        nvm_claude = tmp_path / ".nvm" / "versions" / "node" / "v22.0.0" / "bin" / "claude"
        nvm_claude.parent.mkdir(parents=True)
        nvm_claude.touch()
        assert find_claude() == str(nvm_claude)

    @pytest.mark.usefixtures("_isolate_fs")
    def test_found_in_fnm(self, tmp_path):
        fnm_claude = tmp_path / ".fnm" / "node-versions" / "v22.0.0" / "installation" / "bin" / "claude"
        fnm_claude.parent.mkdir(parents=True)
        fnm_claude.touch()
        assert find_claude() == str(fnm_claude)

    @pytest.mark.usefixtures("_isolate_fs")
    def test_not_found(self):
        assert find_claude() is None
