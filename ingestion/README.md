# DKOS Ingestion System

This folder contains all data ingestion scripts that pull data from connected services into the Obsidian Vault.

## Overview

Data flows from external services → ingestion scripts → `Vault/1 - Inbox (Last 7 days)/`

**Scheduling:** Combination of macOS LaunchAgents and cron jobs orchestrate when scripts run.

## Services

| Service | Script | Schedule | Output |
|---------|--------|----------|--------|
| Slack | `Slack/slack-sync.ts` | 7:45 AM, 6:45 PM (weekdays) | `Inbox/Slack/` |
| Gmail | `Gmail/gmail-sync.ts` | 7:45 AM (morning sync) | `Inbox/Gmail/` |
| Calendar | `Calendar/calendar-sync.ts` | 7:45 AM (weekdays) | `Inbox/Calendar/` |
| Linear | `Linear/linear-sync.ts` | 7:45 AM + wake trigger | `Inbox/Linear/` |
| GitHub | `Github/github-sync.ts` | 7:45 AM (morning sync) | `Inbox/Github/` |
| Notion | `Notion/notion-sync.ts` | 7:45 AM (morning sync) | `Inbox/Notion/` |
| Telegram | `Telegram-agent/` | Every 10 min | `Inbox/Telegram/` |
| Granola | `Granola/granola-hook.ts` | Webhook (on call end) | `Inbox/Granola/` |

## Scheduling Architecture

### Cron Job (Primary Orchestrator)

```
*/10 * * * * "~/Projects/codos/ingestion/Telegram-agent/cron_sync.sh"
```

Runs every 10 minutes. Contains time-of-day logic:
- **Always:** Syncs Telegram messages
- **7:45 AM window:** Triggers full morning sync pipeline

### Morning Sync Pipeline (7:45 AM)

Executed by `cron_sync.sh` when time matches morning window:

```
1. Telegram daily_summary.py
2. Gmail gmail-sync.ts
3. Slack slack-sync.ts
4. Calendar calendar-sync.ts
5. Notion notion-sync.ts
6. GitHub github-sync.ts
7. Linear linear-sync.ts
```

### LaunchAgents

Located in `~/Library/LaunchAgents/`:

| Plist | Schedule | Purpose |
|-------|----------|---------|
| `com.codos.slack-sync` | 7:45 AM, 6:45 PM | Slack sync (weekdays only) |
| `com.codos.calendar-sync` | 7:45 AM | Calendar sync (weekdays only) |
| `com.codos.telegram-summary` | 8:00 AM | Daily Telegram summary |
| `com.codos.morning-brief` | Every 30 min | Generate morning brief |
| `com.codos.crm-update` | 8:05 AM | Update CRM from inbox |
| `com.codos.weekly-review` | Sunday 12:00 PM | Weekly review generation |

### Always-Running Daemons

| Plist | Purpose |
|-------|---------|
| `com.codos.telegram-agent` | Telegram agent server |
| `com.codos.telegram-bot` | Atlas Telegram bot |
| `com.codos.gateway-backend` | Gateway status backend |
| `com.codos.gateway-frontend` | Gateway UI (Vite) |

## Authentication

**Native MCP services** (Slack, Notion, Linear, Gmail, Calendar, Drive) authenticate via claude.ai Connectors — no local credentials needed.

**Composio services** (GitHub) use managed OAuth via `COMPOSIO_API_KEY`.

API keys and credentials are stored in the pluggable secrets backend (default: `~/.codos/secrets.json`). See `backend/codos_utils/secrets/` for details.

MCP configs live in `dev/Ops/mcp/configs/` with `run-mcp.sh` as the runner.

## Running Scripts Manually

Each TypeScript sync script can be run via `bun`:

```bash
# From script directory
bun run slack-sync.ts

# Or via the MCP runner
~/Documents/Obsidian\ Vault/Dev/Ops/mcp/run-mcp.sh slack
```

## Logs

Logs are written to `Dev/Logs/`:
- `slack-sync.log`
- `calendar-sync.log`
- `telegram-sync.log`
- etc.

## Adding a New Service

1. Create folder: `3 - Ingestion/ServiceName/`
2. Create sync script: `servicename-sync.ts`
3. Add MCP config: `Dev/Ops/mcp/configs/mcp-servicename-only.json`
4. Add to morning pipeline in `Telegram-agent/cron_sync.sh`
5. (Optional) Create LaunchAgent for dedicated schedule

## Not Yet Implemented

- **Google Drive** - auth config exists, no ingestion script
- **Google Docs** - auth config exists, no ingestion script
