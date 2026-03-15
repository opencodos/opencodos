from __future__ import annotations

import json

import pytest

from backend.codos_utils.secrets.protocol import SecretsBackend, SecretsBackendType
from backend.codos_utils.secrets.registry import SecretsBackendRegistry


@pytest.fixture()
def config_dir(tmp_path, monkeypatch):
    config_file = tmp_path / "config.json"
    monkeypatch.setattr("backend.codos_utils.secrets.registry.CONFIG_FILE", config_file)
    return config_file


class TestReadBackendType:
    def test_defaults_to_json_file(self, config_dir):
        registry = SecretsBackendRegistry()
        assert registry.read_backend_type() == SecretsBackendType.JSON_FILE

    def test_reads_from_config(self, config_dir):
        config_dir.write_text(json.dumps({"secrets_backend": "json_file"}))
        registry = SecretsBackendRegistry()
        assert registry.read_backend_type() == SecretsBackendType.JSON_FILE

    def test_missing_key_defaults(self, config_dir):
        config_dir.write_text(json.dumps({"other_key": "value"}))
        registry = SecretsBackendRegistry()
        assert registry.read_backend_type() == SecretsBackendType.JSON_FILE

    def test_invalid_backend_raises(self, config_dir):
        config_dir.write_text(json.dumps({"secrets_backend": "nonexistent"}))
        registry = SecretsBackendRegistry()
        with pytest.raises(ValueError, match="is not a valid SecretsBackendType"):
            registry.read_backend_type()

    def test_corrupt_json_raises(self, config_dir):
        config_dir.write_text("not json{{{")
        registry = SecretsBackendRegistry()
        with pytest.raises(json.JSONDecodeError):
            registry.read_backend_type()


class TestDiscovery:
    def test_discovers_json_file_backend(self):
        registry = SecretsBackendRegistry()
        registry._discover()
        assert SecretsBackendType.JSON_FILE in registry._backends

    def test_discover_is_idempotent(self):
        registry = SecretsBackendRegistry()
        registry._discover()
        first = dict(registry._backends)
        registry._discover()
        assert registry._backends == first


class TestGet:
    def test_returns_secrets_backend(self, config_dir):
        registry = SecretsBackendRegistry()
        backend = registry.get()
        assert isinstance(backend, SecretsBackend)

    def test_returns_json_file_backend_by_default(self, config_dir):
        from backend.codos_utils.secrets.json_file import JsonFileBackend

        registry = SecretsBackendRegistry()
        backend = registry.get()
        assert isinstance(backend, JsonFileBackend)

    def test_unimplemented_backend_raises(self, config_dir):
        config_dir.write_text(json.dumps({"secrets_backend": "json_file"}))
        registry = SecretsBackendRegistry()
        registry._discovered = True
        registry._backends = {}
        with pytest.raises(NotImplementedError, match="not yet implemented"):
            registry.get()
