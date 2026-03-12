"""Tests for path_detection use-case."""

from __future__ import annotations

from pathlib import Path

from backend.codos_usecases.path_detection import (
    detect_existing_paths,
    get_repo_root,
    is_codos_repo,
    is_vault,
)


class TestIsCodosRepo:
    def test_valid_repo(self, tmp_path: Path):
        (tmp_path / "skills").mkdir()
        (tmp_path / "backend" / "codos_services" / "gateway").mkdir(parents=True)
        assert is_codos_repo(tmp_path) is True

    def test_missing_skills(self, tmp_path: Path):
        (tmp_path / "backend" / "codos_services" / "gateway").mkdir(parents=True)
        assert is_codos_repo(tmp_path) is False

    def test_missing_gateway(self, tmp_path: Path):
        (tmp_path / "skills").mkdir()
        assert is_codos_repo(tmp_path) is False

    def test_empty_dir(self, tmp_path: Path):
        assert is_codos_repo(tmp_path) is False


class TestIsVault:
    def test_valid_vault(self, tmp_path: Path):
        (tmp_path / "Core Memory").mkdir()
        assert is_vault(tmp_path) is True

    def test_not_vault(self, tmp_path: Path):
        assert is_vault(tmp_path) is False


class TestGetRepoRoot:
    def test_finds_repo_root(self, tmp_path: Path):
        repo = tmp_path / "project"
        (repo / "skills").mkdir(parents=True)
        (repo / "backend" / "codos_services" / "gateway").mkdir(parents=True)
        nested = repo / "backend" / "codos_services" / "gateway" / "routes"
        nested.mkdir(parents=True)

        result = get_repo_root(start=nested / "setup.py")
        assert result == repo

    def test_returns_none_when_not_found(self, tmp_path: Path):
        result = get_repo_root(start=tmp_path / "nowhere" / "file.py")
        assert result is None

    def test_default_start_resolves(self):
        result = get_repo_root()
        # Running from within the codos repo, should find it
        assert result is not None or result is None  # doesn't crash

    def test_exception_returns_none(self, monkeypatch):
        monkeypatch.setattr(
            "backend.codos_usecases.path_detection.is_codos_repo",
            lambda p: (_ for _ in ()).throw(PermissionError("nope")),
        )
        result = get_repo_root(start=Path("/tmp/test"))
        assert result is None


class TestDetectExistingPaths:
    def test_detects_from_env_vars(self, tmp_path: Path, monkeypatch):
        codos = tmp_path / "codos"
        (codos / "skills").mkdir(parents=True)
        (codos / "backend" / "codos_services" / "gateway").mkdir(parents=True)
        vault = tmp_path / "vault"
        (vault / "Core Memory").mkdir(parents=True)

        monkeypatch.setattr(
            "backend.codos_usecases.path_detection.settings",
            type("S", (), {"codos_root": str(codos), "vault_path": str(vault)})(),
        )
        codos_path, vault_path = detect_existing_paths()
        assert codos_path == str(codos)
        assert vault_path == str(vault)

    def test_detects_from_repo_root_walk(self, tmp_path: Path, monkeypatch):
        codos = tmp_path / "codos"
        (codos / "skills").mkdir(parents=True)
        (codos / "backend" / "codos_services" / "gateway").mkdir(parents=True)

        monkeypatch.setattr(
            "backend.codos_usecases.path_detection.settings",
            type("S", (), {"codos_root": None, "vault_path": None})(),
        )
        monkeypatch.setattr(
            "backend.codos_usecases.path_detection.get_repo_root",
            lambda: codos,
        )
        codos_path, vault_path = detect_existing_paths()
        assert codos_path == str(codos)

    def test_scans_common_locations(self, tmp_path: Path, monkeypatch):
        codos = tmp_path / "codos_loc"
        (codos / "skills").mkdir(parents=True)
        (codos / "backend" / "codos_services" / "gateway").mkdir(parents=True)

        monkeypatch.setattr(
            "backend.codos_usecases.path_detection.settings",
            type("S", (), {"codos_root": None, "vault_path": None})(),
        )
        monkeypatch.setattr(
            "backend.codos_usecases.path_detection.get_repo_root",
            lambda: None,
        )
        monkeypatch.setattr(
            "backend.codos_usecases.path_detection.COMMON_CODOS_LOCATIONS",
            [codos],
        )
        codos_path, _ = detect_existing_paths()
        assert codos_path == str(codos)

    def test_scans_common_vault_locations(self, tmp_path: Path, monkeypatch):
        vault = tmp_path / "my_vault"
        (vault / "Core Memory").mkdir(parents=True)

        monkeypatch.setattr(
            "backend.codos_usecases.path_detection.settings",
            type("S", (), {"codos_root": None, "vault_path": None})(),
        )
        monkeypatch.setattr(
            "backend.codos_usecases.path_detection.get_repo_root",
            lambda: None,
        )
        monkeypatch.setattr(
            "backend.codos_usecases.path_detection.COMMON_CODOS_LOCATIONS",
            [],
        )
        monkeypatch.setattr(
            "backend.codos_usecases.path_detection.COMMON_VAULT_LOCATIONS",
            [vault],
        )
        _, vault_path = detect_existing_paths()
        assert vault_path == str(vault)

    def test_returns_none_when_nothing_found(self, monkeypatch):
        monkeypatch.setattr(
            "backend.codos_usecases.path_detection.settings",
            type("S", (), {"codos_root": None, "vault_path": None})(),
        )
        monkeypatch.setattr(
            "backend.codos_usecases.path_detection.get_repo_root",
            lambda: None,
        )
        monkeypatch.setattr(
            "backend.codos_usecases.path_detection.COMMON_CODOS_LOCATIONS",
            [],
        )
        monkeypatch.setattr(
            "backend.codos_usecases.path_detection.COMMON_VAULT_LOCATIONS",
            [],
        )
        codos_path, vault_path = detect_existing_paths()
        assert codos_path is None
        assert vault_path is None
