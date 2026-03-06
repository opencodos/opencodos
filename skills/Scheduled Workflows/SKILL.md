---
name: scheduled-workflows
description: Define recurring workflow tasks with YAML configs, schedule them via launchd, and run them on demand.
---

# Scheduled Workflows

Use this skill when creating or running scheduled workflows defined in `skills/Scheduled Workflows/workflows/*.yaml`.

## Quick Start

1. `cd "${CODOS_PATH:-.}/skills/Scheduled Workflows"`
2. `bun install`
3. `bun run run-workflow.ts --id <workflow-id>`
4. `bun run schedule-workflows.ts enable <workflow-id>`
5. `bun run schedule-workflows.ts disable <workflow-id>`
6. `bun run schedule-workflows.ts list`

## Workflow Config

Workflow configs live in `skills/Scheduled Workflows/workflows/` and are loaded by filename.

Required fields:
- `name`
- `prompt`

Common fields:
- `schedule`: `daily`, `weekly`, `cron`, `interval`, or `manual`
- `context`: list of sources to gather before running
- `output.path`: where to write the result
- `runner.model`: Claude model to use

Placeholders in `output.path`:
- `{DATE}` = `YYYY-MM-DD`
- `{YEAR}` = `YYYY`
- `{MONTH}` = `MM`
- `{DAY}` = `DD`
- `{WEEK}` = ISO week number (2 digits)

## Context Sources

Supported types:
- `file`: read a single file
- `glob`: include multiple files via pattern
- `text`: inline content

Each source supports `title` and optional size limits.

## Notes

Scheduling uses macOS LaunchAgents. `enable` writes a plist to `~/Library/LaunchAgents/` and loads it via `launchctl`.

If you need web search or external tools, add them via a custom context source or a dedicated script referenced in the prompt.
