"""Session manager for mapping Telegram chats to Claude Code sessions"""

import json
import uuid
from datetime import datetime
from pathlib import Path

from backend.codos_services.codos_bot.config import SESSIONS_FILE


class SessionManager:
    def __init__(self, filepath: Path = SESSIONS_FILE):
        self.filepath = filepath
        self.sessions = self._load()

    def _load(self) -> dict:
        """Load sessions from file"""
        if self.filepath.exists():
            try:
                with open(self.filepath) as f:
                    result: dict = json.load(f)
                    return result
            except (OSError, json.JSONDecodeError):
                return {}
        return {}

    def _save(self):
        """Save sessions to file"""
        self.filepath.parent.mkdir(parents=True, exist_ok=True)
        with open(self.filepath, "w") as f:
            json.dump(self.sessions, f, indent=2)

    def get_session_id(self, chat_id: int) -> str:
        """Get or create a session ID for a Telegram chat"""
        chat_key = str(chat_id)

        if chat_key not in self.sessions:
            self.sessions[chat_key] = {
                "session_id": str(uuid.uuid4()),
                "created_at": datetime.now().isoformat(),
                "last_used": datetime.now().isoformat(),
                "message_count": 0,
            }
            self._save()
        else:
            self.sessions[chat_key]["last_used"] = datetime.now().isoformat()
            self.sessions[chat_key]["message_count"] += 1
            self._save()

        session_id: str = self.sessions[chat_key]["session_id"]
        return session_id

    def reset_session(self, chat_id: int) -> str:
        """Create a new session for a chat, discarding the old one"""
        chat_key = str(chat_id)
        new_session_id = str(uuid.uuid4())

        self.sessions[chat_key] = {
            "session_id": new_session_id,
            "created_at": datetime.now().isoformat(),
            "last_used": datetime.now().isoformat(),
            "message_count": 0,
        }
        self._save()

        return new_session_id

    def get_session_info(self, chat_id: int) -> dict | None:
        """Get session info for a chat"""
        chat_key = str(chat_id)
        return self.sessions.get(chat_key)

    def list_sessions(self) -> dict:
        """List all sessions"""
        return self.sessions
