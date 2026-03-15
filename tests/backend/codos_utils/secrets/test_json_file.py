from __future__ import annotations

import json
import os
import stat

import pytest

from backend.codos_utils.secrets.json_file import JsonFileBackend
from backend.codos_utils.secrets.protocol import SecretsBackend, SecretsBackendType


@pytest.fixture()
def backend(tmp_path):
    return JsonFileBackend(path=tmp_path / "secrets.json")


class TestJsonFileBackendType:
    def test_returns_json_file(self, backend):
        assert backend.backend_type() == SecretsBackendType.JSON_FILE

    def test_satisfies_protocol(self, backend):
        assert isinstance(backend, SecretsBackend)


class TestGetSet:
    def test_get_missing_key_returns_none(self, backend):
        assert backend.get("NO_SUCH_KEY") is None

    def test_set_then_get(self, backend):
        backend.set("API_KEY", "secret123")
        assert backend.get("API_KEY") == "secret123"

    def test_set_overwrites_existing(self, backend):
        backend.set("KEY", "old")
        backend.set("KEY", "new")
        assert backend.get("KEY") == "new"

    def test_get_all_empty(self, backend):
        assert backend.get_all() == {}

    def test_get_all_returns_all_secrets(self, backend):
        backend.set("A", "1")
        backend.set("B", "2")
        assert backend.get_all() == {"A": "1", "B": "2"}


class TestDelete:
    def test_delete_existing_key(self, backend):
        backend.set("KEY", "val")
        backend.delete("KEY")
        assert backend.get("KEY") is None

    def test_delete_missing_key_is_noop(self, backend):
        backend.delete("NO_SUCH_KEY")


class TestFilePersistence:
    def test_file_created_on_first_write(self, backend):
        assert not backend._path.exists()
        backend.set("KEY", "val")
        assert backend._path.exists()

    def test_file_has_correct_permissions(self, backend):
        backend.set("KEY", "val")
        mode = stat.S_IMODE(os.stat(backend._path).st_mode)
        assert mode == 0o600

    def test_file_format_is_envelope(self, backend):
        backend.set("KEY", "val")
        with open(backend._path) as f:
            data = json.load(f)
        assert data == {"secrets": {"KEY": "val"}}

    def test_separate_instances_share_file(self, tmp_path):
        path = tmp_path / "secrets.json"
        a = JsonFileBackend(path=path)
        b = JsonFileBackend(path=path)
        a.set("KEY", "from_a")
        assert b.get("KEY") == "from_a"

    def test_read_nonexistent_file_returns_empty(self, tmp_path):
        backend = JsonFileBackend(path=tmp_path / "does_not_exist.json")
        assert backend.get_all() == {}


class TestWriteFailure:
    def test_exception_during_write_cleans_up_temp_file(self, backend, monkeypatch):
        backend.set("EXISTING", "val")

        monkeypatch.setattr(os, "rename", lambda *_: (_ for _ in ()).throw(OSError("disk error")))

        with pytest.raises(OSError, match="disk error"):
            backend.set("NEW", "val2")

        # Original file untouched
        assert backend.get("EXISTING") == "val"
        # No leftover temp files
        temps = list(backend._path.parent.glob(".secrets_*.tmp"))
        assert temps == []


class TestCorruptFile:
    def test_corrupt_json_raises(self, backend):
        backend._path.parent.mkdir(parents=True, exist_ok=True)
        backend._path.write_text("not valid json{{{")
        with pytest.raises(json.JSONDecodeError):
            backend.get("KEY")
