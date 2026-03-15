"""
Context routes for the Atlas wizard.
Provides context data from Obsidian Vault for the ContextPanel component.
"""

import os
import re
import time
from datetime import datetime
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from backend.codos_models import settings as _settings_mod

from ..auth import require_api_key

# ==================== Configuration ====================

CACHE_TTL = 300  # 5 minutes
ALLOWED_VAULT_EXTENSIONS = {".md", ".pdf", ".doc", ".pptx"}
EXCLUDED_VAULT_DIRS = {".git", "node_modules", ".obsidian"}

router = APIRouter(prefix="/api/context", tags=["context"], dependencies=[Depends(require_api_key)])

# ==================== Pydantic Models ====================


class MemoryContext(BaseModel):
    name: str
    timezone: str
    location: str
    goals: list[str]  # First 5 goals
    preferences: dict  # Key-value pairs


class TodoStats(BaseModel):
    total: int
    completed: int
    pending: int
    date: str = ""  # Which date's todos were loaded
    is_fallback: bool = False  # True if fell back to previous day


class CalendarEvent(BaseModel):
    time: str
    title: str
    context: str | None = None


class TodayContext(BaseModel):
    morning_brief_time: str | None
    morning_brief_date: str = ""  # Which date's brief was loaded
    brief_is_fallback: bool = False  # True if fell back to previous day
    todos: TodoStats
    next_calls: list[CalendarEvent]
    calls_date: str = ""  # Which date's calendar calls were loaded
    calls_is_fallback: bool = False  # True if calendar fell back to previous day
    calls_source: str = "brief"  # "calendar" | "brief"
    summary: str | None = None
    is_stale: bool = False  # True if any data is from past


class LearningItem(BaseModel):
    text: str
    timestamp: str
    source: str | None = None


class ContextResponse(BaseModel):
    memory: MemoryContext
    today: TodayContext
    learnings: list[LearningItem]


class VaultFileResponse(BaseModel):
    path: str
    content: str
    exists: bool
    last_modified: str | None = None


class VaultFileSaveRequest(BaseModel):
    path: str
    content: str


class VaultFileSaveResponse(BaseModel):
    success: bool
    message: str


class VaultTreeEntry(BaseModel):
    name: str
    path: str
    kind: Literal["file", "dir"]
    extension: str | None = None
    size: int | None = None
    last_modified: str | None = None


class VaultTreeResponse(BaseModel):
    path: str
    vault_path: str
    entries: list[VaultTreeEntry]


class VaultSearchResponse(BaseModel):
    query: str
    vault_path: str
    matches: list[VaultTreeEntry]


# ==================== Cache ====================

_context_cache: dict[str, object] = {"data": None, "timestamp": 0.0}


def _get_watched_files() -> list[str]:
    """Key vault files — if any were modified after cache was set, invalidate."""
    today = datetime.now().strftime("%Y-%m-%d")
    return [
        "Core Memory/About me.md",
        "Core Memory/Goals.md",
        "Core Memory/Learnings.md",
        f"0 - Daily Briefs/{today}.md",
        f"3 - Todos/{today}.md",
    ]


def _load_vault_base_path() -> Path:
    return _settings_mod.settings.get_vault_path()


def _is_allowed_vault_file(path: Path) -> bool:
    return path.is_file() and path.suffix.lower() in ALLOWED_VAULT_EXTENSIONS


def _is_excluded_vault_dir(path: Path) -> bool:
    return path.is_dir() and path.name in EXCLUDED_VAULT_DIRS


def _ensure_within_vault(vault_base_path: Path, path: Path) -> Path:
    """Verify path is logically within vault, allowing symlinks.

    Uses os.path.normpath to collapse '..' without following symlinks,
    then checks containment. This prevents path traversal while allowing
    symlinked directories (e.g. shared vaults) inside the vault tree.
    """
    vault_norm = os.path.normpath(str(vault_base_path.expanduser()))
    target_norm = os.path.normpath(str(path.expanduser()))
    if not (target_norm == vault_norm or target_norm.startswith(vault_norm + os.sep)):
        raise HTTPException(status_code=400, detail="Invalid path")
    return path


def _resolve_vault_path(vault_base_path: Path, relative_path: str) -> Path:
    if relative_path and Path(relative_path).is_absolute():
        raise HTTPException(status_code=400, detail="Invalid path")

    target_path = vault_base_path / relative_path if relative_path else vault_base_path
    return _ensure_within_vault(vault_base_path, target_path)


def _vault_entry_from_path(vault_base_path: Path, entry: Path) -> VaultTreeEntry:
    rel_path = entry.relative_to(vault_base_path).as_posix()
    if entry.is_dir():
        return VaultTreeEntry(
            name=entry.name,
            path=rel_path,
            kind="dir",
        )

    stat = entry.stat()
    extension = entry.suffix.lower().lstrip(".") or None
    return VaultTreeEntry(
        name=entry.name,
        path=rel_path,
        kind="file",
        extension=extension,
        size=stat.st_size,
        last_modified=datetime.fromtimestamp(stat.st_mtime).isoformat(),
    )


def _is_cache_valid() -> bool:
    """Check if cache is still valid (TTL + file mtime check)."""
    cache_time_raw = _context_cache.get("timestamp", 0.0)
    cache_time = float(cache_time_raw) if isinstance(cache_time_raw, (int, float)) else 0.0
    if time.time() - cache_time >= CACHE_TTL:
        return False
    # Invalidate if any watched vault file was modified after cache was set
    try:
        vault = _load_vault_base_path()
        for rel in _get_watched_files():
            p = vault / rel
            if p.exists() and p.stat().st_mtime > cache_time:
                return False
    except Exception:
        pass
    return True


def _get_cached_data() -> ContextResponse | None:
    """Get cached data if valid."""
    if _is_cache_valid():
        data = _context_cache.get("data")
        if isinstance(data, ContextResponse):
            return data
    return None


def _set_cache(data: ContextResponse) -> None:
    """Update cache with new data."""
    _context_cache["data"] = data
    _context_cache["timestamp"] = time.time()


# ==================== Parser Functions ====================


def parse_about_me(vault_path: Path) -> MemoryContext:
    """Parse Vault/Core Memory/About me.md and Goals.md"""
    about_me_path = vault_path / "Core Memory" / "About me.md"
    goals_path = vault_path / "Core Memory" / "Goals.md"

    # Default values
    name = "User"
    timezone = "UTC"
    location = "Unknown"
    goals = []
    preferences = {}

    def clean_value(value: str) -> str:
        """Remove inline markdown/template artifacts from parsed values."""
        cleaned = re.sub(r"<!--.*?-->", "", value).strip()
        cleaned = cleaned.replace("->", "").strip()
        cleaned = re.sub(r"[,\-\s]+$", "", cleaned).strip()
        return cleaned

    # Parse About me.md for name, timezone, location, preferences
    if about_me_path.exists():
        try:
            with open(about_me_path, encoding="utf-8") as f:
                content = f.read()

            # Extract name (first line with "Name" or from first paragraph)
            name_match = re.search(r"Name[^:]*:\s*(.+?)(?:\n|$)", content, re.IGNORECASE)
            if name_match:
                name = clean_value(name_match.group(1))

            # Extract timezone
            timezone_match = re.search(r"timezone[^:]*:\s*(.+?)(?:\n|$)", content, re.IGNORECASE)
            if timezone_match:
                timezone = clean_value(timezone_match.group(1))

            # Extract location
            location_match = re.search(r"(?:Current )?location[^:]*:\s*(.+?)(?:\n|$)", content, re.IGNORECASE)
            if location_match:
                location = clean_value(location_match.group(1))

            # Extract preferences
            prefs_section = re.search(r"###\s*Preferences(.*?)(?=\n###|\n##|$)", content, re.DOTALL | re.IGNORECASE)
            if prefs_section:
                prefs_text = prefs_section.group(1)
                # Extract bullet points with key-value pairs
                pref_matches = re.findall(r"-\s*\*\*(.+?):\*\*\s*(.+?)(?:\n|$)", prefs_text)
                preferences = {key.strip(): value.strip() for key, value in pref_matches}

        except Exception:
            pass

    # Parse Goals.md for goals (separate file)
    if goals_path.exists():
        try:
            with open(goals_path, encoding="utf-8") as f:
                goals_content = f.read()

            # Extract goals (look for "### Short-term goals" or "### My 2026 Goals:")
            goals_section = re.search(
                r"###\s*(?:Short-term goals|My \d+ Goals:?)(.*?)(?=\n###|\n##|$)",
                goals_content,
                re.DOTALL | re.IGNORECASE,
            )
            if goals_section:
                goals_text = goals_section.group(1)
                # Extract numbered list items
                goal_matches = re.findall(r"^\d+\.\s*(.+?)$", goals_text, re.MULTILINE)
                goals = [g.strip() for g in goal_matches[:5]]  # First 5 goals

        except Exception:
            pass

    return MemoryContext(name=name, timezone=timezone, location=location, goals=goals, preferences=preferences)


def parse_daily_brief(vault_path: Path) -> dict:
    """Parse Vault/0 - Daily Briefs/{today}.md"""
    from datetime import timedelta

    today = datetime.now().strftime("%Y-%m-%d")
    brief_path = vault_path / "0 - Daily Briefs" / f"{today}.md"
    loaded_date = today
    is_fallback = False

    # Try yesterday if today doesn't exist
    if not brief_path.exists():
        yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
        brief_path = vault_path / "0 - Daily Briefs" / f"{yesterday}.md"
        loaded_date = yesterday
        is_fallback = True

    morning_brief_time = None
    next_calls: list[CalendarEvent] = []
    summary = None

    if not brief_path.exists():
        return {
            "morning_brief_time": morning_brief_time,
            "morning_brief_date": today,  # No file exists, use today
            "is_fallback": False,
            "next_calls": next_calls,
            "summary": summary,
        }

    try:
        with open(brief_path, encoding="utf-8") as f:
            content = f.read()

        # Extract brief generation time from header
        header_match = re.search(r"# Morning Brief — (.+?)(?:\n|$)", content)
        if header_match:
            morning_brief_time = header_match.group(1).strip()

        # Extract summary from "Your Priorities Status" or "System Synthesis" section
        summary_match = re.search(
            r"## (?:\d+\.\s*)?(?:Your Priorities Status|System Synthesis)\s*(?:\*\*.*?\*\*)?\s*(.+?)(?=\n##|$)",
            content,
            re.DOTALL,
        )
        if summary_match:
            summary = summary_match.group(1).strip()

        # Extract calendar events from "Today's Schedule" or "People to Follow Up" tables
        # Look for schedule table with time column
        schedule_table = re.search(
            r"\|\s*Time[^|]*\|\s*Event[^|]*\|[^\n]*\n\|[-\s|]+\n(.*?)(?=\n##|\n\n|$)", content, re.DOTALL
        )
        if schedule_table:
            table_content = schedule_table.group(1)
            # Parse rows: | time | event | prep |
            # Split by newline to handle each row
            lines = [line.strip() for line in table_content.split("\n") if line.strip()]
            for line in lines[:5]:  # Max 5 events
                # Match table row pattern
                match = re.match(r"\|\s*([^|]+)\|\s*([^|]+)\|", line)
                if match:
                    time_str = match.group(1).strip()
                    event = match.group(2).strip()
                    if time_str and event and time_str != "---":
                        # Extract start time (format: HH:MM-HH:MM or just HH:MM)
                        time_match = re.search(r"(\d{1,2}:\d{2})", time_str)
                        if time_match:
                            time_val = time_match.group(1)
                            # Extract event title (often has person names before /)
                            event_parts = event.split("/")
                            title = event_parts[0].strip() if event_parts else event
                            next_calls.append(CalendarEvent(time=time_val, title=title, context=None))
        else:
            # Fallback 1: Parse section headings used by current brief template.
            # Example: "### 11:30-12:00 — Person A / Person B"
            heading_matches = re.findall(
                r"^\s*###\s*(\d{1,2}:\d{2})(?:\s*-\s*\d{1,2}:\d{2})?\s*[—-]\s*(.+?)\s*$",
                content,
                re.MULTILINE,
            )
            for time_val, raw_title in heading_matches:
                title = raw_title.strip()
                # Skip non-call schedule blocks.
                if re.search(r"\b(?:lunch|buffer)\b", title, re.IGNORECASE):
                    continue
                next_calls.append(
                    CalendarEvent(
                        time=time_val,
                        title=title,
                        context=None,
                    )
                )
                if len(next_calls) >= 5:
                    break

        if not next_calls:
            # Fallback: Try "People to Follow Up" table format
            table_match = re.search(
                r"\|\s*Name\s*\|\s*Context\s*\|\s*Action\s*\|(.*?)(?=\n##|\n\n|$)", content, re.DOTALL
            )
            if table_match:
                table_content = table_match.group(1)
                # Parse table rows
                rows = re.findall(r"\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|", table_content)
                for name, context, action in rows[:3]:  # Max 3 items
                    if name.strip() and name.strip() != "---":
                        next_calls.append(
                            CalendarEvent(
                                time="TBD", title=f"{name.strip()}", context=f"{context.strip()} - {action.strip()}"
                            )
                        )

    except Exception:
        # Return defaults on any parsing error
        pass

    return {
        "morning_brief_time": morning_brief_time,
        "morning_brief_date": loaded_date,
        "is_fallback": is_fallback,
        "next_calls": next_calls,
        "summary": summary,
    }


def parse_calendar_calls(vault_path: Path) -> dict:
    """Parse Vault Calendar sync output for today's calls.

    Source: Vault/1 - Inbox (Last 7 days)/Calendar/{date}.md
    """
    from datetime import timedelta

    today = datetime.now().strftime("%Y-%m-%d")
    calls_path = vault_path / "1 - Inbox (Last 7 days)" / "Calendar" / f"{today}.md"
    loaded_date = today
    is_fallback = False

    if not calls_path.exists():
        yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
        calls_path = vault_path / "1 - Inbox (Last 7 days)" / "Calendar" / f"{yesterday}.md"
        loaded_date = yesterday
        is_fallback = True

    if not calls_path.exists():
        return {
            "found": False,
            "calls_date": today,
            "is_fallback": False,
            "next_calls": [],
        }

    next_calls: list[CalendarEvent] = []
    try:
        content = calls_path.read_text(encoding="utf-8")

        # Parse table rows: | HH:MM - HH:MM | Title | Attendees | Link |
        for raw_line in content.splitlines():
            line = raw_line.strip()
            if not line.startswith("|"):
                continue
            if "Time" in line and "Event" in line:
                continue
            if line.startswith("|---"):
                continue

            parts = [p.strip() for p in line.split("|")[1:-1]]
            if len(parts) < 2:
                continue

            time_range = parts[0]
            title = parts[1]
            attendees = parts[2] if len(parts) > 2 else ""

            if not title or title == "-":
                continue

            start_time = time_range.split("-")[0].strip() if "-" in time_range else time_range
            context = None if attendees in {"", "-"} else attendees
            next_calls.append(CalendarEvent(time=start_time, title=title, context=context))

            if len(next_calls) >= 5:
                break
    except Exception:
        next_calls = []

    return {
        "found": True,
        "calls_date": loaded_date,
        "is_fallback": is_fallback,
        "next_calls": next_calls,
    }


def parse_todos(vault_path: Path) -> TodoStats:
    """Parse Vault/3 - Todos/{today}.md"""
    from datetime import timedelta

    today = datetime.now().strftime("%Y-%m-%d")
    todo_path = vault_path / "3 - Todos" / f"{today}.md"
    loaded_date = today
    is_fallback = False

    # Try yesterday if today doesn't exist
    if not todo_path.exists():
        yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
        todo_path = vault_path / "3 - Todos" / f"{yesterday}.md"
        loaded_date = yesterday
        is_fallback = True

    total = 0
    completed = 0
    pending = 0

    if not todo_path.exists():
        return TodoStats(total=total, completed=completed, pending=pending, date=today, is_fallback=False)

    try:
        with open(todo_path, encoding="utf-8") as f:
            content = f.read()

        # Count completed tasks: - [x]
        completed = len(re.findall(r"^\s*-\s*\[x\]", content, re.MULTILINE | re.IGNORECASE))

        # Count pending tasks: - [ ]
        pending = len(re.findall(r"^\s*-\s*\[\s\]", content, re.MULTILINE))

        total = completed + pending

    except Exception:
        # Return defaults on any parsing error
        pass

    return TodoStats(total=total, completed=completed, pending=pending, date=loaded_date, is_fallback=is_fallback)


def parse_learnings(vault_path: Path) -> list[LearningItem]:
    """Parse Vault/Core Memory/Learnings.md"""
    learnings_path = vault_path / "Core Memory" / "Learnings.md"
    learnings: list[LearningItem] = []

    if not learnings_path.exists():
        return learnings

    try:
        with open(learnings_path, encoding="utf-8") as f:
            content = f.read()

        # Extract learning items with timestamps
        # Format: - [YYYY-MM-DD] **Title:** Description
        learning_matches = re.findall(
            r"-\s*\[([^\]]+)\]\s*\*\*([^:]+):\*\*\s*(.+?)(?=\n\s*-\s*\[|\n\n|$)", content, re.DOTALL
        )

        for timestamp, title, description in learning_matches[-5:]:  # Last 5 learnings
            learnings.append(
                LearningItem(
                    text=f"**{title.strip()}:** {description.strip()}",
                    timestamp=timestamp.strip(),
                    source="Core Memory",
                )
            )

    except Exception:
        # Return empty list on any parsing error
        pass

    return learnings


def _build_full_context() -> ContextResponse:
    """Build full context response from all vault files."""
    vault_path = _load_vault_base_path()
    memory = parse_about_me(vault_path)
    brief_data = parse_daily_brief(vault_path)
    calendar_calls = parse_calendar_calls(vault_path)
    todos = parse_todos(vault_path)
    learnings = parse_learnings(vault_path)

    # Determine if any data is stale (from a previous day)
    is_stale = brief_data.get("is_fallback", False) or todos.is_fallback

    today = TodayContext(
        morning_brief_time=brief_data["morning_brief_time"],
        morning_brief_date=brief_data.get("morning_brief_date", ""),
        brief_is_fallback=brief_data.get("is_fallback", False),
        todos=todos,
        next_calls=calendar_calls["next_calls"] if calendar_calls["found"] else brief_data["next_calls"],
        calls_date=calendar_calls["calls_date"]
        if calendar_calls["found"]
        else brief_data.get("morning_brief_date", ""),
        calls_is_fallback=calendar_calls["is_fallback"]
        if calendar_calls["found"]
        else brief_data.get("is_fallback", False),
        calls_source="calendar" if calendar_calls["found"] else "brief",
        summary=brief_data["summary"],
        is_stale=is_stale,
    )

    return ContextResponse(memory=memory, today=today, learnings=learnings)


# ==================== Route Handlers ====================


@router.get("", response_model=ContextResponse)
async def get_full_context():
    """Get full context (memory + today + learnings)."""
    # Check cache
    cached = _get_cached_data()
    if cached:
        return cached

    # Build fresh context
    context = _build_full_context()
    _set_cache(context)
    return context


@router.get("/memory", response_model=MemoryContext)
async def get_memory_context():
    """Get just memory/about me context."""
    return parse_about_me(_load_vault_base_path())


@router.get("/today", response_model=TodayContext)
async def get_today_context():
    """Get just today's context (brief + todos)."""
    vault_path = _load_vault_base_path()
    brief_data = parse_daily_brief(vault_path)
    calendar_calls = parse_calendar_calls(vault_path)
    todos = parse_todos(vault_path)

    is_stale = brief_data.get("is_fallback", False) or todos.is_fallback

    return TodayContext(
        morning_brief_time=brief_data["morning_brief_time"],
        morning_brief_date=brief_data.get("morning_brief_date", ""),
        brief_is_fallback=brief_data.get("is_fallback", False),
        todos=todos,
        next_calls=calendar_calls["next_calls"] if calendar_calls["found"] else brief_data["next_calls"],
        calls_date=calendar_calls["calls_date"]
        if calendar_calls["found"]
        else brief_data.get("morning_brief_date", ""),
        calls_is_fallback=calendar_calls["is_fallback"]
        if calendar_calls["found"]
        else brief_data.get("is_fallback", False),
        calls_source="calendar" if calendar_calls["found"] else "brief",
        summary=brief_data["summary"],
        is_stale=is_stale,
    )


@router.get("/learnings", response_model=list[LearningItem])
async def get_learnings():
    """Get just learnings."""
    return parse_learnings(_load_vault_base_path())


@router.get(
    "/vault/file",
    response_model=VaultFileResponse,
    dependencies=[Depends(require_api_key)],
)
async def get_vault_file(path: str):
    """Get raw content of a vault file."""
    vault_base_path = _load_vault_base_path()
    file_path = _resolve_vault_path(vault_base_path, path)

    if not file_path.exists():
        return VaultFileResponse(path=path, content="", exists=False)

    content = file_path.read_text(encoding="utf-8")
    stat = file_path.stat()

    return VaultFileResponse(
        path=path, content=content, exists=True, last_modified=datetime.fromtimestamp(stat.st_mtime).isoformat()
    )


@router.put(
    "/vault/file",
    response_model=VaultFileSaveResponse,
    dependencies=[Depends(require_api_key)],
)
async def save_vault_file(request: VaultFileSaveRequest):
    """Save content to a vault file."""
    vault_base_path = _load_vault_base_path()
    file_path = _resolve_vault_path(vault_base_path, request.path)

    # Create parent directories if needed
    file_path.parent.mkdir(parents=True, exist_ok=True)

    # Write file
    file_path.write_text(request.content, encoding="utf-8")

    # Invalidate cache since content changed
    global _context_cache
    _context_cache["data"] = None
    _context_cache["timestamp"] = 0

    return VaultFileSaveResponse(success=True, message=f"File saved: {request.path}")


@router.get(
    "/vault/tree",
    response_model=VaultTreeResponse,
    dependencies=[Depends(require_api_key)],
)
async def get_vault_tree(path: str = ""):
    """List vault directories and allowed files under a path."""
    vault_base_path = _load_vault_base_path()
    target_path = _resolve_vault_path(vault_base_path, path)

    if not target_path.exists() or not target_path.is_dir():
        raise HTTPException(status_code=404, detail="Directory not found")

    entries: list[VaultTreeEntry] = []
    for entry in target_path.iterdir():
        if _is_excluded_vault_dir(entry):
            continue
        if entry.is_dir():
            entries.append(_vault_entry_from_path(vault_base_path, entry))
            continue
        if _is_allowed_vault_file(entry):
            entries.append(_vault_entry_from_path(vault_base_path, entry))

    entries.sort(key=lambda e: (0 if e.kind == "dir" else 1, e.name.lower()))

    return VaultTreeResponse(
        path=path,
        vault_path=str(vault_base_path.resolve()),
        entries=entries,
    )


@router.get(
    "/vault/search",
    response_model=VaultSearchResponse,
    dependencies=[Depends(require_api_key)],
)
async def search_vault(query: str, limit: int = 200):
    """Search vault file names (allowed file types only)."""
    vault_base_path = _load_vault_base_path()
    if not vault_base_path.exists():
        raise HTTPException(status_code=404, detail="Vault not found")
    query_value = query.strip()
    if not query_value:
        return VaultSearchResponse(query=query, vault_path=str(vault_base_path.resolve()), matches=[])

    matches: list[VaultTreeEntry] = []
    query_lower = query_value.casefold()

    for root, dirs, files in os.walk(vault_base_path):
        # Skip excluded directories
        dirs[:] = [d for d in dirs if d not in EXCLUDED_VAULT_DIRS]

        for filename in files:
            candidate = Path(root) / filename
            if not _is_allowed_vault_file(candidate):
                continue

            name_match = query_lower in filename.casefold()
            content_match = False

            if not name_match and candidate.suffix.lower() == ".md":
                try:
                    content = candidate.read_text(encoding="utf-8", errors="ignore")
                    content_match = query_lower in content.casefold()
                except Exception:
                    content_match = False

            if not name_match and not content_match:
                continue

            matches.append(_vault_entry_from_path(vault_base_path, candidate))
            if len(matches) >= limit:
                break

        if len(matches) >= limit:
            break

    matches.sort(key=lambda e: e.name.lower())

    return VaultSearchResponse(
        query=query_value,
        vault_path=str(vault_base_path.resolve()),
        matches=matches,
    )


@router.get(
    "/vault/file/download",
    dependencies=[Depends(require_api_key)],
)
async def download_vault_file(path: str):
    """Download a vault file (allowed file types only)."""
    vault_base_path = _load_vault_base_path()
    file_path = _resolve_vault_path(vault_base_path, path)

    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    if not _is_allowed_vault_file(file_path):
        raise HTTPException(status_code=400, detail="Unsupported file type")

    return FileResponse(file_path)
