"""Connector sync orchestration and task state management."""

from __future__ import annotations

import asyncio
import json
import os
import uuid
from datetime import datetime
from pathlib import Path

from loguru import logger

from backend.codos_models.connector_commands import CONNECTOR_COMMANDS, Runtime
from backend.codos_models.exceptions import DependencyNotInstalledException
from backend.codos_models.settings import CODOS_CONFIG_DIR, settings
from backend.codos_utils.paths import SYNC_LOGS_DIR
from backend.codos_utils.secrets import get_secrets_backend

_sync_tasks: dict[str, dict] = {}
_SYNC_TASKS_FILE = CODOS_CONFIG_DIR / "sync-tasks.json"

MAX_CONCURRENT_SYNCS = 4

CONNECTOR_NAME_MAP: dict[str, str | None] = {
    "googlecalendar": "calendar",
    "googledrive": None,  # Not supported yet
}

GOOGLE_SUB_CONNECTORS: dict[str, str] = {"gmail": "gmail", "calendar": "calendar"}


def persist_sync_tasks() -> None:
    """Write ``_sync_tasks`` to disk so terminal states survive restarts."""
    try:
        _SYNC_TASKS_FILE.parent.mkdir(parents=True, exist_ok=True)
        _SYNC_TASKS_FILE.write_text(json.dumps(_sync_tasks, default=str))
    except Exception:
        logger.warning("Failed to persist sync tasks to {}", _SYNC_TASKS_FILE)


def load_sync_tasks_from_disk() -> None:
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


load_sync_tasks_from_disk()


def normalize_connector_name(name: str) -> str | None:
    """Map frontend connector names to backend names. Returns None if unsupported."""
    return CONNECTOR_NAME_MAP.get(name, name)


def load_env_vars() -> dict[str, str]:
    """Load secrets as env vars for subprocess environments."""
    return get_secrets_backend().get_all()


def get_sync_tasks() -> dict[str, dict]:
    """Return the in-memory sync tasks dict."""
    return _sync_tasks


def clear_sync_tasks() -> None:
    """Clear all sync tasks and remove the on-disk file."""
    _sync_tasks.clear()
    if _SYNC_TASKS_FILE.exists():
        _SYNC_TASKS_FILE.unlink()


def get_sync_tasks_file() -> Path:
    """Return the path to the on-disk sync tasks file."""
    return _SYNC_TASKS_FILE


def create_sync_task(connectors: list[str]) -> tuple[str, dict]:
    """Create a new sync task and return ``(task_id, task_dict)``."""
    task_id = str(uuid.uuid4())
    task = {
        "task_id": task_id,
        "status": "pending",
        "progress": 0.0,
        "connectors": {c: {"status": "pending", "progress": 0.0} for c in connectors},
        "started_at": None,
        "completed_at": None,
        "error": None,
    }
    _sync_tasks[task_id] = task
    return task_id, task


def _write_sync_log(connector: str, task_id: str, returncode: int | None, stdout: bytes, stderr: bytes) -> None:
    """Write full stdout/stderr from a sync run to ~/.codos/logs/sync/."""
    try:
        connector_dir = SYNC_LOGS_DIR / connector
        connector_dir.mkdir(parents=True, exist_ok=True)
        ts = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
        log_path = connector_dir / f"{ts}_{task_id[:8]}.log"
        parts = [
            f"connector: {connector}",
            f"task_id:   {task_id}",
            f"time:      {datetime.utcnow().isoformat()}",
            f"exit_code: {returncode}",
            "",
            "=== STDOUT ===",
            stdout.decode(errors="replace") if stdout else "(empty)",
            "",
            "=== STDERR ===",
            stderr.decode(errors="replace") if stderr else "(empty)",
        ]
        log_path.write_text("\n".join(parts))
    except Exception:
        logger.warning("Failed to write sync log for {}", connector)


async def run_connector_sync(
    connector: str,
    task: dict,
    codos_path: Path,
    env_vars: dict[str, str],
    semaphore: asyncio.Semaphore,
    status_key: str | None = None,
) -> None:
    """Run a single connector sync with semaphore control."""
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
            env = os.environ.copy()
            env.update(env_vars)

            task["connectors"][status_key]["message"] = "Running sync..."
            task["connectors"][status_key]["progress"] = 0.3

            runtime = config["runtime"]
            args = config["args"]

            if "env" in config:
                env.update(config["env"])

            if runtime == Runtime.BUN:
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
                except DependencyNotInstalledException as exc:
                    task["connectors"][status_key] = {
                        "status": "failed",
                        "progress": 0.0,
                        "error": str(exc),
                    }
                    return
                program = bun_path
                program_args = args
            else:
                cwd = codos_path / config["cwd"]
                program = str(settings.get_backend_venv_python())
                program_args = args

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
                _write_sync_log(connector, task.get("task_id", "unknown"), proc.returncode, stdout, stderr)

                if proc.returncode == 0:
                    task["connectors"][status_key] = {
                        "status": "completed",
                        "progress": 1.0,
                        "message": "Sync complete",
                    }
                else:
                    raw_stderr = stderr.decode() if stderr else ""
                    raw_stdout = stdout.decode() if stdout else ""
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
            persist_sync_tasks()


async def run_sync_task(task_id: str, connectors: list[str]) -> None:
    """Background task to sync connectors in parallel."""
    task = _sync_tasks[task_id]
    task["status"] = "running"
    task["started_at"] = datetime.utcnow().isoformat()

    codos_path = settings.get_codos_path()
    env_vars = load_env_vars()
    semaphore = asyncio.Semaphore(MAX_CONCURRENT_SYNCS)

    normalized_connectors: list[tuple[str, str]] = []
    for frontend_name in connectors:
        if frontend_name == "google":
            for sub_frontend, sub_backend in GOOGLE_SUB_CONNECTORS.items():
                normalized_connectors.append((sub_frontend, sub_backend))
                task["connectors"][sub_frontend] = {"status": "pending", "progress": 0.0}
            continue

        backend_name = normalize_connector_name(frontend_name)
        if backend_name is None:
            task["connectors"][frontend_name] = {
                "status": "completed",
                "progress": 1.0,
                "message": "Skipped (not supported yet)",
            }
        else:
            normalized_connectors.append((frontend_name, backend_name))
            task["connectors"][frontend_name] = {"status": "pending", "progress": 0.0}

    await asyncio.gather(
        *[
            run_connector_sync(backend_name, task, codos_path, env_vars, semaphore, frontend_name)
            for frontend_name, backend_name in normalized_connectors
        ]
    )

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
    persist_sync_tasks()


async def run_retry_task(task_id: str, connectors: list[str]) -> None:
    """Background task to retry specific connectors within an existing sync task."""
    task = _sync_tasks[task_id]
    task["status"] = "running"

    codos_path = settings.get_codos_path()
    env_vars = load_env_vars()
    semaphore = asyncio.Semaphore(MAX_CONCURRENT_SYNCS)

    normalized: list[tuple[str, str]] = []
    for frontend_name in connectors:
        if frontend_name == "google":
            for sub_frontend, sub_backend in GOOGLE_SUB_CONNECTORS.items():
                normalized.append((sub_frontend, sub_backend))
                task["connectors"][sub_frontend] = {"status": "pending", "progress": 0.0}
            continue

        backend_name = normalize_connector_name(frontend_name)
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
            run_connector_sync(backend_name, task, codos_path, env_vars, semaphore, frontend_name)
            for frontend_name, backend_name in normalized
        ]
    )

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
    persist_sync_tasks()
