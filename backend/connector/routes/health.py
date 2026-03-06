"""
Health check routes for the Atlas system.
Provides comprehensive health status including services, jobs, data freshness, and errors.
"""

import re
import socket
import subprocess
import time
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel
from ..settings import settings

# ==================== Configuration ====================

router = APIRouter(prefix="/api/health", tags=["health"])

# Cache for health checks (TTL: 10 seconds)
_health_cache: tuple[dict, float] | None = None
CACHE_TTL = 10.0

# Connectors to check for data freshness
CONNECTORS = ["telegram", "gmail", "calendar", "slack", "linear", "granola", "notion"]
# Note: GitHub connector removed
CONNECTOR_ALIASES = {"googlecalendar": "calendar"}

# Services to check
SERVICES = [
    {"name": "connector-backend", "port": 8767},
    {"name": "frontend", "port": 5174},
]


# ==================== Pydantic Models ====================


class ServiceHealth(BaseModel):
    name: str
    port: int
    status: str  # "healthy", "unhealthy"
    listening: bool


class JobHealth(BaseModel):
    label: str
    status: str  # "running", "stopped", "error"
    pid: int | None = None
    exit_code: int | None = None
    last_run: str | None = None  # ISO timestamp of last run


class ConnectorFreshness(BaseModel):
    connector: str
    last_sync: str | None = None
    age_minutes: int | None = None
    status: str  # "fresh", "stale", "unknown", "not_configured"


class ErrorEntry(BaseModel):
    connector: str
    timestamp: str
    message: str


class HealthSummary(BaseModel):
    healthy: int
    failing: int
    total: int


class FullHealthResponse(BaseModel):
    services: list[ServiceHealth]
    jobs: list[JobHealth]
    freshness: list[ConnectorFreshness]
    errors: list[ErrorEntry]
    summary: HealthSummary
    cached: bool = False
    timestamp: str


# ==================== Helper Functions ====================


def _load_codos_path() -> Path:
    return settings.get_codos_path()


def _check_port(port: int, host: str = "127.0.0.1", timeout: float = 1.0) -> bool:
    """Check if a port is listening."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(timeout)
            result = sock.connect_ex((host, port))
            return result == 0
    except Exception:
        return False


# Map job labels to log directories
JOB_LOG_DIRS = {
    "com.codos.telegram-sync": "telegram-sync",
    "com.codos.slack-sync": "slack-sync",
    "com.codos.calendar-sync": "calendar-sync",
    "com.codos.gmail-sync": "gmail-sync",
    "com.codos.notion-sync": "notion-sync",
    "com.codos.linear-sync": "linear-sync",
    "com.codos.granola-sync": "granola-sync",
    "com.codos.telegram-agent": "telegram-agent",
    "com.codos.process-cleanup": "process-cleanup",
    "com.dkos.morning-brief": "morning-brief",
    "com.dkos.telegram-summary": "telegram-summary",
    "com.dkos.weekly-review": "weekly-review",
    "com.dkos.crm-update": "crm-update",
    "com.dkos.reliability-check": "reliability-check",
    "com.dkos.atlas-bot": "atlas-bot",
    "com.dkos.atlas-alerts": "atlas-alerts",
}


def _resolve_log_path(codos_path: Path, log_dir: str, filename: str) -> Path | None:
    """Resolve log path from current writable location, with legacy fallback."""
    candidates = [
        Path(settings.atlas_data_dir) / "logs" / log_dir / filename,
        codos_path / "dev" / "Logs" / log_dir / filename,  # legacy dev path
    ]
    existing = [p for p in candidates if p.exists()]
    if not existing:
        return None
    # Prefer the most recently updated file if both exist.
    return max(existing, key=lambda p: p.stat().st_mtime)


def _is_connector_configured(connector: str, codos_path: Path) -> bool:
    """Best-effort check if a connector is configured by the user."""
    # MCP-based services (Slack, Notion, Linear) — assume configured if we get this far
    if connector in ("slack", "notion", "linear", "gmail", "calendar"):
        return True

    if connector == "telegram":
        session_paths = [
            settings.get_telegram_data_dir() / "session.string",
            codos_path / "ingestion" / "Telegram-agent" / "session.string",
        ]
        return any(path.exists() for path in session_paths)

    if connector == "granola":
        token_path = Path.home() / "Library" / "Application Support" / "Granola" / "supabase.json"
        return token_path.exists()

    # Unknown connector type: assume configured to avoid hiding potential issues.
    return True


def _parse_iso_datetime(value: str | None) -> datetime | None:
    """Parse ISO datetime safely."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except Exception:
        return None


def _load_sync_task_last_success_by_connector() -> dict[str, datetime]:
    """Load latest successful sync timestamps from persisted setup sync tasks."""
    sync_tasks_path = Path(settings.atlas_data_dir) / "sync-tasks.json"
    if not sync_tasks_path.exists():
        return {}

    latest: dict[str, datetime] = {}
    try:
        import json

        raw = json.loads(sync_tasks_path.read_text())
    except Exception:
        return {}

    for task in raw.values():
        completed_at = _parse_iso_datetime(task.get("completed_at"))
        if not completed_at:
            continue

        connectors = task.get("connectors", {})
        if not isinstance(connectors, dict):
            continue

        for connector_name, connector_state in connectors.items():
            if not isinstance(connector_state, dict):
                continue
            if connector_state.get("status") != "completed":
                continue

            normalized = CONNECTOR_ALIASES.get(connector_name, connector_name)
            prev = latest.get(normalized)
            if prev is None or completed_at > prev:
                latest[normalized] = completed_at

    return latest


def _connector_from_job_label(label: str) -> str | None:
    """Extract connector key from com.codos.<connector>-sync label."""
    match = re.match(r"^com\.atlas\.([a-z0-9_-]+)-sync$", label)
    if not match:
        return None
    return match.group(1)


def _get_last_run_time(label: str, codos_path: Path, sync_fallback: dict[str, datetime] | None = None) -> str | None:
    """Get last run time for a job by checking log file modification time."""
    log_dir = JOB_LOG_DIRS.get(label)
    if not log_dir:
        return None

    log_path = _resolve_log_path(codos_path, log_dir, "stdout.log")
    if log_path:
        try:
            mtime = log_path.stat().st_mtime
            return datetime.fromtimestamp(mtime).isoformat()
        except Exception:
            pass

    # Fallback: if manual sync completed but no log exists, use sync task timestamp.
    if sync_fallback:
        connector = _connector_from_job_label(label)
        if connector and connector in sync_fallback:
            return sync_fallback[connector].isoformat()

    return None


def _get_atlas_jobs(codos_path: Path, sync_fallback: dict[str, datetime] | None = None) -> list[JobHealth]:
    """Get status of Atlas LaunchAgent jobs."""
    jobs = []
    try:
        result = subprocess.run(["launchctl", "list"], capture_output=True, text=True, timeout=10)

        for line in result.stdout.splitlines():
            # Include both com.codos.* and com.dkos.* jobs
            if "com.codos." not in line and "com.dkos." not in line:
                continue

            parts = line.split()
            if len(parts) >= 3:
                pid_str = parts[0]
                exit_code_str = parts[1]
                label = parts[2]

                pid = int(pid_str) if pid_str != "-" else None
                exit_code = int(exit_code_str) if exit_code_str != "-" else None

                # Determine status
                if pid is not None:
                    status = "running"
                elif exit_code is not None and exit_code != 0:
                    status = "error"
                else:
                    status = "stopped"

                # For scheduled workflows, prefer runs.jsonl over LaunchAgent exit code
                if label.startswith("com.codos.workflow."):
                    wf_id = label.removeprefix("com.codos.workflow.")
                    wf_run = _get_workflow_last_run(codos_path, wf_id)
                    if wf_run:
                        wf_status, wf_timestamp = wf_run
                        if wf_status == "success":
                            status = "stopped"
                            exit_code = 0
                        if wf_timestamp:
                            last_run = wf_timestamp
                        else:
                            last_run = _get_last_run_time(label, codos_path, sync_fallback)
                    else:
                        last_run = _get_last_run_time(label, codos_path, sync_fallback)
                else:
                    last_run = _get_last_run_time(label, codos_path, sync_fallback)

                jobs.append(
                    JobHealth(
                        label=label,
                        status=status,
                        pid=pid,
                        exit_code=exit_code,
                        last_run=last_run,
                    )
                )
    except Exception:
        pass

    return jobs


# Map connectors to their scheduled workflow IDs (for freshness checks)
CONNECTOR_WORKFLOW_MAP: dict[str, str] = {
    "gmail": "gmail-ingestion",
    "calendar": "calendar-ingestion",
    "slack": "slack-ingestion",
    "linear": "linear-ingestion",
    "notion": "notion-ingestion",
}


def _get_workflow_last_success(codos_path: Path, workflow_id: str) -> datetime | None:
    """Get timestamp of last successful workflow run from runs.jsonl."""
    import json as _json
    log_path = codos_path / "dev" / "Logs" / "workflows" / workflow_id / "runs.jsonl"
    if not log_path.exists():
        return None
    try:
        lines = log_path.read_text(encoding="utf-8").strip().splitlines()
        # Walk backwards to find last success
        for line in reversed(lines):
            entry = _json.loads(line)
            if entry.get("status") == "success":
                ts = entry.get("timestamp")
                if ts:
                    return datetime.fromisoformat(ts.replace("Z", "+00:00")).replace(tzinfo=None)
        return None
    except Exception:
        return None


def _get_workflow_last_run(codos_path: Path, workflow_id: str) -> tuple[str, str | None] | None:
    """Get status and timestamp of the most recent workflow run from runs.jsonl."""
    import json as _json
    log_path = codos_path / "dev" / "Logs" / "workflows" / workflow_id / "runs.jsonl"
    if not log_path.exists():
        return None
    try:
        lines = log_path.read_text(encoding="utf-8").strip().splitlines()
        if not lines:
            return None
        entry = _json.loads(lines[-1])
        return (entry.get("status", "unknown"), entry.get("timestamp"))
    except Exception:
        return None


def _get_connector_freshness(codos_path: Path, sync_fallback: dict[str, datetime] | None = None) -> list[ConnectorFreshness]:
    """Check data freshness for each connector using workflow logs, legacy sync logs, or sync tasks."""
    freshness_list = []
    now = datetime.now()

    for connector in CONNECTORS:
        last_modified: datetime | None = None

        # 1. Check scheduled workflow run logs (preferred source)
        workflow_id = CONNECTOR_WORKFLOW_MAP.get(connector)
        if workflow_id:
            wf_ts = _get_workflow_last_success(codos_path, workflow_id)
            if wf_ts and (last_modified is None or wf_ts > last_modified):
                last_modified = wf_ts

        # 2. Check legacy LaunchAgent sync logs
        log_path = _resolve_log_path(codos_path, f"{connector}-sync", "stdout.log")
        if log_path:
            try:
                mtime = log_path.stat().st_mtime
                log_ts = datetime.fromtimestamp(mtime)
                if last_modified is None or log_ts > last_modified:
                    last_modified = log_ts
            except Exception:
                pass

        # 3. Fallback to sync task timestamps
        if last_modified is None and sync_fallback and connector in sync_fallback:
            last_modified = sync_fallback[connector]

        if last_modified is None:
            configured = _is_connector_configured(connector, codos_path)
            freshness_list.append(
                ConnectorFreshness(
                    connector=connector,
                    last_sync=None,
                    age_minutes=None,
                    status="unknown" if configured else "not_configured",
                )
            )
            continue

        age_minutes = int((now - last_modified).total_seconds() / 60)
        freshness_list.append(
            ConnectorFreshness(
                connector=connector,
                last_sync=last_modified.isoformat(),
                age_minutes=age_minutes,
                status="fresh" if age_minutes < 120 else "stale",
            )
        )

    return freshness_list


def _get_recent_errors(codos_path: Path) -> list[ErrorEntry]:
    """Parse stderr.log files for errors in the last 24 hours."""
    errors = []
    now = datetime.now()
    cutoff = now - timedelta(hours=24)

    for connector in CONNECTORS:
        log_path = _resolve_log_path(codos_path, f"{connector}-sync", "stderr.log")
        if not log_path:
            continue

        try:
            # Check if file was modified in the last 24 hours
            mtime = log_path.stat().st_mtime
            if datetime.fromtimestamp(mtime) < cutoff:
                continue

            # Read last 100 lines (limit to avoid memory issues)
            with open(log_path, errors="ignore") as f:
                lines = f.readlines()[-100:]

            for line in lines:
                line = line.strip()
                if not line:
                    continue

                # Try to extract timestamp from common log formats
                # Format: 2024-01-15T10:30:00 or [2024-01-15 10:30:00]
                timestamp_match = re.search(r"(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})", line)

                if timestamp_match:
                    try:
                        ts_str = timestamp_match.group(1).replace("T", " ")
                        log_time = datetime.strptime(ts_str, "%Y-%m-%d %H:%M:%S")
                        if log_time < cutoff:
                            continue
                        timestamp = log_time.isoformat()
                    except ValueError:
                        timestamp = now.isoformat()
                else:
                    # Use file mtime as approximate timestamp
                    timestamp = datetime.fromtimestamp(mtime).isoformat()

                # Look for error indicators
                lower_line = line.lower()

                # Skip transient Telethon MTProto warnings (reconnects handle these)
                if any(noise in lower_line for noise in [
                    "too many messages had to be ignored consecutively",
                    "server sent a very old message",
                    "server sent a very new message",
                    "server resent the older message",
                    "server closed the connection",
                    "at connecting failed",
                    "graceful disconnection timed out",
                ]):
                    continue

                if any(indicator in lower_line for indicator in ["error", "exception", "failed", "traceback"]):
                    errors.append(
                        ErrorEntry(
                            connector=connector,
                            timestamp=timestamp,
                            message=line[:500],  # Limit message length
                        )
                    )
        except Exception:
            pass

    # Sort by timestamp descending, limit to 50 most recent
    errors.sort(key=lambda e: e.timestamp, reverse=True)
    return errors[:50]


def _compute_health() -> dict:
    """Compute full health status."""
    codos_path = _load_codos_path()
    sync_fallback = _load_sync_task_last_success_by_connector()

    # Check services
    services = []
    for svc in SERVICES:
        listening = _check_port(svc["port"])
        services.append(
            ServiceHealth(
                name=svc["name"],
                port=svc["port"],
                status="healthy" if listening else "unhealthy",
                listening=listening,
            )
        )

    # Get job status
    jobs = _get_atlas_jobs(codos_path, sync_fallback)

    # Get connector freshness
    freshness = _get_connector_freshness(codos_path, sync_fallback)

    # Get recent errors
    errors = _get_recent_errors(codos_path)

    # Compute summary
    # Services: healthy if listening
    healthy_services = sum(1 for s in services if s.status == "healthy")
    # Jobs: healthy if running OR stopped with exit_code == 0
    healthy_jobs = sum(1 for j in jobs if j.status == "running" or j.exit_code == 0)
    # Freshness: healthy if fresh/stale OR not configured; only "unknown" is failing.
    healthy_freshness = sum(1 for f in freshness if f.status in ("fresh", "stale", "not_configured"))

    total = len(services) + len(jobs) + len(freshness)
    healthy = healthy_services + healthy_jobs + healthy_freshness
    failing = total - healthy

    return {
        "services": services,
        "jobs": jobs,
        "freshness": freshness,
        "errors": errors,
        "summary": HealthSummary(
            healthy=healthy,
            failing=failing,
            total=total,
        ),
        "timestamp": datetime.now().isoformat(),
    }


# ==================== Route Handlers ====================


@router.get("/full", response_model=FullHealthResponse)
async def get_full_health(refresh: bool = False):
    """Get comprehensive health status of the Atlas system.

    Args:
        refresh: If True, bypass cache and fetch fresh status

    Returns:
        Full health status including services, jobs, data freshness, and errors
    """
    global _health_cache

    now = time.time()

    # Check cache
    if not refresh and _health_cache is not None:
        cached_data, cached_time = _health_cache
        if now - cached_time < CACHE_TTL:
            return FullHealthResponse(
                **cached_data,
                cached=True,
            )

    # Compute fresh health status
    health_data = _compute_health()

    # Update cache
    _health_cache = (health_data, now)

    return FullHealthResponse(
        **health_data,
        cached=False,
    )
