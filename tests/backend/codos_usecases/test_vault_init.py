"""Tests for vault_init use-case."""

from __future__ import annotations

from pathlib import Path

import pytest

from backend.codos_models.exceptions import InvalidInputError
from backend.codos_usecases.vault_init import (
    VAULT_FOLDERS,
    create_vault_folder_structure,
    create_vault_template_files,
    ensure_vault_dirs,
    is_placeholder_about_name,
    sanitize_workspace_name,
    seed_about_me_name,
    validate_workspace_name,
    write_goals_file,
)


class TestEnsureVaultDirs:
    def test_creates_all_folders(self, tmp_path: Path):
        ensure_vault_dirs(tmp_path)
        for folder in VAULT_FOLDERS:
            assert (tmp_path / folder).is_dir()

    def test_idempotent(self, tmp_path: Path):
        ensure_vault_dirs(tmp_path)
        ensure_vault_dirs(tmp_path)
        for folder in VAULT_FOLDERS:
            assert (tmp_path / folder).is_dir()


class TestCreateVaultFolderStructure:
    def test_creates_dirs_and_templates(self, tmp_path: Path):
        create_vault_folder_structure(tmp_path)
        assert (tmp_path / "Core Memory" / "About me.md").exists()
        assert (tmp_path / "Core Memory" / "Goals.md").exists()
        assert (tmp_path / "Core Memory" / "Learnings.md").exists()
        assert (tmp_path / "System.md").exists()


class TestCreateVaultTemplateFiles:
    def test_does_not_overwrite_existing(self, tmp_path: Path):
        core = tmp_path / "Core Memory"
        core.mkdir(parents=True)
        about_me = core / "About me.md"
        about_me.write_text("Custom content")

        create_vault_template_files(tmp_path)
        assert about_me.read_text() == "Custom content"


class TestIsPlaceholderAboutName:
    @pytest.mark.parametrize("value", ["", "user", "Unknown", "<!-- your name -->", "name", "  "])
    def test_placeholder_values(self, value):
        assert is_placeholder_about_name(value) is True

    @pytest.mark.parametrize("value", ["Alice", "Bob Smith", "john.doe"])
    def test_real_names(self, value):
        assert is_placeholder_about_name(value) is False


class TestSanitizeWorkspaceName:
    def test_removes_special_chars(self):
        assert sanitize_workspace_name("My Project!@#") == "My Project"

    def test_fallback_to_workspace(self):
        assert sanitize_workspace_name("!@#$") == "Workspace"

    def test_keeps_valid_name(self):
        assert sanitize_workspace_name("my-project_1") == "my-project_1"


class TestValidateWorkspaceName:
    def test_valid_name(self):
        assert validate_workspace_name("My Project") == "My Project"

    def test_empty_name_raises(self):
        with pytest.raises(InvalidInputError, match="required"):
            validate_workspace_name("")

    def test_traversal_raises(self):
        with pytest.raises(InvalidInputError, match="invalid"):
            validate_workspace_name("../bad")

    def test_dot_dot_raises(self):
        with pytest.raises(InvalidInputError, match="invalid"):
            validate_workspace_name("..")

    def test_special_chars_raises(self):
        with pytest.raises(InvalidInputError, match="invalid"):
            validate_workspace_name("my/project")


class TestSeedAboutMeName:
    def test_seeds_name_into_template(self, tmp_path: Path):
        create_vault_template_files(tmp_path)
        seed_about_me_name(tmp_path, "Alice Smith")
        content = (tmp_path / "Core Memory" / "About me.md").read_text()
        assert "Alice Smith" in content

    def test_does_not_overwrite_existing_name(self, tmp_path: Path):
        core = tmp_path / "Core Memory"
        core.mkdir(parents=True)
        about_me = core / "About me.md"
        about_me.write_text("# About Me\n\n## Background\n- Name: Bob Jones\n")

        seed_about_me_name(tmp_path, "Alice Smith")
        content = about_me.read_text()
        assert "Bob Jones" in content
        assert "Alice Smith" not in content

    def test_empty_name_is_noop(self, tmp_path: Path):
        create_vault_template_files(tmp_path)
        original = (tmp_path / "Core Memory" / "About me.md").read_text()
        seed_about_me_name(tmp_path, "")
        assert (tmp_path / "Core Memory" / "About me.md").read_text() == original


class TestWriteGoalsFile:
    def test_writes_goals(self, tmp_path: Path):
        write_goals_file(tmp_path, "Learn Python\nBuild a project")
        goals = (tmp_path / "Core Memory" / "Goals.md").read_text()
        assert "Learn Python" in goals
        assert "Build a project" in goals

    def test_strips_numbering(self, tmp_path: Path):
        write_goals_file(tmp_path, "1. First goal\n2. Second goal")
        goals = (tmp_path / "Core Memory" / "Goals.md").read_text()
        assert "1. First goal" in goals
        assert "2. Second goal" in goals

    def test_empty_goals_is_noop(self, tmp_path: Path):
        write_goals_file(tmp_path, "")
        assert not (tmp_path / "Core Memory" / "Goals.md").exists()

    def test_whitespace_goals_is_noop(self, tmp_path: Path):
        write_goals_file(tmp_path, "   \n  ")
        assert not (tmp_path / "Core Memory" / "Goals.md").exists()
