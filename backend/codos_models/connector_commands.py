"""Shared connector sync command definitions.

Single source of truth for connector sync commands used by both
setup.py (on-demand sync) and schedules.py (LaunchAgent plists).
"""

from __future__ import annotations

from enum import StrEnum


class Runtime(StrEnum):
    PYTHON = "python"
    BUN = "bun"


# Maps connector name to its sync command configuration.
# - runtime: which runtime resolves the executable (consumers resolve the actual binary path)
# - args: arguments passed to the resolved executable
# - cwd: relative path from codos root to the connector's working directory
# - timeout: max seconds for the sync process (used by setup.py)
CONNECTOR_COMMANDS: dict[str, dict] = {
    "telegram": {
        "runtime": Runtime.PYTHON,
        "args": ["-m", "backend", "telegram-agent", "sync"],
        "cwd": ".",
        "env": {"PYTHONPATH": "."},
        "timeout": 300,
    },
    "slack": {
        "runtime": Runtime.BUN,
        "args": ["run", "run-workflow.ts", "--id", "slack-ingestion"],
        "cwd": "skills/Scheduled Workflows",
        "timeout": 300,
    },
    "gmail": {
        "runtime": Runtime.BUN,
        "args": ["run", "run-workflow.ts", "--id", "gmail-ingestion"],
        "cwd": "skills/Scheduled Workflows",
        "timeout": 300,
    },
    "calendar": {
        "runtime": Runtime.BUN,
        "args": ["run", "run-workflow.ts", "--id", "calendar-ingestion"],
        "cwd": "skills/Scheduled Workflows",
        "timeout": 300,
    },
    "notion": {
        "runtime": Runtime.BUN,
        "args": ["run", "run-workflow.ts", "--id", "notion-ingestion"],
        "cwd": "skills/Scheduled Workflows",
        "timeout": 300,
    },
    "linear": {
        "runtime": Runtime.BUN,
        "args": ["run", "run-workflow.ts", "--id", "linear-ingestion"],
        "cwd": "skills/Scheduled Workflows",
        "timeout": 300,
    },
    "granola": {
        "runtime": Runtime.BUN,
        "args": ["run", "extract-granola.ts"],
        "cwd": "ingestion/Granola",
        "timeout": 90,
    },
}
