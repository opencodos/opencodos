import sqlite3

import pytest

from backend.connector.services import session_storage


def _configure_tmp_db(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(session_storage, "DB_PATH", tmp_path / "sessions.db")
    monkeypatch.setattr(session_storage, "_LEGACY_DB_PATH", tmp_path / "legacy.db")
    monkeypatch.setattr(session_storage, "_migration_done", False)


def test_ensure_session_uses_provided_id(monkeypatch, tmp_path):
    _configure_tmp_db(monkeypatch, tmp_path)

    session = session_storage.ensure_session("session-fixed-id", title="New Chat", agent_id="engineer")

    assert session["id"] == "session-fixed-id"
    loaded = session_storage.get_session("session-fixed-id")
    assert loaded is not None
    assert loaded["id"] == "session-fixed-id"


def test_save_message_rejects_unknown_session_when_fk_enabled(monkeypatch, tmp_path):
    _configure_tmp_db(monkeypatch, tmp_path)

    with pytest.raises(sqlite3.IntegrityError):
        session_storage.save_message(session_id="missing-session", role="user", content="hello")


def test_save_message_succeeds_after_ensure_session(monkeypatch, tmp_path):
    _configure_tmp_db(monkeypatch, tmp_path)

    session_storage.ensure_session("known-session", title="New Chat", agent_id="engineer")
    message = session_storage.save_message(session_id="known-session", role="user", content="hello")

    assert message["session_id"] == "known-session"
