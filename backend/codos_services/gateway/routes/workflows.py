"""
Scheduled workflows API.
Lists workflow configs, enables/disables schedules, and triggers runs.
"""

import json
import os
import re
import subprocess
from pathlib import Path

import yaml
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.codos_models.settings import settings

from ..auth import require_api_key

LAUNCH_AGENTS_DIR = Path.home() / "Library" / "LaunchAgents"
WORKFLOW_LABEL_PREFIX = "com.codos.workflow"

WORKFLOW_DIR_REL = Path("skills") / "Scheduled Workflows" / "workflows"
WORKFLOW_SKILL_DIR_REL = Path("skills") / "Scheduled Workflows"

router = APIRouter(
    prefix="/api/workflows",
    tags=["workflows"],
    dependencies=[Depends(require_api_key)],
)


class WorkflowSchedule(BaseModel):
    type: str
    time: str | None = None
    day: str | None = None
    cron: str | None = None
    interval_minutes: int | None = None


class WorkflowInfo(BaseModel):
    id: str
    name: str
    description: str | None = None
    schedule: WorkflowSchedule | None = None
    enabled: bool
    output_path: str | None = None
    config_path: str
    last_run: str | None = None
    last_status: str | None = None
    last_error: str | None = None
    last_duration_ms: int | None = None


class WorkflowDetail(BaseModel):
    workflow: WorkflowInfo
    config: dict
    raw_yaml: str | None = None


class WorkflowSaveRequest(BaseModel):
    config: dict | None = None
    raw_yaml: str | None = None
    id: str | None = None


class WorkflowValidateResponse(BaseModel):
    valid: bool
    errors: list[str]


class RunHistoryEntry(BaseModel):
    id: str | None = None
    name: str | None = None
    status: str | None = None
    output_path: str | None = None
    timestamp: str | None = None
    duration_ms: int | None = None
    error: str | None = None
    message: str | None = None


class RunHistoryResponse(BaseModel):
    entries: list[RunHistoryEntry]


def _load_codos_path() -> Path:
    return settings.get_codos_path()


def _get_bun_path() -> str:
    return settings.bun_path


def _workflow_dir(codos_path: Path) -> Path:
    return codos_path / WORKFLOW_DIR_REL


def _skill_dir(codos_path: Path) -> Path:
    return codos_path / WORKFLOW_SKILL_DIR_REL


def _get_config_path(codos_path: Path, workflow_id: str) -> Path | None:
    base = _workflow_dir(codos_path) / f"{workflow_id}.yaml"
    if base.exists():
        return base
    alt = _workflow_dir(codos_path) / f"{workflow_id}.yml"
    if alt.exists():
        return alt
    return None


def _validate_workflow_id(workflow_id: str) -> None:
    if not workflow_id:
        raise HTTPException(status_code=400, detail="Workflow id is required")
    if not re.match(r"^[a-z0-9][a-z0-9\\-]*$", workflow_id):
        raise HTTPException(
            status_code=400,
            detail="Workflow id must be lowercase letters, numbers, and dashes only",
        )


def _validate_schedule(schedule: dict, errors: list[str]) -> None:
    schedule_type = schedule.get("type")
    if schedule_type not in {"daily", "weekly", "cron", "interval", "manual"}:
        errors.append("schedule.type must be daily, weekly, cron, interval, or manual")
        return

    if schedule_type in {"daily", "weekly"}:
        if not schedule.get("time"):
            errors.append("schedule.time is required for daily/weekly")
        if schedule_type == "weekly" and not schedule.get("day"):
            errors.append("schedule.day is required for weekly")

    if schedule_type == "interval" and not schedule.get("interval_minutes"):
        errors.append("schedule.interval_minutes is required for interval schedules")

    if schedule_type == "cron" and not schedule.get("cron"):
        errors.append("schedule.cron is required for cron schedules")


def _validate_config(config: dict) -> list[str]:
    errors: list[str] = []
    if not isinstance(config, dict):
        return ["Config must be an object"]
    if not config.get("name"):
        errors.append("name is required")
    if not config.get("prompt"):
        errors.append("prompt is required")

    schedule = config.get("schedule")
    if schedule is not None:
        if not isinstance(schedule, dict):
            errors.append("schedule must be an object")
        else:
            _validate_schedule(schedule, errors)
    return errors


def _serialize_yaml(config: dict) -> str:
    return yaml.safe_dump(config, sort_keys=False, allow_unicode=True)


def _load_yaml(path: Path) -> dict:
    try:
        with open(path, encoding="utf-8") as handle:
            return yaml.safe_load(handle) or {}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to read {path}: {exc}") from exc


def _try_load_yaml(path: Path) -> tuple[dict | None, str | None]:
    try:
        with open(path, encoding="utf-8") as handle:
            raw = handle.read()
        return yaml.safe_load(raw) or {}, raw
    except Exception:
        return None, None


def _get_plist_path(workflow_id: str) -> Path:
    return LAUNCH_AGENTS_DIR / f"{WORKFLOW_LABEL_PREFIX}.{workflow_id}.plist"


def _read_last_run(codos_path: Path, workflow_id: str) -> dict | None:
    """Read the last run entry from runs.jsonl. Returns full dict or None."""
    log_path = codos_path / "dev" / "Logs" / "workflows" / workflow_id / "runs.jsonl"
    if not log_path.exists():
        return None
    try:
        lines = log_path.read_text(encoding="utf-8").strip().splitlines()
        if not lines:
            return None
        result: dict = json.loads(lines[-1])
        return result
    except Exception:
        return None


def _relative_path(codos_path: Path, path: Path) -> str:
    try:
        return str(path.relative_to(codos_path))
    except ValueError:
        return str(path)


def _config_to_info(codos_path: Path, workflow_id: str, config: dict, config_path: Path) -> WorkflowInfo:
    schedule = config.get("schedule")
    output = config.get("output") or {}
    last_entry = _read_last_run(codos_path, workflow_id)
    return WorkflowInfo(
        id=workflow_id,
        name=config.get("name") or workflow_id,
        description=config.get("description"),
        schedule=WorkflowSchedule(**schedule) if isinstance(schedule, dict) else None,
        enabled=_get_plist_path(workflow_id).exists(),
        output_path=output.get("path"),
        config_path=_relative_path(codos_path, config_path),
        last_run=last_entry.get("timestamp") if last_entry else None,
        last_status=last_entry.get("status") if last_entry else None,
        last_error=last_entry.get("error") or last_entry.get("message") if last_entry else None,
        last_duration_ms=last_entry.get("duration_ms") if last_entry else None,
    )


def _list_configs(codos_path: Path) -> list[tuple[str, Path]]:
    workflow_dir = _workflow_dir(codos_path)
    if not workflow_dir.exists():
        return []

    configs: list[tuple[str, Path]] = []
    for path in sorted(workflow_dir.glob("*.yaml")) + sorted(workflow_dir.glob("*.yml")):
        if path.name.startswith("_"):
            continue
        workflow_id = path.stem
        configs.append((workflow_id, path))
    return configs


def _run_schedule_command(codos_path: Path, args: list[str]) -> None:
    bun_path = _get_bun_path()
    skill_dir = _skill_dir(codos_path)
    command = [bun_path, "run", "schedule-workflows.ts", *args]

    result = subprocess.run(
        command,
        cwd=str(skill_dir),
        capture_output=True,
        text=True,
        env=os.environ.copy(),
    )

    if result.returncode != 0:
        raise HTTPException(status_code=500, detail=result.stderr or result.stdout or "Command failed")


def _start_workflow_run(codos_path: Path, workflow_id: str) -> None:
    script = _skill_dir(codos_path) / "run-workflow-cc.sh"
    if not script.exists():
        raise HTTPException(status_code=500, detail="run-workflow-cc.sh not found")

    subprocess.Popen(
        [str(script), "--id", workflow_id],
        cwd=str(_skill_dir(codos_path)),
        env=os.environ.copy(),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def _read_history(codos_path: Path, workflow_id: str, limit: int = 20) -> list[RunHistoryEntry]:
    log_path = codos_path / "dev" / "Logs" / "workflows" / workflow_id / "runs.jsonl"
    if not log_path.exists():
        return []

    try:
        lines = log_path.read_text(encoding="utf-8").strip().splitlines()
        entries = []
        for line in lines[-limit:]:
            try:
                payload = json.loads(line)
                entries.append(RunHistoryEntry(**payload))
            except Exception:
                continue
        return entries
    except Exception:
        return []


@router.get("", response_model=list[WorkflowInfo])
async def list_workflows() -> list[WorkflowInfo]:
    codos_path = _load_codos_path()
    configs = _list_configs(codos_path)
    workflows: list[WorkflowInfo] = []
    for workflow_id, path in configs:
        config, _raw = _try_load_yaml(path)
        if config is None:
            continue
        workflows.append(_config_to_info(codos_path, workflow_id, config, path))
    return workflows


@router.post("/validate", response_model=WorkflowValidateResponse)
async def validate_workflow(request: WorkflowSaveRequest) -> WorkflowValidateResponse:
    if request.raw_yaml:
        try:
            config = yaml.safe_load(request.raw_yaml) or {}
        except Exception as exc:
            return WorkflowValidateResponse(valid=False, errors=[f"Invalid YAML: {exc}"])
    else:
        config = request.config or {}

    errors = _validate_config(config)
    return WorkflowValidateResponse(valid=len(errors) == 0, errors=errors)


@router.get("/{workflow_id}", response_model=WorkflowDetail)
async def get_workflow(workflow_id: str) -> WorkflowDetail:
    _validate_workflow_id(workflow_id)
    codos_path = _load_codos_path()
    config_path = _get_config_path(codos_path, workflow_id)
    if not config_path:
        raise HTTPException(status_code=404, detail="Workflow not found")

    config, raw = _try_load_yaml(config_path)
    if config is None:
        raise HTTPException(status_code=500, detail="Failed to load workflow config")
    workflow = _config_to_info(codos_path, workflow_id, config, config_path)
    return WorkflowDetail(workflow=workflow, config=config, raw_yaml=raw)


@router.get("/{workflow_id}/history", response_model=RunHistoryResponse)
async def workflow_history(workflow_id: str, limit: int = 20) -> RunHistoryResponse:
    _validate_workflow_id(workflow_id)
    codos_path = _load_codos_path()
    entries = _read_history(codos_path, workflow_id, limit=limit)
    return RunHistoryResponse(entries=entries)


@router.post("/{workflow_id}/run")
async def run_workflow(workflow_id: str) -> dict:
    _validate_workflow_id(workflow_id)
    codos_path = _load_codos_path()
    if not _get_config_path(codos_path, workflow_id):
        raise HTTPException(status_code=404, detail="Workflow not found")

    _start_workflow_run(codos_path, workflow_id)
    return {"status": "started"}


@router.post("/{workflow_id}/enable")
async def enable_workflow(workflow_id: str) -> dict:
    _validate_workflow_id(workflow_id)
    codos_path = _load_codos_path()
    if not _get_config_path(codos_path, workflow_id):
        raise HTTPException(status_code=404, detail="Workflow not found")

    _run_schedule_command(codos_path, ["enable", workflow_id])
    return {"status": "enabled"}


@router.post("/{workflow_id}/disable")
async def disable_workflow(workflow_id: str) -> dict:
    _validate_workflow_id(workflow_id)
    codos_path = _load_codos_path()
    if not _get_config_path(codos_path, workflow_id):
        raise HTTPException(status_code=404, detail="Workflow not found")

    _run_schedule_command(codos_path, ["disable", workflow_id])
    return {"status": "disabled"}


@router.post("")
async def create_workflow(request: WorkflowSaveRequest) -> dict:
    codos_path = _load_codos_path()
    workflow_id = (request.id or "").strip()
    _validate_workflow_id(workflow_id)

    workflow_dir = _workflow_dir(codos_path)
    workflow_dir.mkdir(parents=True, exist_ok=True)
    existing = _get_config_path(codos_path, workflow_id)
    if existing:
        raise HTTPException(status_code=400, detail="Workflow already exists")

    config_path = workflow_dir / f"{workflow_id}.yaml"

    if request.raw_yaml:
        try:
            config = yaml.safe_load(request.raw_yaml) or {}
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Invalid YAML: {exc}") from exc
        errors = _validate_config(config)
        if errors:
            raise HTTPException(status_code=400, detail="; ".join(errors))
        config_path.write_text(request.raw_yaml, encoding="utf-8")
    else:
        if not request.config:
            raise HTTPException(status_code=400, detail="config is required")
        errors = _validate_config(request.config)
        if errors:
            raise HTTPException(status_code=400, detail="; ".join(errors))
        config_path.write_text(_serialize_yaml(request.config), encoding="utf-8")

    return {"status": "created", "id": workflow_id}


@router.put("/{workflow_id}")
async def update_workflow(workflow_id: str, request: WorkflowSaveRequest) -> dict:
    codos_path = _load_codos_path()
    _validate_workflow_id(workflow_id)

    config_path = _get_config_path(codos_path, workflow_id)
    if not config_path:
        raise HTTPException(status_code=404, detail="Workflow not found")

    if request.raw_yaml:
        try:
            config = yaml.safe_load(request.raw_yaml) or {}
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Invalid YAML: {exc}") from exc
        errors = _validate_config(config)
        if errors:
            raise HTTPException(status_code=400, detail="; ".join(errors))
        config_path.write_text(request.raw_yaml, encoding="utf-8")
    else:
        if not request.config:
            raise HTTPException(status_code=400, detail="config is required")
        errors = _validate_config(request.config)
        if errors:
            raise HTTPException(status_code=400, detail="; ".join(errors))
        config_path.write_text(_serialize_yaml(request.config), encoding="utf-8")

    return {"status": "updated", "id": workflow_id}


@router.delete("/{workflow_id}")
async def delete_workflow(workflow_id: str) -> dict:
    codos_path = _load_codos_path()
    _validate_workflow_id(workflow_id)

    config_path = _get_config_path(codos_path, workflow_id)
    if not config_path:
        raise HTTPException(status_code=404, detail="Workflow not found")

    try:
        _run_schedule_command(codos_path, ["disable", workflow_id])
    except HTTPException:
        pass

    try:
        config_path.unlink()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to delete workflow: {exc}") from exc

    return {"status": "deleted", "id": workflow_id}
