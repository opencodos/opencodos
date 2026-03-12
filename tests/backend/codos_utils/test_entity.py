"""Tests for entity_id utilities."""

from __future__ import annotations

import json

from backend.codos_utils.entity import (
    _generate_entity_id,
    _get_system_name,
    clear_cache,
    compute_current_user_entity,
    get_entity_id,
)


class TestGenerateEntityId:
    def test_deterministic(self):
        a = _generate_entity_id("alice")
        b = _generate_entity_id("alice")
        assert a == b

    def test_different_names_differ(self):
        assert _generate_entity_id("alice") != _generate_entity_id("bob")

    def test_returns_hex_string(self):
        result = _generate_entity_id("alice")
        assert len(result) == 16
        int(result, 16)  # should not raise


class TestGetEntityId:
    def test_reads_from_config(self, tmp_path, monkeypatch):
        clear_cache()
        config_file = tmp_path / "config.json"
        config_file.write_text(json.dumps({"entityId": "abc123"}))
        monkeypatch.setattr("backend.codos_utils.entity.CONFIG_FILE", config_file)

        result = get_entity_id()
        assert result == "abc123"
        clear_cache()

    def test_generates_and_persists_when_no_config(self, tmp_path, monkeypatch):
        clear_cache()
        config_file = tmp_path / "config.json"
        monkeypatch.setattr("backend.codos_utils.entity.CONFIG_FILE", config_file)

        result = get_entity_id()
        assert len(result) == 16

        data = json.loads(config_file.read_text())
        assert data["entityId"] == result
        clear_cache()

    def test_caches_value(self, tmp_path, monkeypatch):
        clear_cache()
        config_file = tmp_path / "config.json"
        config_file.write_text(json.dumps({"entityId": "cached_val"}))
        monkeypatch.setattr("backend.codos_utils.entity.CONFIG_FILE", config_file)

        first = get_entity_id()
        config_file.write_text(json.dumps({"entityId": "new_val"}))
        second = get_entity_id()
        assert first == second == "cached_val"
        clear_cache()


class TestClearCache:
    def test_clears_cached_value(self, tmp_path, monkeypatch):
        clear_cache()
        config_file = tmp_path / "config.json"
        config_file.write_text(json.dumps({"entityId": "old"}))
        monkeypatch.setattr("backend.codos_utils.entity.CONFIG_FILE", config_file)

        get_entity_id()
        config_file.write_text(json.dumps({"entityId": "new"}))
        clear_cache()
        assert get_entity_id() == "new"
        clear_cache()


class TestGetSystemName:
    def test_falls_back_on_subprocess_failure(self, monkeypatch):
        monkeypatch.setattr(
            "backend.codos_utils.entity.subprocess.run",
            lambda *a, **kw: (_ for _ in ()).throw(OSError("no id")),
        )
        monkeypatch.setenv("USER", "fallback_user")
        assert _get_system_name() == "fallback_user"

    def test_falls_back_to_default(self, monkeypatch):
        monkeypatch.setattr(
            "backend.codos_utils.entity.subprocess.run",
            lambda *a, **kw: (_ for _ in ()).throw(OSError("no id")),
        )
        monkeypatch.delenv("USER", raising=False)
        assert _get_system_name() == "user"


class TestGetEntityIdEdgeCases:
    def test_corrupt_config_generates_fresh(self, tmp_path, monkeypatch):
        clear_cache()
        config_file = tmp_path / "config.json"
        config_file.write_text("not json{{{")
        monkeypatch.setattr("backend.codos_utils.entity.CONFIG_FILE", config_file)

        result = get_entity_id()
        assert len(result) == 16
        # Should have overwritten the corrupt file
        data = json.loads(config_file.read_text())
        assert data["entityId"] == result
        clear_cache()

    def test_merges_into_existing_config(self, tmp_path, monkeypatch):
        clear_cache()
        config_file = tmp_path / "config.json"
        config_file.write_text(json.dumps({"otherKey": "keep_me"}))
        monkeypatch.setattr("backend.codos_utils.entity.CONFIG_FILE", config_file)

        result = get_entity_id()
        data = json.loads(config_file.read_text())
        assert data["entityId"] == result
        assert data["otherKey"] == "keep_me"
        clear_cache()

    def test_corrupt_config_during_persist(self, tmp_path, monkeypatch):
        clear_cache()
        config_file = tmp_path / "config.json"
        # First call: no file, generates and persists
        monkeypatch.setattr("backend.codos_utils.entity.CONFIG_FILE", config_file)
        get_entity_id()
        clear_cache()

        # Corrupt the file so re-read during persist hits JSONDecodeError
        config_file.write_text("corrupt!")
        result = get_entity_id()
        assert len(result) == 16
        clear_cache()


class TestComputeCurrentUserEntity:
    def test_returns_hex_string(self):
        result = compute_current_user_entity()
        assert len(result) == 16
        int(result, 16)
