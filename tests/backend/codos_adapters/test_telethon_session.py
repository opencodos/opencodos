"""Tests for telethon session helpers."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from backend.codos_adapters.telethon.session import save_session_string, save_session_to_file


class TestSaveSessionString:
    def test_returns_session_string(self):
        client = MagicMock()
        client.session.save.return_value = "abc123session"
        assert save_session_string(client) == "abc123session"

    def test_raises_when_no_session(self):
        client = MagicMock()
        client.session = None
        with pytest.raises(RuntimeError, match="No session available"):
            save_session_string(client)


class TestSaveSessionToFile:
    def test_writes_session_to_path(self, tmp_path):
        client = MagicMock()
        client.session.save.return_value = "session-data"
        dest = tmp_path / "session.string"

        save_session_to_file(client, dest)

        assert dest.read_text() == "session-data"
