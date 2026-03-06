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
        "cmd": [".venv/bin/python", "-m", "backend", "telegram-agent", "sync"],
        "env": {"PYTHONPATH": "."},
        "timeout": 300,
    },
    "slack": {
        "cwd": "skills/Scheduled Workflows",
        "cmd": ["bun", "run", "run-workflow.ts", "--id", "slack-ingestion"],
        "timeout": 300,
    },
    "gmail": {
        "cwd": "skills/Scheduled Workflows",
        "cmd": ["bun", "run", "run-workflow.ts", "--id", "gmail-ingestion"],
        "timeout": 300,
    },
    "calendar": {
        "cwd": "skills/Scheduled Workflows",
        "cmd": ["bun", "run", "run-workflow.ts", "--id", "calendar-ingestion"],
        "timeout": 300,
    },
    "notion": {
        "cwd": "skills/Scheduled Workflows",
        "cmd": ["bun", "run", "run-workflow.ts", "--id", "notion-ingestion"],
        "timeout": 300,
    },
    "linear": {
        "cwd": "skills/Scheduled Workflows",
        "cmd": ["bun", "run", "run-workflow.ts", "--id", "linear-ingestion"],
        "timeout": 300,
    },
    "granola": {
        "cwd": "ingestion/Granola",
        "cmd": ["bun", "run", "extract-granola.ts"],
        "timeout": 90,
    },
}
