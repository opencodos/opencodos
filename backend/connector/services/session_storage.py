"""SQLite storage for chat sessions."""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime
from pathlib import Path

from ..settings import DB_PATH

# Legacy DB path from before the .atlas -> .codos rename
_LEGACY_DB_PATH = Path.home() / ".atlas" / "sessions.db"

# Schema definition
SCHEMA = """
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    agent_id TEXT NOT NULL DEFAULT 'engineer',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    agent_id TEXT,
    tool_calls TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);

"""


_migration_done = False


def _migrate_legacy_db(conn: sqlite3.Connection) -> None:
    """One-time migration from ~/.atlas/sessions.db to ~/.codos/sessions.db."""
    global _migration_done
    if _migration_done or not _LEGACY_DB_PATH.exists():
        _migration_done = True
        return
    _migration_done = True

    try:
        legacy = sqlite3.connect(_LEGACY_DB_PATH)
        legacy.row_factory = sqlite3.Row

        # Migrate sessions
        rows = legacy.execute("SELECT id, title, agent_id, created_at, updated_at FROM sessions").fetchall()
        for row in rows:
            conn.execute(
                "INSERT OR IGNORE INTO sessions (id, title, agent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                (row["id"], row["title"], row["agent_id"], row["created_at"], row["updated_at"]),
            )

        # Migrate messages
        rows = legacy.execute(
            "SELECT id, session_id, role, content, agent_id, tool_calls, created_at FROM messages"
        ).fetchall()
        for row in rows:
            conn.execute(
                "INSERT OR IGNORE INTO messages (id, session_id, role, content, agent_id, tool_calls, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    row["id"],
                    row["session_id"],
                    row["role"],
                    row["content"],
                    row["agent_id"],
                    row["tool_calls"],
                    row["created_at"],
                ),
            )

        conn.commit()
        legacy.close()
        print(f"[session_storage] Migrated sessions from {_LEGACY_DB_PATH}")
    except Exception as e:
        print(f"[session_storage] Legacy migration skipped: {e}")


def init_db() -> sqlite3.Connection:
    """Initialize database and return connection."""
    # Ensure parent directory exists
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)

    # Connect with sensible defaults
    conn = sqlite3.connect(DB_PATH, detect_types=sqlite3.PARSE_DECLTYPES)
    conn.row_factory = sqlite3.Row

    # Apply schema
    conn.executescript(SCHEMA)
    conn.commit()

    # One-time migration from legacy ~/.atlas/ DB
    _migrate_legacy_db(conn)

    # Enforce referential integrity for all writes on this connection.
    conn.execute("PRAGMA foreign_keys = ON")

    return conn


def _row_to_dict(row: sqlite3.Row) -> dict:
    """Convert sqlite3.Row to dict."""
    return dict(row)


def get_sessions() -> list[dict]:
    """Return all sessions ordered by updated_at desc."""
    conn = init_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, title, agent_id, created_at, updated_at
        FROM sessions
        ORDER BY updated_at DESC
    """)
    sessions = [_row_to_dict(row) for row in cursor.fetchall()]
    conn.close()
    return sessions


def create_session(title: str, agent_id: str = "engineer") -> dict:
    """Create new session, return session dict with id."""
    conn = init_db()

    session_id = str(uuid.uuid4())
    now = datetime.now().isoformat()

    with conn:
        conn.execute(
            """
            INSERT INTO sessions (id, title, agent_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
        """,
            (session_id, title, agent_id, now, now),
        )

    conn.close()

    return {"id": session_id, "title": title, "agent_id": agent_id, "created_at": now, "updated_at": now}


def ensure_session(session_id: str, title: str = "New Chat", agent_id: str = "engineer") -> dict:
    """Ensure a session exists for a specific ID, creating it if needed."""
    conn = init_db()
    now = datetime.now().isoformat()

    with conn:
        conn.execute(
            """
            INSERT OR IGNORE INTO sessions (id, title, agent_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
        """,
            (session_id, title, agent_id, now, now),
        )

    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT id, title, agent_id, created_at, updated_at
        FROM sessions
        WHERE id = ?
    """,
        (session_id,),
    )
    row = cursor.fetchone()
    conn.close()

    if row:
        return _row_to_dict(row)

    raise RuntimeError(f"Failed to ensure session exists: {session_id}")


def get_session(session_id: str) -> dict | None:
    """Get single session by ID."""
    conn = init_db()
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT id, title, agent_id, created_at, updated_at
        FROM sessions
        WHERE id = ?
    """,
        (session_id,),
    )

    row = cursor.fetchone()
    conn.close()

    if row:
        return _row_to_dict(row)
    return None


def get_messages(session_id: str) -> list[dict]:
    """Get all messages for a session ordered by created_at."""
    conn = init_db()
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT id, session_id, role, content, agent_id, tool_calls, created_at
        FROM messages
        WHERE session_id = ?
        ORDER BY created_at ASC
    """,
        (session_id,),
    )

    messages = []
    for row in cursor.fetchall():
        msg = _row_to_dict(row)
        # Parse tool_calls JSON if present
        if msg["tool_calls"]:
            msg["tool_calls"] = json.loads(msg["tool_calls"])
        messages.append(msg)

    conn.close()
    return messages


def save_message(
    session_id: str, role: str, content: str, agent_id: str | None = None, tool_calls: list[dict] | None = None
) -> dict:
    """Save message to database, return message dict."""
    conn = init_db()

    message_id = str(uuid.uuid4())
    now = datetime.now().isoformat()
    tool_calls_json = json.dumps(tool_calls) if tool_calls else None

    with conn:
        # Insert message
        conn.execute(
            """
            INSERT INTO messages (id, session_id, role, content, agent_id, tool_calls, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
            (message_id, session_id, role, content, agent_id, tool_calls_json, now),
        )

        # Update session's updated_at timestamp
        conn.execute(
            """
            UPDATE sessions
            SET updated_at = ?
            WHERE id = ?
        """,
            (now, session_id),
        )

    conn.close()

    return {
        "id": message_id,
        "session_id": session_id,
        "role": role,
        "content": content,
        "agent_id": agent_id,
        "tool_calls": tool_calls,
        "created_at": now,
    }


def update_session_title(session_id: str, title: str) -> None:
    """Update session title (e.g., from first message)."""
    conn = init_db()
    now = datetime.now().isoformat()

    with conn:
        conn.execute(
            """
            UPDATE sessions
            SET title = ?, updated_at = ?
            WHERE id = ?
        """,
            (title, now, session_id),
        )

    conn.close()
