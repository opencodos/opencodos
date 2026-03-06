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
| `com.dkos.slack-sync` | 7:45 AM, 6:45 PM | Slack sync (weekdays only) |
| `com.dkos.calendar-sync` | 7:45 AM | Calendar sync (weekdays only) |
| `com.dkos.telegram-summary` | 8:00 AM | Daily Telegram summary |
| `com.dkos.morning-brief` | Every 30 min | Generate morning brief |
| `com.dkos.crm-update` | 8:05 AM | Update CRM from inbox |
| `com.dkos.weekly-review` | Sunday 12:00 PM | Weekly review generation |
| `com.dkos.reliability-check` | 7:30 AM | Health monitoring |

### Always-Running Daemons

| Plist | Purpose |
|-------|---------|
| `com.codos.telegram-agent` | Telegram agent server |
| `com.codos.telegram-bot` | Atlas Telegram bot |
| `com.codos.connector-backend` | Connector status backend |
| `com.codos.connector-frontend` | Connector UI (Vite) |

## Authentication

Primary auth is **Pipedream Connect**:
- `PIPEDREAM_PROJECT_ID`, `PIPEDREAM_CLIENT_ID`, `PIPEDREAM_CLIENT_SECRET`, `PIPEDREAM_ENV=production`
- `PIPEDREAM_EXTERNAL_USER_ID` (auto-generated per install)
- Per-service account IDs in `dev/Ops/.env`:
```
PIPEDREAM_ACCOUNT_ID_SLACK=...
PIPEDREAM_ACCOUNT_ID_GMAIL=...
PIPEDREAM_ACCOUNT_ID_GOOGLECALENDAR=...
PIPEDREAM_ACCOUNT_ID_GITHUB=...
PIPEDREAM_ACCOUNT_ID_LINEAR=...
PIPEDREAM_ACCOUNT_ID_NOTION=...
```

Fallback auth (kept for safety):
- **MCP:** `dev/Ops/mcp/configs/*` with `run-mcp.sh`
- **Composio REST:** `COMPOSIO_API_KEY` in `dev/Ops/.env`

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

## Monitoring

`reliability-check.py` runs daily at 7:30 AM to verify:
- All LaunchAgents are loaded
- Recent sync timestamps exist
- No stale data (>24h old)

See `README-reliability-monitor.md` for details.

## Adding a New Service

1. Create folder: `3 - Ingestion/ServiceName/`
2. Create sync script: `servicename-sync.ts`
3. Add MCP config: `Dev/Ops/mcp/configs/mcp-servicename-only.json`
4. Add to morning pipeline in `Telegram-agent/cron_sync.sh`
5. (Optional) Create LaunchAgent for dedicated schedule
6. Add to `reliability-check.py` service list

## Not Yet Implemented

- **Google Drive** - auth config exists, no ingestion script
- **Google Docs** - auth config exists, no ingestion script
