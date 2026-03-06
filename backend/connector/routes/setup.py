from __future__ import annotations

"""
Setup routes for the Atlas wizard.
Handles system detection, repository setup, API keys, syncing, and configuration.
"""

import asyncio
import json
import os
import re
import shutil
import subprocess
import uuid
from datetime import datetime
from pathlib import Path

from loguru import logger

import httpx
from ..auth import require_api_key
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field

from ..entity import compute_current_user_entity, get_entity_id
from ..settings import ATLAS_CONFIG_DIR, SESSIONS_DIR, settings
from .workflows import _run_schedule_command

# Telegram agent URL for proxying auth requests
TELEGRAM_AGENT_URL = settings.telegram_agent_url

# ==================== Configuration ====================

SUGGESTED_CODOS_PATH = Path.home() / "codos"


def _get_env_file_path() -> Path:
    """Get the canonical env file path.

    Uses settings.get_env_file_path() which handles:
    - Bundle mode (ATLAS_ENV_FILE from Tauri)
    - Dev mode (paths.json > auto-detect > fallback)
    """
    return settings.get_env_file_path()


# Common locations to check for existing installations
COMMON_CODOS_LOCATIONS = [
    Path.home() / "codos",
    Path.home() / "Desktop" / "codos",
    Path.home() / "Desktop" / "codos" / "codos",
    Path.home() / "projects" / "codos",
    Path.home() / "Code" / "codos",
]

COMMON_VAULT_LOCATIONS = [
    Path.home() / "projects" / "codos_vault",
    Path.home() / "codos" / "vault",
]

WORKSPACE_NAME_RE = re.compile(r"^[\w\-\s]{1,100}$")


def _is_codos_repo(path: Path) -> bool:
    return (path / "skills").exists() and (path / "backend" / "connector").exists()


def _is_vault(path: Path) -> bool:
    return (path / "Core Memory").exists()


def _get_repo_root() -> Path | None:
    """Best-effort: find the repo root from this file location."""
    try:
        current = Path(__file__).resolve()
        for parent in current.parents:
            if _is_codos_repo(parent):
                return parent
    except Exception:
        pass
    return None


def _normalize_path(raw_path: str) -> Path:
    return Path(raw_path).expanduser().resolve()


# Background task storage
_sync_tasks: dict[str, dict] = {}
_SYNC_TASKS_FILE = ATLAS_CONFIG_DIR / "sync-tasks.json"


def _persist_sync_tasks() -> None:
    """Write _sync_tasks to disk so terminal states survive restarts."""
    try:
        _SYNC_TASKS_FILE.parent.mkdir(parents=True, exist_ok=True)
        _SYNC_TASKS_FILE.write_text(json.dumps(_sync_tasks, default=str))
    except Exception:
        logger.warning("Failed to persist sync tasks to {}", _SYNC_TASKS_FILE)


def _load_sync_tasks_from_disk() -> None:
    """Restore terminal (completed/failed) sync tasks from disk."""
    if not _SYNC_TASKS_FILE.exists():
        return
    try:
        data = json.loads(_SYNC_TASKS_FILE.read_text())
        for task_id, task in data.items():
            if task_id not in _sync_tasks and task.get("status") in ("completed", "failed"):
                _sync_tasks[task_id] = task
    except Exception:
        logger.warning("Failed to load sync tasks from {}", _SYNC_TASKS_FILE)


_load_sync_tasks_from_disk()

router = APIRouter(
    prefix="/api/setup",
    tags=["setup"],
    dependencies=[Depends(require_api_key)],
)


# ==================== Pydantic Models ====================


# System Detection
class SystemInfoResponse(BaseModel):
    name: str
    timezone: str


# Claude Check
class ClaudeCheckResponse(BaseModel):
    installed: bool
    version: str | None = None
    path: str | None = None


# Bun Check
class BunCheckResponse(BaseModel):
    installed: bool
    version: str | None = None
    path: str | None = None


# Dependency Status (for combined check)
class DependencyStatus(BaseModel):
    name: str
    installed: bool
    version: str | None = None
    required_version: str = "1.0"
    status: str = "missing"  # 'ok', 'warning', 'missing'
    install_command: str = ""
    logged_in: bool | None = None  # None for deps without login (e.g. bun)
    status_message: str | None = None  # e.g. "Installed but not logged in"


# All Dependencies Check
class AllDependenciesResponse(BaseModel):
    all_ok: bool
    dependencies: list[DependencyStatus]


# Repository Detection
class RepoDetectionRequest(BaseModel):
    pass  # No parameters needed


class DetectedPaths(BaseModel):
    codos_path: str | None = None
    vault_path: str | None = None
    codos_exists: bool = False
    vault_exists: bool = False


class RepoInitializeRequest(BaseModel):
    codos_path: str
    vault_path: str
    create_if_missing: bool = True


class RepoInitializeResponse(BaseModel):
    success: bool
    paths_json_created: bool
    codos_created: bool
    vault_created: bool
    message: str


# API Keys
# Telegram Auth
class TelegramSendCodeRequest(BaseModel):
    phone: str | None = None  # Frontend sends 'phone'
    phone_number: str | None = None  # Backend/API uses 'phone_number'

    def get_phone(self) -> str:
        """Get phone number from either field."""
        return self.phone or self.phone_number or ""


class TelegramSendCodeResponse(BaseModel):
    success: bool
    phone_code_hash: str | None = None
    message: str


class TelegramVerifyCodeRequest(BaseModel):
    phone: str | None = None  # Frontend sends 'phone'
    phone_number: str | None = None  # Backend/API uses 'phone_number'
    code: str
    phone_code_hash: str | None = None
    password: str | None = None  # For 2FA

    def get_phone(self) -> str:
        """Get phone number from either field."""
        return self.phone or self.phone_number or ""


class TelegramVerifyCodeResponse(BaseModel):
    success: bool
    session_created: bool = False
    needs_2fa: bool = False
    username: str | None = None
    message: str


# Telegram Bot (Atlas Bot - Claude chat interface)
class TelegramBotVerifyRequest(BaseModel):
    bot_token: str


class TelegramBotVerifyResponse(BaseModel):
    success: bool
    bot_username: str | None = None
    bot_id: int | None = None
    message: str


class TelegramBotSaveRequest(BaseModel):
    bot_token: str
    authorized_user_ids: str  # Comma-separated user IDs


class TelegramBotSaveResponse(BaseModel):
    success: bool
    message: str


class TelegramBotStatusResponse(BaseModel):
    configured: bool
    running: bool
    pid: int | None = None
    exit_code: int | None = None
    message: str


# Sync
class SyncStartRequest(BaseModel):
    connectors: list[str] = Field(default_factory=lambda: ["slack", "telegram", "gmail", "calendar"])


class SyncStartResponse(BaseModel):
    task_id: str
    message: str


class SyncStatusResponse(BaseModel):
    task_id: str
    status: str  # pending, running, completed, failed
    progress: float  # 0.0 to 1.0
    connectors: dict[str, dict]  # connector -> {status, progress, error}
    started_at: str | None = None
    completed_at: str | None = None
    error: str | None = None


# Sync Preflight
class PreflightCheckResult(BaseModel):
    connector: str
    ready: bool
    reason: str | None = None


class PreflightRequest(BaseModel):
    connectors: list[str]


class PreflightResponse(BaseModel):
    results: list[PreflightCheckResult]
    all_ready: bool


# Sync Retry
class RetryRequest(BaseModel):
    task_id: str
    connectors: list[str]


# Workspaces
class WorkspaceInfo(BaseModel):
    name: str
    path: str
    has_claude_md: bool
    last_modified: str | None = None


class WorkspacesDetectResponse(BaseModel):
    workspaces: list[WorkspaceInfo]


class WorkspaceCreateRequest(BaseModel):
    name: str
    template: str | None = None  # e.g., "default", "empty"


class WorkspaceCreateResponse(BaseModel):
    success: bool
    path: str
    message: str


# API Keys for completion
class ApiKeysInput(BaseModel):
    anthropic: str | None = None
    parallel: str | None = None


# Completion
class CompleteSetupRequest(BaseModel):
    generate_claude_md: bool = True
    claude_md_template: str | None = None
    user_name: str | None = None
    timezone: str | None = None
    api_keys: ApiKeysInput | None = None
    goals: str | None = None
    telegram_bot_token: str | None = None
    authorized_user_ids: str | None = None
    connectors: list[str] | None = None


class CompleteSetupResponse(BaseModel):
    success: bool
    config_saved: bool
    claude_md_created: bool
    sessions_dir_created: bool = False
    hooks_configured: bool = False
    message: str


# Save progress (intermediate saves without completing setup)
class SaveProgressRequest(BaseModel):
    user_name: str | None = None
    timezone: str | None = None
    api_keys: ApiKeysInput | None = None
    goals: str | None = None
    connectors: list[str] | None = None
    telegram_bot_token: str | None = None
    authorized_user_ids: str | None = None


class SaveProgressResponse(BaseModel):
    success: bool
    keys_saved: list[str] = []
    message: str


# Reset
class ResetResponse(BaseModel):
    success: bool
    message: str


# ==================== Helper Functions ====================


def _ensure_atlas_dir() -> Path:
    """Ensure ~/.codos directory exists."""
    ATLAS_CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    return ATLAS_CONFIG_DIR


def _read_env(env_file: Path) -> dict[str, str]:
    """Read .env file into dict, skipping comments/blanks."""
    env_vars: dict[str, str] = {}
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                env_vars[key] = value
    return env_vars


def _write_env(env_file: Path, env_vars: dict[str, str], header: str = "# Codos Configuration") -> None:
    """Write dict to .env file with restricted permissions."""
    env_file.parent.mkdir(parents=True, exist_ok=True)
    lines = [header, f"# Updated: {datetime.utcnow().isoformat()}", ""]
    lines.extend(f"{k}={v}" for k, v in env_vars.items())
    env_file.write_text("\n".join(lines) + "\n")
    os.chmod(env_file, 0o600)


def _get_system_name() -> str:
    """Get the user's full name from the system."""
    try:
        result = subprocess.run(["id", "-F"], capture_output=True, text=True, timeout=5)
        if result.returncode == 0:
            return result.stdout.strip()
    except Exception:
        pass

    # Fallback to username
    return os.environ.get("USER", "User")


def _get_system_timezone() -> str:
    """Get the system timezone from /etc/localtime symlink."""
    try:
        localtime_path = Path("/etc/localtime")
        if localtime_path.is_symlink():
            real_path = os.path.realpath(localtime_path)
            # Extract timezone from path like /var/db/timezone/zoneinfo/Asia/Bangkok
            if "zoneinfo/" in real_path:
                return real_path.split("zoneinfo/")[1]
    except Exception:
        pass

    # Fallback to system TZ or UTC
    return os.environ.get("TZ", "UTC")


def _resolve_claude_cmd() -> tuple[list[str], str] | None:
    """Resolve the claude CLI command prefix and path.

    Handles bundled vs system claude and bun interpreter prefix.

    Returns:
        (cmd_prefix, claude_path) or None if claude is not found.
        cmd_prefix is e.g. ["bun", "/path/claude"] or ["/path/claude"].
    """
    bundled = settings.atlas_bundled_claude
    if bundled and Path(bundled).exists():
        claude_path = bundled
    else:
        claude_path = shutil.which("claude")

    if not claude_path:
        return None

    bun_path = settings.atlas_bundled_bun
    if bun_path and Path(bun_path).exists() and bundled:
        return [bun_path, claude_path], claude_path
    return [claude_path], claude_path


def _get_claude_info() -> tuple[bool, str | None, str | None]:
    """Check if claude CLI is installed and get version/path."""
    resolved = _resolve_claude_cmd()
    logger.info(f"[dep-check] resolved claude cmd={resolved}")

    if not resolved:
        return False, None, None

    cmd_prefix, claude_path = resolved
    cmd = [*cmd_prefix, "--version"]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        version = result.stdout.strip() if result.returncode == 0 else None
        stderr_snippet = (result.stderr[:200] if result.stderr else "")
        logger.info(f"[dep-check] claude version={version!r}, returncode={result.returncode}, stderr={stderr_snippet!r}")
        if result.returncode == 127:
            logger.warning("[dep-check] claude returncode 127 — interpreter (node) not found")
            return False, None, claude_path
        return True, version, claude_path
    except Exception as e:
        logger.warning(f"[dep-check] claude version check failed: {e}")
        return True, None, claude_path


def _check_claude_login() -> tuple[bool, str | None]:
    """Check if Claude CLI is logged in.

    Runs `claude auth status --json` with CLAUDECODE unset to avoid nested session errors.

    Returns:
        (logged_in, email) — logged_in is False if not authenticated,
        email is the account email if available.
    """
    resolved = _resolve_claude_cmd()
    if not resolved:
        return False, None

    cmd_prefix, _ = resolved
    cmd = [*cmd_prefix, "auth", "status", "--json"]

    # Must unset CLAUDECODE to avoid "nested session" error
    env = os.environ.copy()
    env.pop("CLAUDECODE", None)

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10, env=env)
        logger.info(f"[dep-check] claude auth status rc={result.returncode}, stdout={result.stdout[:200]!r}")
        if result.returncode == 0 and result.stdout.strip():
            data = json.loads(result.stdout.strip())
            logged_in = data.get("loggedIn", False)
            email = data.get("email")
            return logged_in, email
        return False, None
    except Exception as e:
        logger.warning(f"[dep-check] claude auth status check failed: {e}")
        # If we can't check, assume logged in to avoid blocking on transient errors
        return True, None


def _get_bun_info() -> tuple[bool, str | None, str | None]:
    """Check if bun is installed and get version/path.

    Checks bundled bun, PATH, and ~/.bun/bin/bun (for fresh installs before shell reload).
    """
    bundled = settings.atlas_bundled_bun
    logger.info(f"[dep-check] ATLAS_BUNDLED_BUN={bundled!r}")
    if bundled:
        exists = Path(bundled).exists()
        logger.info(f"[dep-check] bundled bun exists={exists}")
        if exists:
            bun_path = bundled
        else:
            bun_path = shutil.which("bun")
    else:
        bun_path = shutil.which("bun")

    # Also check ~/.bun/bin/bun if not found in PATH (fresh install)
    if not bun_path:
        home_bun = Path.home() / ".bun" / "bin" / "bun"
        logger.info(f"[dep-check] checking home bun {home_bun}, exists={home_bun.exists()}")
        if home_bun.exists():
            bun_path = str(home_bun)

    logger.info(f"[dep-check] resolved bun_path={bun_path!r}")

    if not bun_path:
        return False, None, None

    try:
        result = subprocess.run([bun_path, "--version"], capture_output=True, text=True, timeout=5)
        version = result.stdout.strip() if result.returncode == 0 else None
        logger.info(
            f"[dep-check] bun version={version!r}, returncode={result.returncode}, stderr={result.stderr.strip()!r}"
        )
        return True, version, bun_path
    except Exception as e:
        logger.warning(f"[dep-check] bun version check failed: {e}")
        return True, None, bun_path


def _detect_existing_paths() -> tuple[str | None, str | None]:
    """Detect existing codos and vault paths."""
    codos_path = None
    vault_path = None

    # In bundle mode, CODOS_ROOT env var is set by the desktop runtime
    env_codos = settings.codos_root
    if env_codos and Path(env_codos).exists():
        codos_path = env_codos

    if not codos_path:
        repo_root = _get_repo_root()
        if repo_root and _is_codos_repo(repo_root):
            codos_path = str(repo_root)

    # Check codos locations
    if not codos_path:
        for path in COMMON_CODOS_LOCATIONS:
            if path.exists() and _is_codos_repo(path):
                codos_path = str(path)
                break

    # In bundle mode, VAULT_PATH may be set
    env_vault = settings.vault_path
    if env_vault and Path(env_vault).exists():
        vault_path = env_vault

    # Check vault locations
    if not vault_path:
        for path in COMMON_VAULT_LOCATIONS:
            if path.exists() and _is_vault(path):
                vault_path = str(path)
                break

    return codos_path, vault_path


VAULT_FOLDERS = [
    "Core Memory",
    "0 - Daily Briefs",
    "0 - Weekly Reviews",
    "1 - Inbox (Last 7 days)",
    "2 - Projects",
    "3 - Todos",
    "4 - CRM",
    "5 - Agent Memory",
    "Archived data",
]


def _ensure_vault_dirs(base_path: Path) -> None:
    """Ensure all standard vault subdirectories exist."""
    for folder in VAULT_FOLDERS:
        (base_path / folder).mkdir(parents=True, exist_ok=True)


def _create_folder_structure(base_path: Path, is_codos: bool = True) -> None:
    """Create the standard folder structure."""
    if is_codos:
        for folder in ("skills", "ingestion", "hooks", "dev", "dev/Ops"):
            (base_path / folder).mkdir(parents=True, exist_ok=True)
    else:
        _ensure_vault_dirs(base_path)
        _create_vault_template_files(base_path)


def _create_vault_template_files(base_path: Path) -> None:
    """Create template files in a new vault (About me.md, Goals.md, System.md)."""
    # Ensure subdirs exist (vault root may exist without them)
    _ensure_vault_dirs(base_path)

    # About me.md template
    about_me = base_path / "Core Memory" / "About me.md"
    if not about_me.exists():
        about_me.write_text("""# About Me

## Background
<!-- Your background, role, and context -->

## Preferences
- Communication style: <!-- direct/detailed/casual -->
- Timezone: <!-- e.g., Europe/Madrid -->

## Work Context
<!-- Your current role, projects, and priorities -->

---

*Update this file to help Atlas understand who you are.*
""")

    # Goals.md template
    goals = base_path / "Core Memory" / "Goals.md"
    if not goals.exists():
        goals.write_text("""# Goals

### Short-term goals

1. <!-- Your first goal -->
2. <!-- Your second goal -->
3. <!-- Your third goal -->

### Long-term goals

<!-- What are you working towards? -->

---

*Update this file to help Atlas understand what you're working on.*
""")

    # Learnings.md template
    learnings = base_path / "Core Memory" / "Learnings.md"
    if not learnings.exists():
        learnings.write_text("""# Learnings

> Accumulated insights from /compound sessions.

## Tactical Patterns
<!-- Observations about what works -->

## Blockers to Watch
<!-- Recurring issues that derail progress -->

## Process Improvements
<!-- Better ways of working discovered -->

---

*Updated by /compound — Review and prune periodically.*
""")

    # System.md template
    system_md = base_path / "System.md"
    if not system_md.exists():
        system_md.write_text("""# System

Operating rules and preferences for Atlas.

## Communication Style
<!-- How should Atlas communicate with you? -->

## Priorities
<!-- What should Atlas prioritize? -->

## Constraints
<!-- Any limitations or things to avoid? -->

---

*Update this file to customize how Atlas operates.*
""")


def _sanitize_workspace_name(name: str) -> str:
    # Basic filesystem-safe name
    return re.sub(r"[^\w\-\s]", "", name).strip() or "Workspace"


def _is_placeholder_about_name(value: str) -> bool:
    candidate = (value or "").strip().lower()
    return candidate in {"", "user", "unknown", "<!-- your name -->", "your name", "name"}


def _seed_about_me_name(vault_path: Path, user_name: str) -> None:
    """Write user's name to About me.md once during setup.

    Safe behavior:
    - If About me.md has a non-placeholder name, keep it.
    - If file has no name line or a placeholder, write/update `- Name: ...`.
    """
    normalized_name = (user_name or "").strip()
    if not normalized_name:
        return

    _create_vault_template_files(vault_path)
    about_me_path = vault_path / "Core Memory" / "About me.md"
    if not about_me_path.exists():
        return

    content = about_me_path.read_text(encoding="utf-8")
    name_line_regex = r"^(\s*[-*]?\s*Name[^:]*:\s*)(.+?)\s*$"
    match = re.search(name_line_regex, content, flags=re.IGNORECASE | re.MULTILINE)

    if match:
        existing_raw = match.group(2)
        existing_clean = re.sub(r"<!--.*?-->", "", existing_raw).strip()
        if not _is_placeholder_about_name(existing_clean):
            return
        updated = re.sub(
            name_line_regex,
            rf"\1{normalized_name}",
            content,
            count=1,
            flags=re.IGNORECASE | re.MULTILINE,
        )
        about_me_path.write_text(updated, encoding="utf-8")
        return

    if re.search(r"^##\s*Background\s*$", content, flags=re.IGNORECASE | re.MULTILINE):
        updated = re.sub(
            r"^##\s*Background\s*$",
            f"## Background\n- Name: {normalized_name}",
            content,
            count=1,
            flags=re.IGNORECASE | re.MULTILINE,
        )
    else:
        updated = f"# About Me\n\n## Background\n- Name: {normalized_name}\n\n{content}".strip() + "\n"

    about_me_path.write_text(updated, encoding="utf-8")


def _validate_workspace_name(name: str) -> str:
    workspace_name = (name or "").strip()
    if not workspace_name:
        raise HTTPException(status_code=400, detail="Workspace name is required")
    if "/" in workspace_name or "\\" in workspace_name or workspace_name in {".", ".."}:
        raise HTTPException(status_code=400, detail="Workspace name contains invalid characters")
    if not WORKSPACE_NAME_RE.fullmatch(workspace_name):
        raise HTTPException(status_code=400, detail="Workspace name must contain only letters, numbers, spaces, _ or -")
    return workspace_name




# _generate_entity_id moved to entity.py - use get_entity_id() imported above


# ==================== Sync Background Task ====================

from ..connector_commands import CONNECTOR_COMMANDS

# Max concurrent syncs
MAX_CONCURRENT_SYNCS = 4

# Frontend-to-backend connector name mapping
CONNECTOR_NAME_MAP = {
    "googlecalendar": "calendar",
    "googledrive": None,  # Not supported yet
}


def _normalize_connector_name(name: str) -> str | None:
    """Map frontend connector names to backend names. Returns None if unsupported."""
    return CONNECTOR_NAME_MAP.get(name, name)


def _load_vault_path() -> Path | None:
    """Load vault path from ~/.codos/paths.json."""
    paths_file = ATLAS_CONFIG_DIR / "paths.json"
    if paths_file.exists():
        try:
            with open(paths_file) as f:
                paths = json.load(f)
            vault_path = paths.get("vault_path")
            if vault_path:
                return Path(vault_path)
        except Exception:
            pass
    return None


def _load_env_vars() -> dict[str, str]:
    """Load environment variables from dev/Ops/.env."""
    env_vars = {}
    env_file = _get_env_file_path()
    if env_file.exists():
        try:
            with open(env_file) as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        key, value = line.split("=", 1)
                        env_vars[key] = value
        except Exception:
            pass
    return env_vars


async def _run_connector_sync(
    connector: str,
    task: dict,
    codos_path: Path,
    env_vars: dict[str, str],
    semaphore: asyncio.Semaphore,
    status_key: str | None = None,
) -> None:
    """Run a single connector sync with semaphore control.

    Args:
        connector: Backend connector name (e.g., "calendar")
        status_key: Frontend connector name for status updates (e.g., "googlecalendar").
                   If None, uses connector name.
    """
    status_key = status_key or connector
    async with semaphore:
        config = CONNECTOR_COMMANDS.get(connector)
        if not config:
            task["connectors"][status_key] = {
                "status": "failed",
                "progress": 0.0,
                "error": f"Unknown connector: {connector}",
            }
            return

        task["connectors"][status_key] = {"status": "syncing", "progress": 0.0, "message": "Starting..."}

        try:
            # Prepare environment
            env = os.environ.copy()
            env.update(env_vars)

            # Update status
            task["connectors"][status_key]["message"] = "Running sync..."
            task["connectors"][status_key]["progress"] = 0.3

            # Build the full command with resolved paths
            cmd = config["cmd"]

            # Merge any extra env from connector config (e.g. PYTHONPATH)
            if "env" in config:
                env.update(config["env"])

            if settings.is_bundle_mode:
                bundle_root = os.environ.get("BUNDLE_ROOT", "")
                if cmd[0] == "bun":
                    # Bundle mode: use bundled bun
                    bun_bin = os.path.join(bundle_root, "bun", "bin", "bun")
                    if not os.path.exists(bun_bin):
                        task["connectors"][status_key] = {
                            "status": "failed",
                            "progress": 0.0,
                            "error": f"Bundled bun not found: {bun_bin}",
                        }
                        return
                    program = bun_bin
                    program_args = cmd[1:]
                    cwd = Path(bundle_root) / config["cwd"]
                else:
                    # Bundle mode: Python connectors (Telegram) → bundled python
                    python_bin = os.path.join(bundle_root, "python", "bin", "python3")
                    if not os.path.exists(python_bin):
                        task["connectors"][status_key] = {
                            "status": "failed",
                            "progress": 0.0,
                            "error": f"Bundled Python not found: {python_bin}",
                        }
                        return
                    program = python_bin
                    program_args = cmd[1:]  # ["-m", "backend", "telegram-agent", "sync"]
                    cwd = Path(bundle_root) / "services"
                    env["PYTHONPATH"] = str(cwd)
            elif cmd[0] == "bun":
                cwd = codos_path / config["cwd"]
                if not cwd.exists():
                    task["connectors"][status_key] = {
                        "status": "failed",
                        "progress": 0.0,
                        "error": f"Directory not found: {cwd}",
                    }
                    return
                try:
                    bun_path = settings.bun_path
                except RuntimeError as exc:
                    task["connectors"][status_key] = {
                        "status": "failed",
                        "progress": 0.0,
                        "error": str(exc),
                    }
                    return
                program = bun_path
                program_args = cmd[1:]
            else:
                # Dev mode Python — resolve relative cmd path against working_dir
                cwd = codos_path / config["cwd"]
                program = str(cwd / cmd[0])
                program_args = cmd[1:]

            # Run the sync command
            proc = await asyncio.create_subprocess_exec(
                program,
                *program_args,
                cwd=str(cwd),
                env=env,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            try:
                stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=config["timeout"])

                if proc.returncode == 0:
                    task["connectors"][status_key] = {
                        "status": "completed",
                        "progress": 1.0,
                        "message": "Sync complete",
                    }
                else:
                    raw_stderr = stderr.decode() if stderr else ""
                    raw_stdout = stdout.decode() if stdout else ""
                    # Extract meaningful error message from stderr, then stdout
                    error_msg = ""
                    for output in [raw_stderr, raw_stdout]:
                        if not output or error_msg:
                            continue
                        for line in output.strip().splitlines():
                            line = line.strip()
                            if line.startswith(("Error:", "Fatal error:", "error:", "[Errno")):
                                error_msg = line[:200]
                                break
                            if "Error:" in line or "error:" in line:
                                error_msg = line[:200]
                                break
                        else:
                            # Fallback: use first non-empty line
                            first_line = output.strip().splitlines()[0] if output.strip() else ""
                            if first_line and not error_msg:
                                error_msg = first_line[:200]
                    if not error_msg:
                        error_msg = f"Process exited with code {proc.returncode}"
                    task["connectors"][status_key] = {"status": "failed", "progress": 0.0, "error": error_msg}

            except TimeoutError:
                proc.kill()
                await proc.wait()
                task["connectors"][status_key] = {
                    "status": "failed",
                    "progress": 0.0,
                    "error": f"Timeout after {config['timeout']}s",
                }

        except Exception as e:
            task["connectors"][status_key] = {"status": "failed", "progress": 0.0, "error": str(e)}
        finally:
            _persist_sync_tasks()


async def _run_sync_task(task_id: str, connectors: list[str]) -> None:
    """Background task to sync connectors in parallel."""
    task = _sync_tasks[task_id]
    task["status"] = "running"
    task["started_at"] = datetime.utcnow().isoformat()

    # Load configuration
    codos_path = settings.get_codos_path()
    env_vars = _load_env_vars()

    # Create semaphore for concurrency control
    semaphore = asyncio.Semaphore(MAX_CONCURRENT_SYNCS)

    # Google Workspace sub-connectors: expand "google" into individual services
    GOOGLE_SUB_CONNECTORS = {"gmail": "gmail", "calendar": "calendar"}

    # Normalize connector names and filter unsupported
    normalized_connectors = []
    for frontend_name in connectors:
        # Expand "google" into its sub-connectors (gmail, calendar)
        if frontend_name == "google":
            for sub_frontend, sub_backend in GOOGLE_SUB_CONNECTORS.items():
                normalized_connectors.append((sub_frontend, sub_backend))
                task["connectors"][sub_frontend] = {"status": "pending", "progress": 0.0}
            continue

        backend_name = _normalize_connector_name(frontend_name)
        if backend_name is None:
            # Unsupported connector - mark as skipped
            task["connectors"][frontend_name] = {
                "status": "completed",
                "progress": 1.0,
                "message": "Skipped (not supported yet)",
            }
        else:
            normalized_connectors.append((frontend_name, backend_name))
            task["connectors"][frontend_name] = {"status": "pending", "progress": 0.0}

    # Run all supported connectors in parallel (with semaphore limiting concurrency)
    await asyncio.gather(
        *[
            _run_connector_sync(backend_name, task, codos_path, env_vars, semaphore, frontend_name)
            for frontend_name, backend_name in normalized_connectors
        ]
    )

    # Calculate overall progress and final status
    total = len(connectors)
    completed = sum(1 for c in connectors if task["connectors"].get(c, {}).get("status") == "completed")
    failed = sum(1 for c in connectors if task["connectors"].get(c, {}).get("status") == "failed")
    finished = completed + failed
    task["progress"] = finished / total if total > 0 else 1.0

    if failed > 0:
        task["status"] = "failed"
        task["error"] = f"{failed} of {total} connector syncs failed"
    else:
        task["status"] = "completed"
        task["error"] = None
    task["completed_at"] = datetime.utcnow().isoformat()
    _persist_sync_tasks()




# ==================== Route Handlers ====================


# 1. System Detection
@router.get("/detect-system-info", response_model=SystemInfoResponse)
async def detect_system_info():
    """Returns {name, timezone} by running `id -F` and reading /etc/localtime."""
    return SystemInfoResponse(name=_get_system_name(), timezone=_get_system_timezone())


# 2. Claude Check
@router.get("/check-claude", response_model=ClaudeCheckResponse)
async def check_claude():
    """Returns {installed: bool, version: str, path: str}."""
    installed, version, path = _get_claude_info()
    return ClaudeCheckResponse(installed=installed, version=version, path=path)


# 2b. Bun Check
@router.get("/check-bun", response_model=BunCheckResponse)
async def check_bun():
    """Check bun installation for hooks.

    Returns {installed: bool, version: str, path: str}.
    """
    installed, version, path = _get_bun_info()
    return BunCheckResponse(installed=installed, version=version, path=path)


# 2c. All Dependencies Check
async def _auto_install_bun() -> tuple[bool, str]:
    """Attempt to auto-install bun. Returns (success, message)."""
    try:
        result = subprocess.run(
            ["bash", "-c", "curl -fsSL https://bun.sh/install | bash"],
            capture_output=True,
            text=True,
            timeout=120,
            env={**os.environ, "BUN_INSTALL": str(Path.home() / ".bun")},
        )
        if result.returncode == 0:
            return True, "Bun installed successfully"
        return False, result.stderr or "Installation failed"
    except subprocess.TimeoutExpired:
        return False, "Installation timed out"
    except Exception as e:
        return False, str(e)


@router.get("/check-dependencies", response_model=AllDependenciesResponse)
async def check_dependencies():
    """Check ALL agent dependencies at once.

    Returns combined status of: bun, claude.
    Includes install instructions for each missing dependency.
    Auto-installs bun if missing.
    """
    dependencies: list[DependencyStatus] = []

    # Check bun - AUTO-INSTALL if missing
    bun_installed, bun_version, bun_path = _get_bun_info()
    if not bun_installed:
        # Try to auto-install bun
        install_success, install_msg = await _auto_install_bun()
        if install_success:
            # Re-check after installation (check ~/.bun/bin/bun directly since PATH may not be updated)
            bun_bin = Path.home() / ".bun" / "bin" / "bun"
            if bun_bin.exists():
                bun_installed = True
                try:
                    result = subprocess.run([str(bun_bin), "--version"], capture_output=True, text=True, timeout=5)
                    bun_version = result.stdout.strip() if result.returncode == 0 else None
                except Exception:
                    bun_version = "installed"

    dependencies.append(
        DependencyStatus(
            name="bun",
            installed=bun_installed,
            version=bun_version,
            required_version="1.0",
            status="ok" if bun_installed else "missing",
            install_command="curl -fsSL https://bun.sh/install | bash",
        )
    )

    # Check claude
    claude_installed, claude_version, _ = _get_claude_info()
    if claude_installed:
        logged_in, _email = _check_claude_login()
        if logged_in:
            claude_status = "ok"
            claude_install_cmd = ""
            claude_status_msg = None
        else:
            claude_status = "warning"
            claude_install_cmd = "claude auth login"
            claude_status_msg = "Installed but not logged in"
    else:
        logged_in = None
        claude_status = "missing"
        claude_install_cmd = "curl -fsSL https://claude.ai/install.sh | bash"
        claude_status_msg = None

    dependencies.append(
        DependencyStatus(
            name="claude",
            installed=claude_installed,
            version=claude_version,
            required_version="1.0",
            status=claude_status,
            install_command=claude_install_cmd,
            logged_in=logged_in,
            status_message=claude_status_msg,
        )
    )

    # Check if all dependencies are ok
    all_ok = all(dep.status == "ok" for dep in dependencies)

    return AllDependenciesResponse(all_ok=all_ok, dependencies=dependencies)


# 2f. Install Dependency
class InstallDependencyRequest(BaseModel):
    name: str  # 'bun' or 'claude'


class InstallDependencyResponse(BaseModel):
    success: bool
    message: str
    output: str | None = None


# Map of supported auto-install commands
# Only include commands that are safe to run non-interactively
INSTALLABLE_DEPS = {
    "bun": {
        "check": lambda: shutil.which("bun") is not None,
        "cmd": ["bash", "-c", "curl -fsSL https://bun.sh/install | bash"],
        "shell_reload": True,  # Needs PATH update
    },
    # claude requires npm which should already be available
}


@router.post("/install-dependency", response_model=InstallDependencyResponse)
async def install_dependency(request: InstallDependencyRequest):
    """Install a dependency automatically.

    Currently supports: bun
    Other dependencies (claude) require manual installation.
    """
    name = request.name.lower()

    if name not in INSTALLABLE_DEPS:
        return InstallDependencyResponse(
            success=False,
            message=f"Automatic installation not supported for '{name}'. Please install manually.",
            output=None,
        )

    dep_config = INSTALLABLE_DEPS[name]

    # Check if already installed
    if dep_config["check"]():
        return InstallDependencyResponse(success=True, message=f"{name} is already installed", output=None)

    try:
        # Run the install command
        result = subprocess.run(
            dep_config["cmd"],
            capture_output=True,
            text=True,
            timeout=120,  # 2 minute timeout for install
            env={**os.environ, "BUN_INSTALL": str(Path.home() / ".bun")},
        )

        if result.returncode == 0:
            # For bun, add to PATH hint
            hint = ""
            if name == "bun" and dep_config.get("shell_reload"):
                bun_path = Path.home() / ".bun" / "bin" / "bun"
                if bun_path.exists():
                    hint = "\n\nNote: You may need to restart your terminal or run: source ~/.bashrc (or ~/.zshrc)"

            return InstallDependencyResponse(
                success=True, message=f"{name} installed successfully!{hint}", output=result.stdout or result.stderr
            )
        else:
            return InstallDependencyResponse(
                success=False,
                message=f"Installation failed with exit code {result.returncode}",
                output=result.stderr or result.stdout,
            )

    except subprocess.TimeoutExpired:
        return InstallDependencyResponse(success=False, message="Installation timed out after 2 minutes", output=None)
    except Exception as e:
        return InstallDependencyResponse(success=False, message=f"Installation error: {str(e)}", output=None)


# 3. Repository Setup
@router.api_route("/repos/detect", methods=["GET", "POST"], response_model=DetectedPaths)
async def detect_repos():
    """Auto-detect existing codos/vault paths."""
    codos_path, vault_path = _detect_existing_paths()
    codos_exists = codos_path is not None
    vault_exists = vault_path is not None

    if not codos_path:
        codos_path = str(SUGGESTED_CODOS_PATH)

    if not vault_path:
        vault_path = str(Path(settings.vault_path))

    return DetectedPaths(
        codos_path=codos_path, vault_path=vault_path, codos_exists=codos_exists, vault_exists=vault_exists
    )


@router.post("/repos/initialize", response_model=RepoInitializeResponse)
async def initialize_repos(request: RepoInitializeRequest):
    """Creates ~/.codos/paths.json with codos_path and vault_path."""
    _ensure_atlas_dir()

    codos_path = _normalize_path(request.codos_path)
    vault_path = _normalize_path(request.vault_path)

    # If user picked the parent folder, auto-fix to nested repo.
    nested_repo = codos_path / "codos"
    if not _is_codos_repo(codos_path) and _is_codos_repo(nested_repo):
        codos_path = nested_repo

    codos_created = False
    vault_created = False

    if request.create_if_missing:
        if not codos_path.exists():
            _create_folder_structure(codos_path, is_codos=True)
            codos_created = True

        if not vault_path.exists():
            _create_folder_structure(vault_path, is_codos=False)
            vault_created = True
        else:
            # Vault exists but may be missing template files - ensure they exist
            _create_vault_template_files(vault_path)

    # Save paths.json
    paths_file = ATLAS_CONFIG_DIR / "paths.json"
    paths_data = {
        "codos_path": str(codos_path),
        "vault_path": str(vault_path),
        "timezone": _get_system_timezone(),
        "created_at": datetime.utcnow().isoformat(),
    }

    with open(paths_file, "w") as f:
        json.dump(paths_data, f, indent=2)

    # Copy env.sh for wrapper scripts (morning-brief, weekly-review, etc.)
    env_sh_dest = ATLAS_CONFIG_DIR / "env.sh"
    env_source = codos_path / "env.sh"
    if not env_source.exists():
        env_source = codos_path / "dev" / "Ops" / "env.sh"
    if env_source.exists():
        if env_sh_dest.is_symlink() or env_sh_dest.exists():
            env_sh_dest.unlink()
        env_sh_dest.write_text(env_source.read_text())
        env_sh_dest.chmod(0o755)

    # Write VAULT_PATH + Telegram defaults to .env
    env_file = _get_env_file_path()
    existing_vars = _read_env(env_file)
    existing_vars["VAULT_PATH"] = str(vault_path)
    _write_env(env_file, existing_vars)

    # Get entity_id from single source of truth (generates if needed)
    entity_id = get_entity_id()
    user_name = _get_system_name()

    config_file = ATLAS_CONFIG_DIR / "config.json"

    # Merge with existing config if it exists (preserve other keys)
    existing_config = {}
    if config_file.exists():
        try:
            with open(config_file) as f:
                existing_config = json.load(f)
        except (OSError, json.JSONDecodeError):
            pass

    # Update with user info (entity_id already set by get_entity_id())
    existing_config.update(
        {
            "entityId": entity_id,
            "userName": user_name,
            "createdAt": existing_config.get("createdAt", datetime.utcnow().isoformat()),
        }
    )

    with open(config_file, "w") as f:
        json.dump(existing_config, f, indent=2)

    return RepoInitializeResponse(
        success=True,
        paths_json_created=True,
        codos_created=codos_created,
        vault_created=vault_created,
        message=f"Paths saved to {paths_file}",
    )


class AutoInitializeResponse(BaseModel):
    success: bool
    codos_path: str
    vault_path: str
    message: str


@router.post("/auto-initialize", response_model=AutoInitializeResponse)
async def auto_initialize():
    """Auto-detect codos path, create vault at ~/codos_vault, write paths.json + .env defaults.

    Called from the wizard when leaving the Welcome step (step 0).
    """
    _ensure_atlas_dir()

    # 1. Auto-detect codos path
    codos_path = _get_repo_root()
    if not codos_path:
        for loc in COMMON_CODOS_LOCATIONS:
            if loc.exists() and _is_codos_repo(loc):
                codos_path = loc
                break
    if not codos_path:
        codos_path = Path.home() / "codos"

    # 2. Vault always at ~/codos_vault
    vault_path = Path.home() / "codos_vault"

    # 3. Create vault dirs + template files if missing
    if not vault_path.exists():
        _create_folder_structure(vault_path, is_codos=False)
    else:
        _create_vault_template_files(vault_path)

    # 4. Write paths.json (snake_case + camelCase aliases)
    paths_file = ATLAS_CONFIG_DIR / "paths.json"
    paths_data = {
        "codos_path": str(codos_path),
        "vault_path": str(vault_path),
        "timezone": _get_system_timezone(),
        "created_at": datetime.utcnow().isoformat(),
    }
    with open(paths_file, "w") as f:
        json.dump(paths_data, f, indent=2)

    # 5. Write VAULT_PATH + Telegram defaults to .env
    env_file = _get_env_file_path()
    existing_vars = _read_env(env_file)
    existing_vars["VAULT_PATH"] = str(vault_path)
    _write_env(env_file, existing_vars)

    # 6. Copy env.sh
    env_sh_dest = ATLAS_CONFIG_DIR / "env.sh"
    env_source = codos_path / "env.sh"
    if not env_source.exists():
        env_source = codos_path / "dev" / "Ops" / "env.sh"
    if env_source.exists():
        if env_sh_dest.is_symlink() or env_sh_dest.exists():
            env_sh_dest.unlink()
        env_sh_dest.write_text(env_source.read_text())
        env_sh_dest.chmod(0o755)

    # 7. Seed config.json with entity + user info
    entity_id = get_entity_id()
    user_name = _get_system_name()
    config_file = ATLAS_CONFIG_DIR / "config.json"
    existing_config = {}
    if config_file.exists():
        try:
            with open(config_file) as f:
                existing_config = json.load(f)
        except (OSError, json.JSONDecodeError):
            pass
    existing_config.update({
        "entityId": entity_id,
        "userName": user_name,
        "createdAt": existing_config.get("createdAt", datetime.utcnow().isoformat()),
    })
    with open(config_file, "w") as f:
        json.dump(existing_config, f, indent=2)

    return AutoInitializeResponse(
        success=True,
        codos_path=str(codos_path),
        vault_path=str(vault_path),
        message="Auto-initialized successfully",
    )


# 4. API Keys


class ExistingKeysResponse(BaseModel):
    """Response with existing API keys (masked for display)."""

    anthropic: str | None = None
    gemini: str | None = None
    assemblyai: str | None = None
    parallel: str | None = None
    # Booleans for quick check
    has_anthropic: bool = False
    has_gemini: bool = False
    has_assemblyai: bool = False
    has_parallel: bool = False


class SetupStatusResponse(BaseModel):
    """High-level onboarding status used by app startup routing."""

    needs_setup: bool
    setup_completed: bool
    setup_completed_flag: bool
    legacy_install_detected: bool
    paths_configured: bool
    codos_path: str | None = None
    vault_path: str | None = None


@router.get("/existing-keys", response_model=ExistingKeysResponse)
async def get_existing_keys():
    """Returns existing API keys from dev/Ops/.env (values masked for security)."""
    result = ExistingKeysResponse()

    existing_vars = _read_env(_get_env_file_path())
    if not existing_vars:
        return result

    # Helper to mask keys (show first 4 and last 4 chars)
    def mask_key(value: str) -> str:
        if not value or len(value) < 12:
            return "••••••••" if value else None
        return f"{value[:4]}••••{value[-4:]}"

    # Check each key
    if existing_vars.get("ANTHROPIC_API_KEY"):
        result.anthropic = mask_key(existing_vars["ANTHROPIC_API_KEY"])
        result.has_anthropic = True

    # Check both GEMINI_API_KEY and GOOGLE_API_KEY (alias)
    gemini_key = existing_vars.get("GEMINI_API_KEY") or existing_vars.get("GOOGLE_API_KEY")
    if gemini_key:
        result.gemini = mask_key(gemini_key)
        result.has_gemini = True

    if existing_vars.get("ASSEMBLYAI_API_KEY"):
        result.assemblyai = mask_key(existing_vars["ASSEMBLYAI_API_KEY"])
        result.has_assemblyai = True

    if existing_vars.get("PARALLEL_API_KEY"):
        result.parallel = mask_key(existing_vars["PARALLEL_API_KEY"])
        result.has_parallel = True

    return result


@router.get("/status", response_model=SetupStatusResponse)
async def get_setup_status():
    """
    Return whether onboarding should run on app startup.

    `setup_completed_flag` is the explicit marker written by /complete.
    `legacy_install_detected` keeps older/manual installs from being forced
    back into onboarding when paths + repositories are already valid.
    """
    _ensure_atlas_dir()

    config_file = ATLAS_CONFIG_DIR / "config.json"
    paths_file = ATLAS_CONFIG_DIR / "paths.json"

    setup_completed_flag = False
    config = {}
    if config_file.exists():
        try:
            with open(config_file) as f:
                config = json.load(f)
            setup_completed_flag = bool(config.get("setup_completed"))
        except (OSError, json.JSONDecodeError):
            setup_completed_flag = False

    codos_path: str | None = None
    vault_path: str | None = None
    paths_configured = False
    codos_repo_valid = False
    vault_valid = False

    if paths_file.exists():
        try:
            with open(paths_file) as f:
                paths = json.load(f)
            codos_path = paths.get("codos_path")
            vault_path = paths.get("vault_path")
            paths_configured = bool(codos_path and vault_path)

            if codos_path:
                codos_repo_valid = _is_codos_repo(Path(codos_path).expanduser())
            if vault_path:
                vault_candidate = Path(vault_path).expanduser()
                vault_valid = vault_candidate.exists() and vault_candidate.is_dir()
        except (OSError, json.JSONDecodeError):
            paths_configured = False

    stored_entity = config.get("entityId", "")
    current_entity = compute_current_user_entity()
    user_matches = (not stored_entity) or (stored_entity == current_entity)

    install_valid = paths_configured and codos_repo_valid and vault_valid
    legacy_install_detected = install_valid and user_matches

    # Do not force users back into onboarding on the same machine when the
    # derived entity hash changes (e.g. OS/user metadata drift). If setup was
    # explicitly completed and paths are valid, treat installation as complete.
    setup_completed = (setup_completed_flag and install_valid) or legacy_install_detected
    needs_setup = not setup_completed

    return SetupStatusResponse(
        needs_setup=needs_setup,
        setup_completed=setup_completed,
        setup_completed_flag=setup_completed_flag,
        legacy_install_detected=legacy_install_detected,
        paths_configured=paths_configured,
        codos_path=codos_path,
        vault_path=vault_path,
    )


# 4c. Save Progress (intermediate saves without completing setup)
@router.post("/save-progress", response_model=SaveProgressResponse)
async def save_progress(request: SaveProgressRequest):
    """Saves API keys, bot creds, and goals without marking setup as complete.

    Used by the wizard at intermediate checkpoints so that progress is persisted
    without prematurely setting setupCompleted=true or generating CLAUDE.md.
    """
    _ensure_atlas_dir()

    paths_file = ATLAS_CONFIG_DIR / "paths.json"
    if not paths_file.exists():
        await auto_initialize()

    codos_path = str(settings.get_codos_path())
    vault_path = str(settings.get_vault_path())

    keys_saved: list[str] = []

    # Single read → mutate → write for all env changes
    env_file = _get_env_file_path()
    existing_vars = _read_env(env_file)
    env_dirty = False

    if request.api_keys:
        key_mapping = {
            "ANTHROPIC_API_KEY": request.api_keys.anthropic,
            "PARALLEL_API_KEY": request.api_keys.parallel,
        }
        for env_key, value in key_mapping.items():
            if value:
                existing_vars[env_key] = value
                keys_saved.append(env_key)
        existing_vars["CODOS_PATH"] = codos_path
        env_dirty = True

    if request.telegram_bot_token and request.authorized_user_ids:
        existing_vars["TELEGRAM_BOT_TOKEN"] = request.telegram_bot_token
        existing_vars["AUTHORIZED_USER_IDS"] = request.authorized_user_ids.replace(" ", "")
        keys_saved.extend(["TELEGRAM_BOT_TOKEN", "AUTHORIZED_USER_IDS"])
        env_dirty = True

        # Also copy to atlas-bot/.env if directory exists
        try:
            atlas_bot_env = Path(codos_path) / "dev" / "atlas-bot" / ".env"
            if atlas_bot_env.parent.exists():
                bot_vars = _read_env(atlas_bot_env)
                bot_vars["TELEGRAM_BOT_TOKEN"] = request.telegram_bot_token
                bot_vars["AUTHORIZED_USER_IDS"] = request.authorized_user_ids.replace(" ", "")
                _write_env(atlas_bot_env, bot_vars, header="# Atlas Telegram Bot Config")
        except Exception:
            pass

    if env_dirty:
        _write_env(env_file, existing_vars)

    # Save goals to Vault/Core Memory/Goals.md if provided
    if request.goals and request.goals.strip():
        try:
            core_memory_dir = Path(vault_path) / "Core Memory"
            core_memory_dir.mkdir(parents=True, exist_ok=True)
            goals_file = core_memory_dir / "Goals.md"

            goals_lines = [line.strip() for line in request.goals.strip().split("\n") if line.strip()]
            cleaned_goals = []
            for line in goals_lines:
                cleaned = re.sub(r"^\d+[\.\)\:]\s*", "", line)
                if cleaned:
                    cleaned_goals.append(cleaned)

            goals_content = f"""# Goals

### Short-term goals

{chr(10).join(f"{i + 1}. {goal}" for i, goal in enumerate(cleaned_goals))}

---

*Updated via Codos Setup on {datetime.utcnow().strftime("%Y-%m-%d")}*
"""
            with open(goals_file, "w") as f:
                f.write(goals_content)
        except Exception:
            pass

    return SaveProgressResponse(
        success=True,
        keys_saved=keys_saved,
        message=f"Progress saved. {len(keys_saved)} key(s) written.",
    )


# 5. Telegram Auth (proxied to telegram-agent)
@router.post("/telegram/send-code", response_model=TelegramSendCodeResponse)
async def telegram_send_code(request: TelegramSendCodeRequest):
    """Proxy send-code request to telegram-agent."""
    phone = request.get_phone()
    if not phone:
        raise HTTPException(status_code=400, detail="Phone number is required")

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(f"{TELEGRAM_AGENT_URL}/telegram/phone/send-code", json={"phone_number": phone})

            if resp.status_code != 200:
                error_detail = resp.json().get("detail", "Failed to send code")
                return TelegramSendCodeResponse(success=False, message=error_detail)

            data = resp.json()
            return TelegramSendCodeResponse(
                success=data.get("success", False),
                phone_code_hash=data.get("phone_code_hash"),
                message=data.get("message", "Code sent"),
            )

    except httpx.ConnectError:
        raise HTTPException(
            status_code=503,
            detail="Telegram agent not running. Start it with: cd backend/telegram_agent && python server.py",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Proxy error: {e}")


@router.post("/telegram/verify-code", response_model=TelegramVerifyCodeResponse)
async def telegram_verify_code(request: TelegramVerifyCodeRequest):
    """Proxy verify-code request to telegram-agent."""
    phone = request.get_phone()
    if not phone:
        raise HTTPException(status_code=400, detail="Phone number is required")

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            payload = {
                "phone_number": phone,
                "code": request.code,
            }
            if request.phone_code_hash:
                payload["phone_code_hash"] = request.phone_code_hash
            if request.password:
                payload["password"] = request.password

            resp = await client.post(f"{TELEGRAM_AGENT_URL}/telegram/phone/verify-code", json=payload)

            data = resp.json()

            if resp.status_code != 200:
                error_detail = data.get("detail", "Verification failed")
                return TelegramVerifyCodeResponse(success=False, message=error_detail)

            return TelegramVerifyCodeResponse(
                success=data.get("success", False),
                session_created=data.get("session_created", False),
                needs_2fa=data.get("needs_2fa", False),
                username=data.get("username"),
                message=data.get("message", "Verified"),
            )

    except httpx.ConnectError:
        raise HTTPException(
            status_code=503,
            detail="Telegram agent not running. Start it with: cd backend/telegram_agent && python server.py",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Proxy error: {e}")


def _resolve_telegram_agent_command() -> tuple[list[str], Path, dict[str, str]]:
    """Resolve the command, working directory, and extra env for starting the Telegram agent.

    Returns (argv, cwd, extra_env).
    Bundle mode: bundled python with -m backend telegram-agent server.
    Dev mode: venv python with -m backend telegram-agent server.
    """
    if settings.is_bundle_mode:
        bundle_root = os.environ.get("BUNDLE_ROOT", "")
        python_bin = str(Path(bundle_root) / "python" / "bin" / "python3")
        if not Path(python_bin).exists():
            raise FileNotFoundError(f"Bundled Python not found: {python_bin}")
        services_dir = str(Path(bundle_root) / "services")
        return (
            [python_bin, "-m", "backend", "telegram-agent", "server"],
            Path(bundle_root),
            {"PYTHONPATH": services_dir},
        )
    else:
        codos_root = settings.get_codos_path()
        venv_python = codos_root / ".venv" / "bin" / "python"
        if not venv_python.exists():
            raise FileNotFoundError(
                f"Python venv not found: {venv_python}. "
                "Run bootstrap.sh to set up venvs."
            )
        return (
            [str(venv_python), "-m", "backend", "telegram-agent", "server"],
            codos_root,
            {"PYTHONPATH": str(codos_root)},
        )


@router.post("/telegram/start-agent")
async def start_telegram_agent():
    """Start the Telegram agent if not already running (idempotent)."""

    # 1. Check if already running via health check
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            resp = await client.get(f"{TELEGRAM_AGENT_URL}/telegram/auth/status")
            if resp.status_code == 200:
                return {"success": True, "already_running": True, "message": "Already running"}
    except (httpx.ConnectError, httpx.TimeoutException):
        pass  # Not running, proceed to start

    # 2. Resolve command
    try:
        argv, cwd, extra_env = _resolve_telegram_agent_command()
        logger.info(f"telegram-agent resolved: argv={argv} cwd={cwd}")
    except FileNotFoundError as e:
        logger.error(f"telegram-agent start failed: {e}")
        return {"success": False, "message": str(e)}

    # 3. Start detached subprocess
    try:
        env_file = _get_env_file_path()
        env = {
            **os.environ,
            **extra_env,
            "TELEGRAM_AGENT_PORT": str(settings.telegram_agent_port),
            "ATLAS_ENV_FILE": str(env_file),
        }
        proc = await asyncio.create_subprocess_exec(
            *argv,
            cwd=str(cwd),
            env=env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            start_new_session=True,
        )

        # 4. Wait and verify
        await asyncio.sleep(1.5)

        if proc.returncode is not None:
            output = ""
            if proc.stdout:
                raw = await proc.stdout.read(4096)
                output = raw.decode(errors="replace")
            logger.error(f"telegram-agent exited immediately (rc={proc.returncode}): {output}")
            return {"success": False, "message": f"Agent crashed on startup (exit {proc.returncode}): {output[:500]}"}

        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                resp = await client.get(f"{TELEGRAM_AGENT_URL}/telegram/auth/status")
                if resp.status_code == 200:
                    return {"success": True, "already_running": False, "pid": proc.pid}
        except Exception:
            pass

        return {"success": True, "already_running": False, "pid": proc.pid, "message": "Starting..."}
    except Exception as e:
        logger.exception("Failed to start telegram-agent")
        return {"success": False, "message": str(e)}


@router.post("/telegram/restart-agent")
async def restart_telegram_agent():
    """Kill Telegram agent so the Tauri supervisor can restart it cleanly.

    Previously this endpoint both killed AND spawned a new process, racing
    with the Tauri supervisor for the same port.  Now it only kills — the
    supervisor detects the crash within ~4s and restarts via
    start_service_inner() which has kill_port cleanup logic.
    """
    import signal

    port = str(settings.telegram_agent_port)
    killed_any = False
    try:
        result = await asyncio.create_subprocess_exec(
            "lsof",
            "-ti",
            f":{port}",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        stdout, _ = await result.communicate()
        if stdout:
            pids = stdout.decode().strip().split("\n")
            for pid_str in pids:
                if pid_str:
                    try:
                        os.kill(int(pid_str), signal.SIGTERM)
                        killed_any = True
                    except (ProcessLookupError, ValueError):
                        pass
            if killed_any:
                await asyncio.sleep(1.0)
    except Exception:
        pass

    return {"success": True, "killed": killed_any, "message": "Agent killed; Tauri supervisor will restart it"}


@router.get("/telegram/health")
async def telegram_health():
    """Check if Telegram agent is reachable."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{TELEGRAM_AGENT_URL}/telegram/auth/status")
            if resp.status_code == 200:
                return {"running": True, "status": resp.json().get("status", "unknown")}
    except httpx.ConnectError:
        raise HTTPException(status_code=503, detail="Telegram agent not running")
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Health check timed out")


# 5b. Telegram Bot (Atlas Bot - Claude chat interface)
@router.post("/telegram-bot/verify", response_model=TelegramBotVerifyResponse)
async def verify_telegram_bot(request: TelegramBotVerifyRequest):
    """Verify a Telegram bot token by calling the Telegram API."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"https://api.telegram.org/bot{request.bot_token}/getMe")

            if resp.status_code != 200:
                return TelegramBotVerifyResponse(success=False, message="Invalid bot token")

            data = resp.json()
            if not data.get("ok"):
                return TelegramBotVerifyResponse(success=False, message=data.get("description", "Invalid bot token"))

            result = data.get("result", {})
            return TelegramBotVerifyResponse(
                success=True,
                bot_username=result.get("username"),
                bot_id=result.get("id"),
                message=f"Bot verified: @{result.get('username')}",
            )

    except httpx.ConnectError:
        return TelegramBotVerifyResponse(success=False, message="Could not connect to Telegram API")
    except Exception as e:
        return TelegramBotVerifyResponse(success=False, message=f"Verification error: {str(e)}")


@router.post("/telegram-bot/save", response_model=TelegramBotSaveResponse)
async def save_telegram_bot(request: TelegramBotSaveRequest):
    """Save Telegram bot credentials to dev/Ops/.env and set up the bot service."""
    env_file = _get_env_file_path()
    existing_vars = _read_env(env_file)
    existing_vars["TELEGRAM_BOT_TOKEN"] = request.bot_token
    existing_vars["AUTHORIZED_USER_IDS"] = request.authorized_user_ids.replace(" ", "")
    _write_env(env_file, existing_vars)

    # Set up atlas-bot service
    setup_message = "Bot configuration saved"
    try:
        paths_file = ATLAS_CONFIG_DIR / "paths.json"
        if paths_file.exists():
            with open(paths_file) as f:
                paths = json.load(f)
            codos_path = settings.get_codos_path()
            atlas_bot_dir = codos_path / "ingestion" / "atlas-bot"

            if True:  # atlas-bot uses its own venv
                # 1. Create logs directory
                logs_dir = codos_path / "dev" / "Logs" / "atlas-bot"
                logs_dir.mkdir(parents=True, exist_ok=True)

                venv_python = codos_path / ".venv" / "bin" / "python"
                env_file = codos_path / "dev" / "Ops" / ".env"

                # 2. Create LaunchAgent plist
                home = Path.home()
                launch_agents_dir = home / "Library" / "LaunchAgents"
                launch_agents_dir.mkdir(parents=True, exist_ok=True)
                plist_path = launch_agents_dir / "com.dkos.atlas-bot.plist"

                plist_content = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.dkos.atlas-bot</string>

    <key>ProgramArguments</key>
    <array>
        <string>{venv_python}</string>
        <string>-m</string>
        <string>backend</string>
        <string>atlas-bot</string>
    </array>

    <key>WorkingDirectory</key>
    <string>{codos_path}</string>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>StandardOutPath</key>
    <string>{logs_dir}/stdout.log</string>

    <key>StandardErrorPath</key>
    <string>{logs_dir}/stderr.log</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>{venv_python.parent}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
        <key>PYTHONPATH</key>
        <string>{codos_path}</string>
        <key>ATLAS_ENV_FILE</key>
        <string>{env_file}</string>
    </dict>
</dict>
</plist>"""

                with open(plist_path, "w") as f:
                    f.write(plist_content)

                # 5. Load/reload the LaunchAgent
                subprocess.run(["launchctl", "unload", str(plist_path)], capture_output=True)
                result = subprocess.run(["launchctl", "load", str(plist_path)], capture_output=True)

                if result.returncode == 0:
                    setup_message = "Bot configured and started"
                else:
                    setup_message = "Bot configured (manual start may be needed)"

    except Exception as e:
        # Non-critical - main .env was already saved
        setup_message = f"Bot configured (service setup failed: {str(e)[:50]})"

    return TelegramBotSaveResponse(success=True, message=setup_message)


@router.get("/telegram-bot/status", response_model=TelegramBotStatusResponse)
async def get_telegram_bot_status():
    """Check if the Telegram bot is configured and running."""
    # Check if configured (token exists in .env)
    env_file = _get_env_file_path()
    configured = False
    if env_file.exists():
        with open(env_file) as f:
            content = f.read()
            configured = "TELEGRAM_BOT_TOKEN=" in content and "AUTHORIZED_USER_IDS=" in content

    # Check if running via launchctl
    running = False
    pid = None
    exit_code = None
    message = "Not configured"

    if configured:
        try:
            result = subprocess.run(["launchctl", "list"], capture_output=True, text=True, timeout=5)
            for line in result.stdout.splitlines():
                if "com.dkos.atlas-bot" in line:
                    parts = line.split()
                    if len(parts) >= 3:
                        pid_str, exit_str = parts[0], parts[1]
                        pid = int(pid_str) if pid_str != "-" else None
                        exit_code = int(exit_str) if exit_str != "-" else None
                        running = pid is not None
                    break

            if running:
                message = f"Running (PID {pid})"
            elif exit_code is not None and exit_code != 0:
                message = f"Crashed (exit code {exit_code})"
            else:
                message = "Configured but not running"
        except Exception:
            message = "Configured (status check failed)"

    return TelegramBotStatusResponse(
        configured=configured, running=running, pid=pid, exit_code=exit_code, message=message
    )


# 6. Sync
def _ensure_env_has_entity_id():
    """Ensure dev/Ops/.env has COMPOSIO_ENTITY_ID before sync runs."""
    env_file = _get_env_file_path()
    entity_id = get_entity_id()

    existing_vars = _read_env(env_file)

    if existing_vars.get("COMPOSIO_ENTITY_ID") == entity_id:
        return

    existing_vars["COMPOSIO_ENTITY_ID"] = entity_id

    paths_file = ATLAS_CONFIG_DIR / "paths.json"
    if paths_file.exists():
        try:
            existing_vars["CODOS_PATH"] = str(settings.get_codos_path())
        except Exception:
            pass

    _write_env(env_file, existing_vars)


@router.post("/sync/start", response_model=SyncStartResponse)
async def start_sync(request: SyncStartRequest, background_tasks: BackgroundTasks):
    """Starts parallel sync of connectors, returns task_id."""
    # Ensure .env has entity ID before running sync scripts
    _ensure_env_has_entity_id()

    task_id = str(uuid.uuid4())

    _sync_tasks[task_id] = {
        "task_id": task_id,
        "status": "pending",
        "progress": 0.0,
        "connectors": {c: {"status": "pending", "progress": 0.0} for c in request.connectors},
        "started_at": None,
        "completed_at": None,
        "error": None,
    }

    background_tasks.add_task(_run_sync_task, task_id, request.connectors)

    return SyncStartResponse(task_id=task_id, message=f"Sync started for {len(request.connectors)} connectors")


@router.get("/sync/status/{task_id}", response_model=SyncStatusResponse)
async def get_sync_status(task_id: str):
    """Returns sync progress."""
    if task_id not in _sync_tasks:
        _load_sync_tasks_from_disk()
    if task_id not in _sync_tasks:
        raise HTTPException(status_code=404, detail="Sync task not found")

    task = _sync_tasks[task_id]
    return SyncStatusResponse(**task)


@router.post("/sync/preflight", response_model=PreflightResponse)
async def sync_preflight(request: PreflightRequest):
    """Check if each connector is ready to sync."""
    results: list[PreflightCheckResult] = []

    for connector in request.connectors:
        backend_name = _normalize_connector_name(connector)

        # Unsupported connector
        if backend_name is None:
            results.append(
                PreflightCheckResult(connector=connector, ready=False, reason="Not supported yet")
            )
            continue

        # Google Workspace: always ready via claude.ai Connectors
        if backend_name == "google":
            results.append(PreflightCheckResult(connector=connector, ready=True, reason=None))
            continue

        # No sync command configured
        if backend_name not in CONNECTOR_COMMANDS:
            results.append(
                PreflightCheckResult(
                    connector=connector, ready=False, reason="No sync command configured"
                )
            )
            continue

        config = CONNECTOR_COMMANDS[backend_name]

        # Telegram: check session file
        if backend_name == "telegram":
            codos_path = settings.get_codos_path()
            session_path = codos_path / "ingestion" / "Telegram-agent" / "session.string"
            data_session = settings.get_telegram_data_dir() / "session.string"
            if not session_path.exists() and not data_session.exists():
                results.append(
                    PreflightCheckResult(
                        connector=connector,
                        ready=False,
                        reason="Telegram session not authenticated",
                    )
                )
                continue

        # Bun-based connector: check bun is available
        if config["cmd"][0] == "bun":
            try:
                settings.bun_path
            except RuntimeError:
                results.append(
                    PreflightCheckResult(
                        connector=connector, ready=False, reason="bun not installed"
                    )
                )
                continue

        results.append(PreflightCheckResult(connector=connector, ready=True))

    all_ready = all(r.ready for r in results)
    return PreflightResponse(results=results, all_ready=all_ready)


async def _run_retry_task(task_id: str, connectors: list[str]) -> None:
    """Background task to retry specific connectors within an existing sync task."""
    task = _sync_tasks[task_id]
    task["status"] = "running"

    codos_path = settings.get_codos_path()
    env_vars = _load_env_vars()
    semaphore = asyncio.Semaphore(MAX_CONCURRENT_SYNCS)

    # Google Workspace sub-connectors
    GOOGLE_SUB_CONNECTORS = {"gmail": "gmail", "calendar": "calendar"}

    # Normalize and run only the specified connectors
    normalized = []
    for frontend_name in connectors:
        # Expand "google" into its sub-connectors
        if frontend_name == "google":
            for sub_frontend, sub_backend in GOOGLE_SUB_CONNECTORS.items():
                normalized.append((sub_frontend, sub_backend))
                task["connectors"][sub_frontend] = {"status": "pending", "progress": 0.0}
            continue

        backend_name = _normalize_connector_name(frontend_name)
        if backend_name is None:
            task["connectors"][frontend_name] = {
                "status": "completed",
                "progress": 1.0,
                "message": "Skipped (not supported yet)",
            }
        else:
            normalized.append((frontend_name, backend_name))

    await asyncio.gather(
        *[
            _run_connector_sync(
                backend_name, task, codos_path, env_vars, semaphore, frontend_name
            )
            for frontend_name, backend_name in normalized
        ]
    )

    # Recalculate overall status from ALL connectors in the task
    all_connectors = task["connectors"]
    total = len(all_connectors)
    completed = sum(1 for c in all_connectors.values() if c.get("status") == "completed")
    failed = sum(1 for c in all_connectors.values() if c.get("status") == "failed")
    finished = completed + failed
    task["progress"] = finished / total if total > 0 else 1.0

    if failed > 0:
        task["status"] = "failed"
        task["error"] = f"{failed} of {total} connector syncs failed"
    else:
        task["status"] = "completed"
        task["error"] = None

    task["completed_at"] = datetime.utcnow().isoformat()
    _persist_sync_tasks()


@router.post("/sync/retry", response_model=SyncStartResponse)
async def retry_sync(request: RetryRequest, background_tasks: BackgroundTasks):
    """Retry specific failed connectors within an existing sync task."""
    if request.task_id not in _sync_tasks:
        _load_sync_tasks_from_disk()
    if request.task_id not in _sync_tasks:
        raise HTTPException(status_code=404, detail="Sync task not found")

    task = _sync_tasks[request.task_id]

    # Reset specified connectors to pending
    for connector in request.connectors:
        task["connectors"][connector] = {"status": "pending", "progress": 0.0}

    task["status"] = "running"
    task["error"] = None

    background_tasks.add_task(_run_retry_task, request.task_id, request.connectors)

    return SyncStartResponse(
        task_id=request.task_id,
        message=f"Retry started for {len(request.connectors)} connectors",
    )


# 7. Workspaces
@router.get("/workspaces/detect", response_model=WorkspacesDetectResponse)
async def detect_workspaces():
    """Scans vault Projects folder for existing workspaces."""
    vault_path = settings.get_vault_path()
    projects_path = vault_path / "2 - Projects"
    workspaces = []

    if projects_path.exists():
        for item in projects_path.iterdir():
            if item.is_dir():
                claude_md = item / "CLAUDE.md"
                stat = item.stat()

                workspaces.append(
                    WorkspaceInfo(
                        name=item.name,
                        path=str(item),
                        has_claude_md=claude_md.exists(),
                        last_modified=datetime.fromtimestamp(stat.st_mtime).isoformat(),
                    )
                )

    # Sort by last modified, newest first
    workspaces.sort(key=lambda x: x.last_modified or "", reverse=True)

    return WorkspacesDetectResponse(workspaces=workspaces)


@router.post("/workspaces/create", response_model=WorkspaceCreateResponse)
async def create_workspace(request: WorkspaceCreateRequest):
    """Creates workspace folders in vault."""
    workspace_name = _validate_workspace_name(request.name)

    vault_path = settings.get_vault_path()
    workspace_path = vault_path / "2 - Projects" / workspace_name

    if workspace_path.exists():
        raise HTTPException(status_code=400, detail=f"Workspace '{workspace_name}' already exists")

    # Create workspace structure
    workspace_path.mkdir(parents=True, exist_ok=True)
    (workspace_path / "notes").mkdir(exist_ok=True)
    (workspace_path / "resources").mkdir(exist_ok=True)

    # Create a basic CLAUDE.md if template is default
    if request.template != "empty":
        claude_md_content = f"""# {workspace_name}

Project workspace created on {datetime.utcnow().strftime("%Y-%m-%d")}.

## Overview

<!-- Describe the project here -->

## Key Files

<!-- List important files and their purposes -->

## Notes

<!-- Add project-specific instructions for Claude -->
"""
        with open(workspace_path / "CLAUDE.md", "w") as f:
            f.write(claude_md_content)

    return WorkspaceCreateResponse(
        success=True, path=str(workspace_path), message=f"Workspace '{workspace_name}' created successfully"
    )


# 8. Vault Import


# 9. Completion
@router.post("/complete", response_model=CompleteSetupResponse)
async def complete_setup(request: CompleteSetupRequest):
    """Final step: saves config.json, generates CLAUDE.md from template."""
    _ensure_atlas_dir()

    # Ensure paths are configured (auto-initialize if wizard was interrupted)
    paths_file = ATLAS_CONFIG_DIR / "paths.json"
    if not paths_file.exists():
        await auto_initialize()

    codos_path = str(settings.get_codos_path())
    vault_path = str(settings.get_vault_path())

    # Get user info (fallback to system detection if not provided)
    user_name = request.user_name or _get_system_name()
    timezone = request.timezone or _get_system_timezone()

    # Get entity_id from single source of truth
    config_file = ATLAS_CONFIG_DIR / "config.json"
    entity_id = get_entity_id()

    # Save config.json
    config_data = {
        "version": "1.0.0",
        "setup_completed": True,
        "completed_at": datetime.utcnow().isoformat(),
        "codos_path": codos_path,
        "vault_path": vault_path,
        "user_name": user_name,
        "timezone": timezone,
        "entity_id": entity_id,
    }
    with open(config_file, "w") as f:
        json.dump(config_data, f, indent=2)

    # Seed About me.md with the detected/setup name (non-destructive).
    try:
        _seed_about_me_name(Path(vault_path), user_name)
    except Exception:
        pass

    # Save goals to Vault/Core Memory/Goals.md if provided
    if request.goals and request.goals.strip():
        try:
            core_memory_dir = Path(vault_path) / "Core Memory"
            core_memory_dir.mkdir(parents=True, exist_ok=True)
            goals_file = core_memory_dir / "Goals.md"

            goals_lines = [line.strip() for line in request.goals.strip().split("\n") if line.strip()]
            cleaned_goals = []
            for line in goals_lines:
                cleaned = re.sub(r"^\d+[\.\)\:]\s*", "", line)
                if cleaned:
                    cleaned_goals.append(cleaned)

            goals_content = f"""# Goals

### Short-term goals

{chr(10).join(f"{i + 1}. {goal}" for i, goal in enumerate(cleaned_goals))}

---

*Updated via Codos Setup on {datetime.utcnow().strftime("%Y-%m-%d")}*
"""
            with open(goals_file, "w") as f:
                f.write(goals_content)
        except Exception:
            pass

    # Single read → mutate → write for all env changes
    env_file = _get_env_file_path()
    existing_vars = _read_env(env_file)

    if request.api_keys:
        if request.api_keys.anthropic:
            existing_vars["ANTHROPIC_API_KEY"] = request.api_keys.anthropic
        if request.api_keys.parallel:
            existing_vars["PARALLEL_API_KEY"] = request.api_keys.parallel

        if entity_id:
            existing_vars["COMPOSIO_ENTITY_ID"] = entity_id
        existing_vars["CODOS_PATH"] = codos_path

    if request.telegram_bot_token and request.authorized_user_ids:
        existing_vars["TELEGRAM_BOT_TOKEN"] = request.telegram_bot_token
        existing_vars["AUTHORIZED_USER_IDS"] = request.authorized_user_ids.replace(" ", "")

        # Also copy to atlas-bot/.env if directory exists
        try:
            atlas_bot_env = Path(codos_path) / "dev" / "atlas-bot" / ".env"
            if atlas_bot_env.parent.exists():
                bot_vars = _read_env(atlas_bot_env)
                bot_vars["TELEGRAM_BOT_TOKEN"] = request.telegram_bot_token
                bot_vars["AUTHORIZED_USER_IDS"] = request.authorized_user_ids.replace(" ", "")
                _write_env(atlas_bot_env, bot_vars, header="# Atlas Telegram Bot Config")
        except Exception:
            pass

    _write_env(env_file, existing_vars)

    claude_md_created = False

    # Generate Vault/CLAUDE.md (thin redirect to project CLAUDE.md)
    # NOTE: We no longer write to ~/.claude/CLAUDE.md (global) to avoid
    # polluting non-Codos Claude Code sessions. Atlas only loads when
    # working from the codos directory or the vault directory.
    if request.generate_claude_md:
        vault_claude_md = Path(vault_path) / "CLAUDE.md"

        vault_claude_md_content = f"""# Atlas — Vault Context Directory

> This is the Atlas Vault. Full system instructions live in the Codos codebase.

Read `{codos_path}/CLAUDE.md` for complete Atlas instructions.

**Path adjustment:** When that file references `Vault/...` paths, they are relative to
this directory. Drop the `Vault/` prefix. Example:
- `Vault/Core Memory/About me.md` → `Core Memory/About me.md`
- `Vault/3 - Todos/{{today}}.md` → `3 - Todos/{{today}}.md`

---

*Generated by Codos Setup on {datetime.utcnow().strftime("%Y-%m-%d")}*
"""

        with open(vault_claude_md, "w") as f:
            f.write(vault_claude_md_content)

        claude_md_created = True

        # Migration: if global ~/.claude/CLAUDE.md contains Atlas/DKOS content,
        # back it up and remove it so it stops loading in non-Codos sessions.
        global_claude_md = Path.home() / ".claude" / "CLAUDE.md"
        if global_claude_md.exists():
            try:
                content = global_claude_md.read_text()
                if "Atlas" in content or "DKOS" in content or "Codos" in content:
                    backup = global_claude_md.with_suffix(".md.bak")
                    global_claude_md.rename(backup)
                    logger.info(f"Migrated global CLAUDE.md to {backup} (no longer needed)")
            except Exception:
                pass  # Non-critical

    # Create ~/atlas-mcp workdir for MCP subprocess pattern
    # This isolates MCP subprocess calls from the main Vault context
    atlas_mcp_dir = Path.home() / "atlas-mcp"
    atlas_mcp_dir.mkdir(exist_ok=True)

    # Create agent sessions directory
    SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
    sessions_dir_created = SESSIONS_DIR.exists()

    # Make hook scripts executable
    hooks_configured = False
    hooks_dir = Path(codos_path) / "backend" / "connector" / "hooks"
    if hooks_dir.exists():
        for hook in hooks_dir.glob("*.sh"):
            hook.chmod(hook.stat().st_mode | 0o111)  # Add execute permission
        for hook in hooks_dir.glob("*.ts"):
            hook.chmod(hook.stat().st_mode | 0o111)  # TypeScript hooks too
        hooks_configured = True

    # Check for tmux installation (warning only, don't fail)
    tmux_warning = ""
    if not shutil.which("tmux"):
        tmux_warning = " Warning: tmux is not installed. Agent sessions require tmux for background execution."

    # Auto-enable scheduled workflows (non-critical)
    workflows_enabled = False
    try:
        _run_schedule_command(Path(codos_path), ["enable-all"])
        workflows_enabled = True
    except Exception as e:
        logger.warning(f"Failed to auto-enable scheduled workflows: {e}")

    return CompleteSetupResponse(
        success=True,
        config_saved=True,
        claude_md_created=claude_md_created,
        sessions_dir_created=sessions_dir_created,
        hooks_configured=hooks_configured,
        message=f"Setup completed successfully!{tmux_warning}",
    )


# 10. Reset (dev)
@router.post("/reset", response_model=ResetResponse)
async def reset_setup():
    """Resets setup state for testing."""
    files_removed = []

    # Remove config files
    for filename in ["config.json", "paths.json", ".env"]:
        file_path = ATLAS_CONFIG_DIR / filename
        if file_path.exists():
            file_path.unlink()
            files_removed.append(str(file_path))

    # Remove Vault/CLAUDE.md if it exists
    try:
        paths_file = ATLAS_CONFIG_DIR / "paths.json"
        if paths_file.exists():
            with open(paths_file) as f:
                paths = json.load(f)
            vault_path = paths.get("vaultPath")
            if vault_path:
                vault_claude_md = Path(vault_path) / "CLAUDE.md"
                if vault_claude_md.exists():
                    vault_claude_md.unlink()
                    files_removed.append(str(vault_claude_md))
    except Exception:
        pass  # Non-critical

    # Clear task caches
    _sync_tasks.clear()
    _import_tasks.clear()
    if _SYNC_TASKS_FILE.exists():
        _SYNC_TASKS_FILE.unlink()
        files_removed.append(str(_SYNC_TASKS_FILE))

    return ResetResponse(
        success=True,
        message=f"Reset complete. Removed: {', '.join(files_removed) if files_removed else 'No files to remove'}",
    )
