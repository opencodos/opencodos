"""
Schedule routes for the Atlas wizard.
Handles schedule presets and LaunchAgent installation for automated syncs.
"""

import os
import plistlib
import re
import subprocess
from datetime import datetime, timedelta
from pathlib import Path

import yaml
from ..auth import require_api_key
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from ..settings import settings

# ==================== Configuration ====================

LAUNCH_AGENTS_DIR = Path.home() / "Library" / "LaunchAgents"

router = APIRouter(
    prefix="/api/setup/schedules",
    tags=["schedules"],
    dependencies=[Depends(require_api_key)],
)


# ==================== Pydantic Models ====================


class SchedulePreset(BaseModel):
    id: str
    label: str
    description: str
    cron: str | None = None  # For cron-based schedules
    interval_minutes: int | None = None  # For interval-based schedules


class ConnectorPresets(BaseModel):
    connector: str
    name: str
    default_preset: str
    presets: list[SchedulePreset]


class PresetsResponse(BaseModel):
    connectors: list[ConnectorPresets]


class ScheduleSelection(BaseModel):
    connector: str
    preset_id: str


class PreviewRequest(BaseModel):
    selections: list[ScheduleSelection]


class PreviewItem(BaseModel):
    connector: str
    schedule: str  # Human-readable description
    next_run: str | None = None


class PreviewResponse(BaseModel):
    items: list[PreviewItem]


class InstallRequest(BaseModel):
    selections: list[ScheduleSelection]


class InstallResult(BaseModel):
    connector: str
    success: bool
    plist_path: str | None = None
    error: str | None = None


class InstallResponse(BaseModel):
    success: bool
    results: list[InstallResult]
    message: str


class InstalledSchedule(BaseModel):
    connector: str
    name: str
    preset_id: str | None = None
    preset_label: str | None = None
    schedule_description: str | None = None
    plist_path: str | None = None
    is_active: bool = False
    last_sync: str | None = None
    next_sync: str | None = None
    supports_sync: bool = True


class InstalledSchedulesResponse(BaseModel):
    schedules: list[InstalledSchedule]


class TelegramFilterConfig(BaseModel):
    sync_unread_only: bool = False
    include_dms: bool = True
    include_groups: bool = True
    include_channels: bool = False
    include_muted: bool = False
    include_archived: bool = False
    mark_unread_after_sync: bool = False


# ==================== Schedule Presets ====================

SCHEDULE_PRESETS: dict[str, ConnectorPresets] = {
    "telegram": ConnectorPresets(
        connector="telegram",
        name="Telegram",
        default_preset="10min",
        presets=[
            SchedulePreset(id="5min", label="Every 5 minutes", description="High frequency sync", interval_minutes=5),
            SchedulePreset(
                id="10min",
                label="Every 10 minutes (Recommended)",
                description="Balanced frequency",
                interval_minutes=10,
            ),
            SchedulePreset(id="hourly", label="Every hour", description="Low frequency sync", interval_minutes=60),
            SchedulePreset(id="manual", label="Manual only", description="No automatic sync"),
        ],
    ),
    "slack": ConnectorPresets(
        connector="slack",
        name="Slack",
        default_preset="default",
        presets=[
            SchedulePreset(
                id="default",
                label="Three times daily (8:00, 14:00, 20:00)",
                description="Morning, afternoon, evening sync via Official Slack MCP",
                cron="0 8,14,20 * * *",
            ),
            SchedulePreset(
                id="twice",
                label="Twice daily (8:00, 20:00)",
                description="Morning and evening sync",
                cron="0 8,20 * * *",
            ),
            SchedulePreset(id="manual", label="Manual only", description="No automatic sync"),
        ],
    ),
    "gmail": ConnectorPresets(
        connector="gmail",
        name="Gmail",
        default_preset="default",
        presets=[
            SchedulePreset(id="default", label="Daily at 7:45", description="Morning sync", cron="45 7 * * *"),
            SchedulePreset(id="twice", label="Twice daily", description="Morning and evening", cron="45 7,18 * * *"),
            SchedulePreset(id="manual", label="Manual only", description="No automatic sync"),
        ],
    ),
    "calendar": ConnectorPresets(
        connector="calendar",
        name="Google Calendar",
        default_preset="default",
        presets=[
            SchedulePreset(id="default", label="Daily at 7:45", description="Morning sync", cron="45 7 * * *"),
            SchedulePreset(id="hourly", label="Every hour", description="Frequent sync", interval_minutes=60),
            SchedulePreset(id="manual", label="Manual only", description="No automatic sync"),
        ],
    ),
    "notion": ConnectorPresets(
        connector="notion",
        name="Notion",
        default_preset="default",
        presets=[
            SchedulePreset(
                id="default",
                label="Three times daily (8:05, 14:05, 20:05)",
                description="Morning, afternoon, evening sync via Notion MCP workflow",
                cron="5 8,14,20 * * *",
            ),
            SchedulePreset(id="twice", label="Twice daily (8:05, 20:05)", description="Morning and evening sync", cron="5 8,20 * * *"),
            SchedulePreset(id="manual", label="Manual only", description="No automatic sync"),
        ],
    ),
    "linear": ConnectorPresets(
        connector="linear",
        name="Linear",
        default_preset="default",
        presets=[
            SchedulePreset(id="default", label="Daily at 7:45", description="Morning sync", cron="45 7 * * *"),
            SchedulePreset(id="twice", label="Twice daily", description="Morning and evening", cron="45 7,18 * * *"),
            SchedulePreset(id="manual", label="Manual only", description="No automatic sync"),
        ],
    ),
    "github": ConnectorPresets(
        connector="github",
        name="GitHub",
        default_preset="default",
        presets=[
            SchedulePreset(id="default", label="Daily at 7:45", description="Morning sync", cron="45 7 * * *"),
            SchedulePreset(id="manual", label="Manual only", description="No automatic sync"),
        ],
    ),
    "granola": ConnectorPresets(
        connector="granola",
        name="Granola",
        default_preset="default",
        presets=[
            SchedulePreset(id="default", label="Every 30 minutes", description="Regular sync", interval_minutes=30),
            SchedulePreset(id="frequent", label="Every 15 minutes", description="High frequency", interval_minutes=15),
            SchedulePreset(id="manual", label="Manual only", description="No automatic sync"),
        ],
    ),
    "googledrive": ConnectorPresets(
        connector="googledrive",
        name="Google Drive",
        default_preset="manual",
        presets=[
            SchedulePreset(id="manual", label="Manual only", description="No automatic sync available yet"),
        ],
    ),
}

# Connector aliases - maps frontend connector names to preset keys
CONNECTOR_ALIASES = {
    "googlecalendar": "calendar",
}

from ..connector_commands import CONNECTOR_COMMANDS

# Maps connector names to display names
CONNECTOR_NAMES = {
    "telegram": "Telegram",
    "slack": "Slack",
    "gmail": "Gmail",
    "calendar": "Google Calendar",
    "notion": "Notion",
    "linear": "Linear",
    "github": "GitHub",
    "granola": "Granola",
    "googledrive": "Google Drive",
}


# ==================== Helper Functions ====================


def _get_telegram_config_path() -> Path:
    """Get Telegram config.yaml path — writable location in bundle mode."""
    if settings.is_bundle_mode:
        return settings.get_telegram_data_dir() / "config.yaml"
    return settings.get_codos_path() / "ingestion" / "Telegram-agent" / "config.yaml"


def _load_telegram_filters(codos_path: Path) -> dict:
    """Load Telegram sync filters from config.yaml."""
    config_path = _get_telegram_config_path()
    if not config_path.exists():
        return {}

    try:
        with open(config_path) as f:
            raw = yaml.safe_load(f) or {}
        return raw.get("sync", {})
    except Exception:
        return {}


def _save_telegram_filters(codos_path: Path, filters: TelegramFilterConfig) -> None:
    """Save Telegram sync filters to config.yaml."""
    config_path = _get_telegram_config_path()

    raw = {}
    if config_path.exists():
        with open(config_path) as f:
            raw = yaml.safe_load(f) or {}

    config_path.parent.mkdir(parents=True, exist_ok=True)

    if "sync" not in raw:
        raw["sync"] = {}

    raw["sync"]["sync_unread_only"] = filters.sync_unread_only
    raw["sync"]["include_dms"] = filters.include_dms
    raw["sync"]["include_groups"] = filters.include_groups
    raw["sync"]["include_channels"] = filters.include_channels
    raw["sync"]["include_muted"] = filters.include_muted
    raw["sync"]["include_archived"] = filters.include_archived
    raw["sync"]["mark_unread_after_sync"] = filters.mark_unread_after_sync

    with open(config_path, "w") as f:
        yaml.dump(raw, f, default_flow_style=False, allow_unicode=True, sort_keys=False)


def _generate_process_cleanup_plist() -> str:
    """Generate the process-cleanup LaunchAgent plist.

    This plist runs every 15 minutes and kills orphaned claude processes.

    Only kills processes that:
    1. Have no controlling terminal (TTY == "?") - protects interactive sessions
    2. AND have been running for 2+ hours - gives background tasks time to complete

    This prevents killing active terminal sessions while cleaning up truly orphaned processes.
    """
    return """<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.codos.process-cleanup</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>-c</string>
        <string>ps -eo pid,etime,tty,comm | grep claude | awk '$3 == "?" &amp;&amp; ($2 ~ /-/ || ($2 ~ /:/ &amp;&amp; split($2,a,":") == 3 &amp;&amp; a[1] >= 2)) {print $1}' | xargs kill -9 2>/dev/null; echo "$(date): Cleanup ran" >> /tmp/atlas-cleanup.log</string>
    </array>
    <key>StartInterval</key>
    <integer>900</integer>
</dict>
</plist>
"""


def _generate_telegram_agent_plist(codos_path: Path) -> str:
    """Generate telegram-agent service plist with proper KeepAlive settings.

    Uses KeepAlive dict instead of true to prevent infinite respawning:
    - SuccessfulExit: false - don't respawn if exit code 0
    - Crashed: true - respawn only on crashes
    - ThrottleInterval: 60 - wait 60s between respawns
    """
    venv_python = codos_path / ".venv" / "bin" / "python"
    log_dir = codos_path / "dev" / "Logs" / "telegram-agent"

    return f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.codos.telegram-agent</string>

    <key>ProgramArguments</key>
    <array>
        <string>{venv_python}</string>
        <string>-m</string>
        <string>backend</string>
        <string>telegram-agent</string>
        <string>server</string>
    </array>

    <key>WorkingDirectory</key>
    <string>{codos_path}</string>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
        <key>Crashed</key>
        <true/>
    </dict>

    <key>ThrottleInterval</key>
    <integer>60</integer>

    <key>StandardOutPath</key>
    <string>{log_dir}/stdout.log</string>

    <key>StandardErrorPath</key>
    <string>{log_dir}/stderr.log</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>{codos_path}/.venv/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
        <key>PYTHONPATH</key>
        <string>{codos_path}</string>
    </dict>
</dict>
</plist>
"""


def _install_process_cleanup_plist() -> bool:
    """Install the process-cleanup plist if not already present."""
    plist_path = LAUNCH_AGENTS_DIR / "com.codos.process-cleanup.plist"

    if plist_path.exists():
        return True  # Already installed

    try:
        plist_content = _generate_process_cleanup_plist()
        with open(plist_path, "w") as f:
            f.write(plist_content)

        subprocess.run(["launchctl", "load", str(plist_path)], capture_output=True, timeout=10)
        return True
    except Exception:
        return False


def _generate_plist(connector: str, preset: SchedulePreset, codos_path: Path) -> str:
    """Generate LaunchAgent plist XML for a connector schedule."""
    config = CONNECTOR_COMMANDS.get(connector)
    if not config:
        raise ValueError(f"Unknown connector: {connector}")

    working_dir = codos_path / config["cwd"]
    cmd = config["cmd"]

    # Build the full command path
    if settings.is_bundle_mode:
        bundle_root = os.environ.get("BUNDLE_ROOT", "")
        if cmd[0] == "bun":
            program = str(Path(bundle_root) / "bun" / "bin" / "bun")
            program_args = cmd[1:]
            working_dir = Path(bundle_root) / config["cwd"]
        else:
            # Python connectors (Telegram) → bundled python
            program = str(Path(bundle_root) / "python" / "bin" / "python3")
            program_args = cmd[1:]  # ["-m", "backend", "telegram-agent", "sync"]
            working_dir = Path(bundle_root) / "services"
    elif cmd[0] == "bun":
        program = settings.bun_path
        program_args = cmd[1:]
    else:
        # Dev mode Python — resolve relative cmd path against working_dir
        program = str(working_dir / cmd[0])
        program_args = cmd[1:]

    # Create log directory in a writable location
    log_dir = Path(settings.atlas_data_dir) / "logs" / f"{connector}-sync"
    log_dir.mkdir(parents=True, exist_ok=True)

    label = f"com.codos.{connector}-sync"

    # Build schedule section
    if preset.interval_minutes:
        schedule_section = f"""    <key>StartInterval</key>
    <integer>{preset.interval_minutes * 60}</integer>"""
    elif preset.cron:
        # Parse cron: minute hour day month weekday
        parts = preset.cron.split()
        minute = parts[0]
        hour = parts[1]

        # Handle multiple hours (e.g., "7,18")
        hours = hour.split(",")
        if len(hours) > 1:
            # Multiple calendar entries
            calendar_entries = []
            for h in hours:
                calendar_entries.append(f"""        <dict>
            <key>Hour</key>
            <integer>{h}</integer>
            <key>Minute</key>
            <integer>{minute}</integer>
        </dict>""")
            schedule_section = f"""    <key>StartCalendarInterval</key>
    <array>
{chr(10).join(calendar_entries)}
    </array>"""
        else:
            schedule_section = f"""    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>{hour}</integer>
        <key>Minute</key>
        <integer>{minute}</integer>
    </dict>"""
    else:
        # Manual only - no schedule
        return ""

    # Build program arguments array
    args_xml = "\n".join([f"        <string>{arg}</string>" for arg in program_args])

    # Include bundled bun directory in launchd PATH if available
    bundled_bun_env = settings.atlas_bundled_bun
    bundled_path_prefix = (
        str(Path(bundled_bun_env).parent) + ":" if bundled_bun_env and Path(bundled_bun_env).exists() else ""
    )

    # Build environment variables for the plist
    env_vars_xml = f"""        <key>PATH</key>
        <string>{bundled_path_prefix}{str(Path.home())}/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
        <key>ATLAS_DATA_DIR</key>
        <string>{settings.atlas_data_dir}</string>"""

    if settings.vault_path:
        env_vars_xml += f"""
        <key>VAULT_PATH</key>
        <string>{settings.vault_path}</string>"""

    if settings.atlas_env_file:
        env_vars_xml += f"""
        <key>ATLAS_ENV_FILE</key>
        <string>{settings.atlas_env_file}</string>"""

    if settings.codos_root:
        env_vars_xml += f"""
        <key>CODOS_ROOT</key>
        <string>{settings.codos_root}</string>"""

    # PYTHONPATH for python -m backend commands
    if settings.is_bundle_mode:
        bundle_root = os.environ.get("BUNDLE_ROOT", "")
        pythonpath = str(Path(bundle_root) / "services")
    else:
        pythonpath = str(codos_path)
    env_vars_xml += f"""
        <key>PYTHONPATH</key>
        <string>{pythonpath}</string>"""

    plist = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>{label}</string>
    <key>ProgramArguments</key>
    <array>
        <string>{program}</string>
{args_xml}
    </array>
    <key>WorkingDirectory</key>
    <string>{working_dir}</string>
{schedule_section}
    <key>StandardOutPath</key>
    <string>{log_dir}/stdout.log</string>
    <key>StandardErrorPath</key>
    <string>{log_dir}/stderr.log</string>
    <key>RunAtLoad</key>
    <false/>
    <key>EnvironmentVariables</key>
    <dict>
{env_vars_xml}
    </dict>
</dict>
</plist>
"""
    return plist


def _get_schedule_description(preset: SchedulePreset) -> str:
    """Get human-readable schedule description."""
    if preset.id == "manual":
        return "Manual sync only (no automation)"
    elif preset.interval_minutes:
        if preset.interval_minutes < 60:
            return f"Every {preset.interval_minutes} minutes"
        else:
            hours = preset.interval_minutes // 60
            return f"Every {hours} hour{'s' if hours > 1 else ''}"
    elif preset.cron:
        parts = preset.cron.split()
        minute = parts[0]
        hour = parts[1]
        hours = hour.split(",")
        if len(hours) > 1:
            return f"Daily at {', '.join(f'{h}:{minute.zfill(2)}' for h in hours)}"
        else:
            return f"Daily at {hour}:{minute.zfill(2)}"
    return preset.description


def _parse_plist_schedule(plist_data: dict) -> tuple[str | None, str | None]:
    """Parse schedule info from plist data. Returns (schedule_description, preset_id)."""
    if "StartInterval" in plist_data:
        interval_seconds = plist_data["StartInterval"]
        interval_minutes = interval_seconds // 60

        # Try to match to a preset
        preset_id = None
        if interval_minutes == 5:
            preset_id = "5min"
        elif interval_minutes == 10:
            preset_id = "10min"
        elif interval_minutes == 15:
            preset_id = "frequent"
        elif interval_minutes == 30:
            preset_id = "default"
        elif interval_minutes == 60:
            preset_id = "hourly"

        if interval_minutes < 60:
            desc = f"Every {interval_minutes} minutes"
        else:
            hours = interval_minutes // 60
            desc = f"Every {hours} hour{'s' if hours > 1 else ''}"

        return desc, preset_id

    elif "StartCalendarInterval" in plist_data:
        cal_interval = plist_data["StartCalendarInterval"]

        # Can be a dict or array of dicts
        if isinstance(cal_interval, dict):
            hour = cal_interval.get("Hour", 0)
            minute = cal_interval.get("Minute", 0)
            desc = f"Daily at {hour}:{str(minute).zfill(2)}"

            # Try to match preset
            if hour == 7 and minute == 45:
                return desc, "default"
            return desc, None

        elif isinstance(cal_interval, list):
            times = []
            for entry in cal_interval:
                hour = entry.get("Hour", 0)
                minute = entry.get("Minute", 0)
                times.append(f"{hour}:{str(minute).zfill(2)}")
            desc = f"Daily at {', '.join(times)}"

            # Try to match preset
            if len(times) == 2 and "7:45" in times and "18:45" in times:
                return desc, "default"
            elif len(times) == 3:
                return desc, "frequent"
            return desc, None

    return "Unknown schedule", None


def _calculate_next_run(plist_data: dict) -> str | None:
    """Calculate the next run time based on schedule."""
    now = datetime.now()

    if "StartInterval" in plist_data:
        interval_seconds = plist_data["StartInterval"]
        next_run = now + timedelta(seconds=interval_seconds)
        return next_run.isoformat()

    elif "StartCalendarInterval" in plist_data:
        cal_interval = plist_data["StartCalendarInterval"]

        # Get all scheduled times for today and tomorrow
        if isinstance(cal_interval, dict):
            entries = [cal_interval]
        else:
            entries = cal_interval

        next_times = []
        for entry in entries:
            hour = entry.get("Hour", 0)
            minute = entry.get("Minute", 0)

            # Check today
            today_run = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
            if today_run > now:
                next_times.append(today_run)

            # Check tomorrow
            tomorrow_run = today_run + timedelta(days=1)
            next_times.append(tomorrow_run)

        if next_times:
            next_run = min(next_times)
            return next_run.isoformat()

    return None


def _get_loaded_agents() -> set[str]:
    """Get set of currently loaded Atlas LaunchAgent labels."""
    try:
        result = subprocess.run(["launchctl", "list"], capture_output=True, text=True, timeout=10)

        loaded = set()
        for line in result.stdout.splitlines():
            if "com.codos." in line:
                # Extract the label from the line
                parts = line.split()
                if len(parts) >= 3:
                    label = parts[2]
                    loaded.add(label)
        return loaded
    except Exception:
        return set()


# ==================== Route Handlers ====================


@router.get("/presets", response_model=PresetsResponse)
async def get_presets(connector: str | None = None):
    """Get available schedule presets for all connectors or a specific connector."""
    if connector:
        # Resolve alias if needed
        resolved_connector = CONNECTOR_ALIASES.get(connector, connector)

        if resolved_connector in SCHEDULE_PRESETS:
            return PresetsResponse(connectors=[SCHEDULE_PRESETS[resolved_connector]])
        else:
            raise HTTPException(status_code=404, detail=f"Unknown connector: {connector}")

    return PresetsResponse(connectors=list(SCHEDULE_PRESETS.values()))


@router.get("/installed", response_model=InstalledSchedulesResponse)
async def get_installed_schedules():
    """Get all connectors with their schedule status."""
    schedules = []

    # Get list of loaded agents
    loaded_agents = _get_loaded_agents()

    # Build a map of installed plists
    installed_plists: dict[str, dict] = {}
    if LAUNCH_AGENTS_DIR.exists():
        for plist_file in LAUNCH_AGENTS_DIR.glob("com.codos.*.plist"):
            try:
                filename = plist_file.stem
                match = re.match(r"com\.atlas\.(.+)-sync", filename)
                if not match:
                    continue
                connector = match.group(1)
                with open(plist_file, "rb") as f:
                    plist_data = plistlib.load(f)
                installed_plists[connector] = {
                    "plist_data": plist_data,
                    "plist_path": str(plist_file),
                }
            except Exception:
                continue

    # Return all connectors from SCHEDULE_PRESETS
    for connector, connector_presets in SCHEDULE_PRESETS.items():
        # Check if connector has real sync support (more than just "manual")
        has_sync_support = any(p.id != "manual" for p in connector_presets.presets)

        # Check if installed
        installed = installed_plists.get(connector)

        if installed:
            plist_data = installed["plist_data"]
            plist_path = installed["plist_path"]

            # Get schedule info from plist
            schedule_desc, preset_id = _parse_plist_schedule(plist_data)
            next_run = _calculate_next_run(plist_data)

            # Check if loaded
            label = plist_data.get("Label", f"com.codos.{connector}-sync")
            is_loaded = label in loaded_agents

            # Get preset label
            preset_label = None
            if preset_id:
                preset = next((p for p in connector_presets.presets if p.id == preset_id), None)
                if preset:
                    preset_label = preset.label

            schedules.append(
                InstalledSchedule(
                    connector=connector,
                    name=connector_presets.name,
                    preset_id=preset_id,
                    preset_label=preset_label or schedule_desc,
                    schedule_description=schedule_desc,
                    plist_path=plist_path,
                    is_active=is_loaded,
                    last_sync=None,
                    next_sync=next_run,
                    supports_sync=has_sync_support,
                )
            )
        else:
            # Not installed - show as inactive
            schedules.append(
                InstalledSchedule(
                    connector=connector,
                    name=connector_presets.name,
                    preset_id=None,
                    preset_label=None,
                    schedule_description=None,
                    plist_path=None,
                    is_active=False,
                    last_sync=None,
                    next_sync=None,
                    supports_sync=has_sync_support,
                )
            )

    return InstalledSchedulesResponse(schedules=schedules)


@router.post("/preview", response_model=PreviewResponse)
async def preview_schedules(request: PreviewRequest):
    """Get human-readable preview of selected schedules."""
    items = []

    for selection in request.selections:
        connector_presets = SCHEDULE_PRESETS.get(selection.connector)
        if not connector_presets:
            continue

        preset = next((p for p in connector_presets.presets if p.id == selection.preset_id), None)
        if not preset:
            continue

        items.append(
            PreviewItem(
                connector=selection.connector,
                schedule=_get_schedule_description(preset),
            )
        )

    return PreviewResponse(items=items)


@router.post("/install", response_model=InstallResponse)
async def install_schedules(request: InstallRequest):
    """Install LaunchAgents for selected schedules."""
    codos_path = settings.get_codos_path()
    results = []

    # Ensure LaunchAgents directory exists
    LAUNCH_AGENTS_DIR.mkdir(parents=True, exist_ok=True)

    # Always install process-cleanup plist (prevents process accumulation)
    _install_process_cleanup_plist()

    for selection in request.selections:
        connector_presets = SCHEDULE_PRESETS.get(selection.connector)
        if not connector_presets:
            results.append(
                InstallResult(
                    connector=selection.connector, success=False, error=f"Unknown connector: {selection.connector}"
                )
            )
            continue

        preset = next((p for p in connector_presets.presets if p.id == selection.preset_id), None)
        if not preset:
            results.append(
                InstallResult(
                    connector=selection.connector, success=False, error=f"Unknown preset: {selection.preset_id}"
                )
            )
            continue

        # Skip manual presets
        if preset.id == "manual":
            results.append(
                InstallResult(
                    connector=selection.connector,
                    success=True,
                    plist_path=None,
                )
            )
            continue

        try:
            # Generate plist
            plist_content = _generate_plist(selection.connector, preset, codos_path)
            if not plist_content:
                results.append(
                    InstallResult(
                        connector=selection.connector,
                        success=True,
                        plist_path=None,
                    )
                )
                continue

            # Write plist file
            plist_path = LAUNCH_AGENTS_DIR / f"com.codos.{selection.connector}-sync.plist"

            # Unload existing agent if present
            if plist_path.exists():
                try:
                    subprocess.run(["launchctl", "unload", str(plist_path)], capture_output=True, timeout=10)
                except Exception:
                    pass

            # Write new plist
            with open(plist_path, "w") as f:
                f.write(plist_content)

            # Load the new agent
            result = subprocess.run(["launchctl", "load", str(plist_path)], capture_output=True, text=True, timeout=10)

            if result.returncode != 0:
                results.append(
                    InstallResult(
                        connector=selection.connector,
                        success=False,
                        plist_path=str(plist_path),
                        error=result.stderr or "Failed to load LaunchAgent",
                    )
                )
            else:
                results.append(
                    InstallResult(
                        connector=selection.connector,
                        success=True,
                        plist_path=str(plist_path),
                    )
                )

        except Exception as e:
            results.append(InstallResult(connector=selection.connector, success=False, error=str(e)))

    success_count = sum(1 for r in results if r.success)
    total_count = len(results)

    return InstallResponse(
        success=success_count == total_count,
        results=results,
        message=f"Installed {success_count}/{total_count} schedule(s)",
    )


@router.get("/telegram/filters")
async def get_telegram_filters():
    """Get current Telegram sync filter settings."""
    codos_path = settings.get_codos_path()
    filters = _load_telegram_filters(codos_path)
    return TelegramFilterConfig(
        sync_unread_only=filters.get("sync_unread_only", False),
        include_dms=filters.get("include_dms", True),
        include_groups=filters.get("include_groups", True),
        include_channels=filters.get("include_channels", False),
        include_muted=filters.get("include_muted", False),
        include_archived=filters.get("include_archived", False),
        mark_unread_after_sync=filters.get("mark_unread_after_sync", False),
    )


@router.post("/telegram/filters")
async def update_telegram_filters(filters: TelegramFilterConfig):
    """Update Telegram sync filter settings."""
    codos_path = settings.get_codos_path()
    _save_telegram_filters(codos_path, filters)
    return {"success": True, "filters": filters}


@router.delete("/{connector}")
async def uninstall_schedule(connector: str):
    """Uninstall a LaunchAgent for a connector."""
    plist_path = LAUNCH_AGENTS_DIR / f"com.codos.{connector}-sync.plist"

    if not plist_path.exists():
        return {"success": True, "message": "No schedule installed"}

    try:
        # Unload the agent
        subprocess.run(["launchctl", "unload", str(plist_path)], capture_output=True, timeout=10)

        # Remove the plist file
        plist_path.unlink()

        return {"success": True, "message": f"Uninstalled schedule for {connector}"}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/services/telegram-agent")
async def install_telegram_agent_service():
    """Install the Telegram agent service (always-on server, not sync schedule).

    This installs a LaunchAgent that keeps the telegram-agent server running.
    Uses proper KeepAlive settings to prevent infinite respawning.
    """
    codos_path = settings.get_codos_path()
    plist_path = LAUNCH_AGENTS_DIR / "com.codos.telegram-agent.plist"

    # Create log directory
    log_dir = codos_path / "dev" / "Logs" / "telegram-agent"
    log_dir.mkdir(parents=True, exist_ok=True)

    try:
        # Unload existing if present
        if plist_path.exists():
            subprocess.run(["launchctl", "unload", str(plist_path)], capture_output=True, timeout=10)

        # Generate and write plist
        plist_content = _generate_telegram_agent_plist(codos_path)
        with open(plist_path, "w") as f:
            f.write(plist_content)

        # Load the agent
        result = subprocess.run(["launchctl", "load", str(plist_path)], capture_output=True, text=True, timeout=10)

        if result.returncode != 0:
            return {
                "success": False,
                "error": result.stderr or "Failed to load LaunchAgent",
                "plist_path": str(plist_path),
            }

        return {
            "success": True,
            "plist_path": str(plist_path),
            "message": "Telegram agent service installed",
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/services/telegram-agent")
async def uninstall_telegram_agent_service():
    """Uninstall the Telegram agent service."""
    plist_path = LAUNCH_AGENTS_DIR / "com.codos.telegram-agent.plist"

    if not plist_path.exists():
        return {"success": True, "message": "No service installed"}

    try:
        subprocess.run(["launchctl", "unload", str(plist_path)], capture_output=True, timeout=10)
        plist_path.unlink()

        return {"success": True, "message": "Telegram agent service uninstalled"}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
