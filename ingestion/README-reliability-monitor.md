# Atlas Reliability Monitor

Health monitoring system for all Atlas launchd services. Generates daily health reports, sends Telegram alerts on failures, and maintains persistent logs.

---

## Quick Reference

| What | Where |
|------|-------|
| Main script | `3 - Ingestion/reliability-check.py` |
| Health reports | `Vault/0 - Health Reports/{date}.md` |
| Persistent logs | `Dev/Logs/{service-name}/` |
| Launchd plist | `~/Library/LaunchAgents/com.dkos.reliability-check.plist` |

---

## How It Works

### 1. Service Status Check
Queries `launchctl list` for all 12 Atlas services:

| Service | Label | Type | Schedule |
|---------|-------|------|----------|
| telegram-sync | com.dkos.telegram-sync | interval | Every 10 min |
| morning-brief | com.dkos.morning-brief | interval | Every 30 min |
| slack-sync | com.dkos.slack-sync | scheduled | 7:45am, 6:45pm |
| calendar-sync | com.dkos.calendar-sync | scheduled | 7:45am |
| crm-update | com.dkos.crm-update | scheduled | 8:05am |
| telegram-summary | com.dkos.telegram-summary | scheduled | 8:00am |
| weekly-review | com.dkos.weekly-review | scheduled | Sunday 12pm |
| atlas-bot | com.dkos.atlas-bot | daemon | Always running |
| telegram-bot | com.codos.telegram-bot | daemon | Always running |
| telegram-agent | com.codos.telegram-agent | daemon | Always running |
| connector-backend | com.codos.connector-backend | daemon | Always running |
| connector-frontend | com.codos.connector-frontend | daemon | Always running |

### 2. Log Analysis
- Parses stdout/stderr logs for error patterns
- Counts errors in last 24 hours
- Detects: `error`, `exception`, `traceback`, `failed`, `ModuleNotFoundError`, etc.

### 3. Health Report Generation
Creates daily markdown report at `Vault/0 - Health Reports/{date}.md`:
- Summary: healthy vs failing count
- Service status table with last run time and error counts
- Error details with log excerpts
- Actionable recommendations

### 4. Telegram Alerts
On any failure, sends alert to configured user:
```
⚠️ Atlas Health Alert

FAILING SERVICES:
• atlas-bot: Exit code 1
• crm-update: TypeError
```

### 5. Log Rotation
Automatically deletes logs older than 7 days from `Dev/Logs/`.

---

## Schedule

| Time | Action |
|------|--------|
| 07:30 daily | Reliability check runs (before 08:00 morning brief) |
| On Mac wake/login | Also triggers check |

---

## Manual Usage

Run health check manually:
```bash
cd "/path/to/codos/ingestion"
python reliability-check.py
```

Check specific service status:
```bash
launchctl list | grep -E "(dkos|atlas)"
```

View recent logs:
```bash
tail -50 "/path/to/codos/dev/Logs/telegram-sync/stderr.log"
```

Restart a failed daemon:
```bash
launchctl start com.codos.telegram-bot
```

---

## Log Directory Structure

```
Dev/Logs/
├── atlas-bot/
│   ├── stdout.log
│   └── stderr.log
├── calendar-sync/
├── connector-backend/
├── connector-frontend/
├── crm-update/
├── morning-brief/
├── reliability-check/
├── slack-sync/
├── telegram-agent/
├── telegram-bot/
├── telegram-summary/
├── telegram-sync/
└── weekly-review/
```

All services write to persistent logs (survives reboot), unlike previous `/tmp/` location.

---

## Configuration

### Telegram Credentials
Uses existing config from `3 - Ingestion/atlas-bot/.env`:
- `TELEGRAM_BOT_TOKEN` — Bot token for sending alerts
- `AUTHORIZED_USER_IDS` — User IDs to receive alerts

### Adding a New Service
1. Add entry to `SERVICES` dict in `reliability-check.py`
2. Create log directory: `mkdir -p "Dev/Logs/{service-name}"`
3. Update service's plist to use persistent log path

---

## Troubleshooting

### Service shows "failed" but should be running
```bash
# Check actual error
cat "/path/to/codos/dev/Logs/{service}/stderr.log"

# Restart service
launchctl unload ~/Library/LaunchAgents/com.dkos.{service}.plist
launchctl load ~/Library/LaunchAgents/com.dkos.{service}.plist
```

### No Telegram alert received
1. Check bot token in `atlas-bot/.env`
2. Verify user ID is correct
3. Check `Dev/Logs/reliability-check/stderr.log` for errors

### Health report not generating
```bash
# Check if launchd service is loaded
launchctl list | grep reliability-check

# Run manually to see errors
python "/path/to/codos/ingestion/reliability-check.py"
```

---

## Dependencies

- Python 3 (uses `/opt/anaconda3/bin/python`)
- `requests` — for Telegram API
- `python-dotenv` — for loading .env files

Both are pre-installed in anaconda3.

---

*Created: 2026-01-22*
*Location: `3 - Ingestion/README-reliability-monitor.md`*
