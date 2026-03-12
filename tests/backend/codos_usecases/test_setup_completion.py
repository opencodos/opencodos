"""Tests for setup_completion use-case."""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from backend.codos_usecases.setup_completion import (
    copy_env_sh,
    generate_vault_claude_md,
    migrate_global_claude_md,
    save_api_keys,
    seed_config_json,
    setup_hooks,
    write_paths_json,
)


class TestWritePathsJson:
    def test_writes_valid_json(self, tmp_path: Path, monkeypatch):
        paths_file = tmp_path / "paths.json"
        monkeypatch.setattr("backend.codos_usecases.setup_completion.PATHS_FILE", paths_file)

        write_paths_json(tmp_path / "codos", tmp_path / "vault")
        data = json.loads(paths_file.read_text())
        assert data["codos_path"] == str(tmp_path / "codos")
        assert data["vault_path"] == str(tmp_path / "vault")
        assert "timezone" in data
        assert "created_at" in data


class TestCopyEnvSh:
    def test_copies_from_repo_root(self, tmp_path: Path, monkeypatch):
        config_dir = tmp_path / "config"
        config_dir.mkdir()
        monkeypatch.setattr("backend.codos_usecases.setup_completion.CODOS_CONFIG_DIR", config_dir)

        codos_path = tmp_path / "codos"
        codos_path.mkdir()
        (codos_path / "env.sh").write_text("#!/bin/bash\nexport FOO=bar")

        copy_env_sh(codos_path)
        dest = config_dir / "env.sh"
        assert dest.exists()
        assert "FOO=bar" in dest.read_text()

    def test_copies_from_dev_ops_fallback(self, tmp_path: Path, monkeypatch):
        config_dir = tmp_path / "config"
        config_dir.mkdir()
        monkeypatch.setattr("backend.codos_usecases.setup_completion.CODOS_CONFIG_DIR", config_dir)

        codos_path = tmp_path / "codos"
        ops_dir = codos_path / "dev" / "Ops"
        ops_dir.mkdir(parents=True)
        (ops_dir / "env.sh").write_text("#!/bin/bash\nexport BAR=baz")

        copy_env_sh(codos_path)
        dest = config_dir / "env.sh"
        assert dest.exists()
        assert "BAR=baz" in dest.read_text()

    def test_noop_when_no_env_sh(self, tmp_path: Path, monkeypatch):
        config_dir = tmp_path / "config"
        config_dir.mkdir()
        monkeypatch.setattr("backend.codos_usecases.setup_completion.CODOS_CONFIG_DIR", config_dir)

        codos_path = tmp_path / "codos"
        codos_path.mkdir()
        copy_env_sh(codos_path)
        assert not (config_dir / "env.sh").exists()


class TestGenerateVaultClaudeMd:
    def test_writes_claude_md(self, tmp_path: Path):
        vault_path = tmp_path / "vault"
        vault_path.mkdir()
        generate_vault_claude_md(str(vault_path), "/path/to/codos")
        claude_md = vault_path / "CLAUDE.md"
        assert claude_md.exists()
        content = claude_md.read_text()
        assert "/path/to/codos/CLAUDE.md" in content
        assert "Atlas" in content


class TestMigrateGlobalClaudeMd:
    def test_backs_up_atlas_content(self, tmp_path: Path):
        claude_dir = tmp_path / ".claude"
        claude_dir.mkdir()
        global_md = claude_dir / "CLAUDE.md"
        global_md.write_text("# Atlas instructions\nSome content")

        with patch("backend.codos_usecases.setup_completion.Path.home", return_value=tmp_path):
            migrate_global_claude_md()

        assert not global_md.exists()
        assert (claude_dir / "CLAUDE.md.bak").exists()

    def test_skips_non_atlas_content(self, tmp_path: Path):
        claude_dir = tmp_path / ".claude"
        claude_dir.mkdir()
        global_md = claude_dir / "CLAUDE.md"
        global_md.write_text("# My custom instructions")

        with patch("backend.codos_usecases.setup_completion.Path.home", return_value=tmp_path):
            migrate_global_claude_md()

        assert global_md.exists()

    def test_noop_when_no_file(self, tmp_path: Path):
        with patch("backend.codos_usecases.setup_completion.Path.home", return_value=tmp_path):
            migrate_global_claude_md()  # should not raise


class TestSetupHooks:
    def test_makes_scripts_executable(self, tmp_path: Path):
        hooks_dir = tmp_path / "backend" / "codos_services" / "gateway" / "hooks"
        hooks_dir.mkdir(parents=True)
        sh_hook = hooks_dir / "test.sh"
        sh_hook.write_text("#!/bin/bash\necho hi")
        sh_hook.chmod(0o644)
        ts_hook = hooks_dir / "test.ts"
        ts_hook.write_text("console.log('hi')")
        ts_hook.chmod(0o644)

        result = setup_hooks(str(tmp_path))
        assert result is True
        assert sh_hook.stat().st_mode & 0o111
        assert ts_hook.stat().st_mode & 0o111

    def test_returns_false_when_no_hooks_dir(self, tmp_path: Path):
        assert setup_hooks(str(tmp_path)) is False


class TestCopyEnvShOverwrite:
    def test_overwrites_existing_symlink(self, tmp_path: Path, monkeypatch):
        config_dir = tmp_path / "config"
        config_dir.mkdir()
        monkeypatch.setattr("backend.codos_usecases.setup_completion.CODOS_CONFIG_DIR", config_dir)

        codos_path = tmp_path / "codos"
        codos_path.mkdir()
        (codos_path / "env.sh").write_text("new content")
        # Create an existing file at dest
        dest = config_dir / "env.sh"
        dest.write_text("old content")

        copy_env_sh(codos_path)
        assert "new content" in dest.read_text()


class TestSeedConfigJson:
    def test_creates_config(self, tmp_path: Path, monkeypatch):
        config_file = tmp_path / "config.json"
        monkeypatch.setattr("backend.codos_usecases.setup_completion.CONFIG_FILE", config_file)

        seed_config_json(entity_id="ent-123", user_name="Alice")
        data = json.loads(config_file.read_text())
        assert data["entityId"] == "ent-123"
        assert data["userName"] == "Alice"
        assert "createdAt" in data

    def test_merges_with_existing(self, tmp_path: Path, monkeypatch):
        config_file = tmp_path / "config.json"
        config_file.write_text(json.dumps({"existingKey": "keep", "createdAt": "2025-01-01"}))
        monkeypatch.setattr("backend.codos_usecases.setup_completion.CONFIG_FILE", config_file)

        seed_config_json(entity_id="ent-456", user_name="Bob")
        data = json.loads(config_file.read_text())
        assert data["entityId"] == "ent-456"
        assert data["existingKey"] == "keep"
        assert data["createdAt"] == "2025-01-01"  # preserved

    def test_handles_corrupt_existing(self, tmp_path: Path, monkeypatch):
        config_file = tmp_path / "config.json"
        config_file.write_text("not json!")
        monkeypatch.setattr("backend.codos_usecases.setup_completion.CONFIG_FILE", config_file)

        seed_config_json(entity_id="ent-789", user_name="Carol")
        data = json.loads(config_file.read_text())
        assert data["entityId"] == "ent-789"

    def test_defaults_entity_and_name(self, tmp_path: Path, monkeypatch):
        config_file = tmp_path / "config.json"
        monkeypatch.setattr("backend.codos_usecases.setup_completion.CONFIG_FILE", config_file)
        monkeypatch.setattr("backend.codos_usecases.setup_completion.get_entity_id", lambda: "auto-ent")
        monkeypatch.setattr("backend.codos_usecases.setup_completion.get_system_name", lambda: "AutoUser")

        seed_config_json()
        data = json.loads(config_file.read_text())
        assert data["entityId"] == "auto-ent"
        assert data["userName"] == "AutoUser"


class TestMigrateGlobalClaudeMdException:
    def test_handles_read_exception(self, tmp_path: Path):
        claude_dir = tmp_path / ".claude"
        claude_dir.mkdir()
        global_md = claude_dir / "CLAUDE.md"
        global_md.write_text("Atlas content")
        global_md.chmod(0o000)

        with patch("backend.codos_usecases.setup_completion.Path.home", return_value=tmp_path):
            migrate_global_claude_md()  # should not raise

        global_md.chmod(0o644)  # restore for cleanup


class TestSaveApiKeys:
    def test_saves_anthropic_key(self, monkeypatch):
        saved = {}

        class FakeBackend:
            def set(self, key, value):
                saved[key] = value

        monkeypatch.setattr(
            "backend.codos_usecases.setup_completion.get_secrets_backend",
            lambda: FakeBackend(),
        )

        api_keys = SimpleNamespace(anthropic="sk-ant-123", parallel=None)
        result = save_api_keys(api_keys=api_keys)
        assert "ANTHROPIC_API_KEY" in result
        assert saved["ANTHROPIC_API_KEY"] == "sk-ant-123"
        assert "PARALLEL_API_KEY" not in result

    def test_saves_telegram_credentials(self, monkeypatch):
        saved = {}

        class FakeBackend:
            def set(self, key, value):
                saved[key] = value

        monkeypatch.setattr(
            "backend.codos_usecases.setup_completion.get_secrets_backend",
            lambda: FakeBackend(),
        )

        result = save_api_keys(
            telegram_bot_token="bot-token",
            authorized_user_ids="123, 456",
        )
        assert "TELEGRAM_BOT_TOKEN" in result
        assert "AUTHORIZED_USER_IDS" in result
        assert saved["AUTHORIZED_USER_IDS"] == "123,456"  # spaces stripped

    def test_noop_when_all_none(self, monkeypatch):
        class FakeBackend:
            def set(self, key, value):
                raise AssertionError("should not be called")

        monkeypatch.setattr(
            "backend.codos_usecases.setup_completion.get_secrets_backend",
            lambda: FakeBackend(),
        )
        result = save_api_keys()
        assert result == []
