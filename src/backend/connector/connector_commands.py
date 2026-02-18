"""Shared connector sync command definitions.

Single source of truth for connector sync commands used by both
setup.py (on-demand sync) and schedules.py (LaunchAgent plists).
"""

# Maps connector name to its sync command configuration.
# - cwd: relative path from codos root to the connector's working directory
# - cmd: command and arguments to run the sync
# - timeout: max seconds for the sync process (used by setup.py)
CONNECTOR_COMMANDS: dict[str, dict] = {
    "telegram": {
        "cwd": ".",
        "cmd": ["src/backend/telegram_agent/.venv/bin/python", "-m", "backend", "telegram-agent", "sync"],
        "env": {"PYTHONPATH": "src"},
        "timeout": 300,
    },
    "slack": {
        "cwd": "ingestion/Slack",
        "cmd": ["bun", "run", "slack-sync.ts"],
        "timeout": 180,
    },
    "gmail": {
        "cwd": "ingestion/Gmail",
        "cmd": ["bun", "run", "gmail-sync.ts"],
        "timeout": 120,
    },
    "calendar": {
        "cwd": "ingestion/Calendar",
        "cmd": ["bun", "run", "calendar-sync.ts"],
        "timeout": 90,
    },
    "notion": {
        "cwd": "ingestion/Notion",
        "cmd": ["bun", "run", "notion-sync.ts"],
        "timeout": 300,
    },
    "linear": {
        "cwd": "ingestion/Linear",
        "cmd": ["bun", "run", "linear-sync.ts"],
        "timeout": 300,
    },
    "github": {
        "cwd": "ingestion/Github",
        "cmd": ["bun", "run", "github-sync.ts"],
        "timeout": 180,
    },
    "granola": {
        "cwd": "ingestion/Granola",
        "cmd": ["bun", "run", "extract-granola.ts"],
        "timeout": 90,
    },
}
