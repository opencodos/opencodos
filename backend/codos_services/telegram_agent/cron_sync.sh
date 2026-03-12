#!/bin/bash
# Telegram sync cron job - runs every 10 minutes
# At 7:45am, also generates daily summary for morning brief

# Resolve CODOS_PATH: env var → paths.json → default
if [ -z "$CODOS_PATH" ] && [ -f "$HOME/.codos/paths.json" ]; then
    CODOS_PATH=$(python3 -c "import json; print(json.load(open('$HOME/.codos/paths.json'))['codosPath'])" 2>/dev/null)
fi
CODOS_PATH="${CODOS_PATH:-$HOME/projects/codos}"
cd "$CODOS_PATH/backend/codos_services/telegram_agent" || exit 1
mkdir -p logs

# Check if it's ~7:45am (run daily summary 15 min before morning brief)
HOUR=$(date +%H)
MINUTE=$(date +%M)
if [[ "$HOUR" == "07" && "$MINUTE" -ge "40" && "$MINUTE" -le "50" ]]; then
    echo "[$(date)] Running morning sync..." >> logs/summary.log

    # Telegram daily summary
    PYTHONPATH="$CODOS_PATH" uv run python daily_summary.py >> logs/summary.log 2>&1

    # Run profile processor after summary is generated
    ( cd "$CODOS_PATH/ingestion/Telegram" && bun run process-telegram-actions.ts ) >> logs/summary.log 2>&1 || echo "[$(date)] FAILED: Telegram process sync" >> logs/summary.log

    # Gmail sync
    echo "[$(date)] Running Gmail sync..." >> logs/summary.log
    ( cd "$CODOS_PATH/ingestion/Gmail" && bun run gmail-sync.ts ) >> logs/summary.log 2>&1 || echo "[$(date)] FAILED: Gmail sync" >> logs/summary.log

    # Slack sync
    echo "[$(date)] Running Slack sync..." >> logs/summary.log
    ( cd "$CODOS_PATH/ingestion/Slack" && bun run slack-sync.ts ) >> logs/summary.log 2>&1 || echo "[$(date)] FAILED: Slack sync" >> logs/summary.log

    # Calendar sync
    echo "[$(date)] Running Calendar sync..." >> logs/summary.log
    ( cd "$CODOS_PATH/ingestion/Calendar" && bun run calendar-sync.ts ) >> logs/summary.log 2>&1 || echo "[$(date)] FAILED: Calendar sync" >> logs/summary.log

    # Notion sync
    echo "[$(date)] Running Notion sync..." >> logs/summary.log
    ( cd "$CODOS_PATH/ingestion/Notion" && bun run notion-sync.ts ) >> logs/summary.log 2>&1 || echo "[$(date)] FAILED: Notion sync" >> logs/summary.log

    # GitHub sync
    echo "[$(date)] Running GitHub sync..." >> logs/summary.log
    ( cd "$CODOS_PATH/ingestion/Github" && bun run github-sync.ts ) >> logs/summary.log 2>&1 || echo "[$(date)] FAILED: GitHub sync" >> logs/summary.log

    # Linear sync
    echo "[$(date)] Running Linear sync..." >> logs/summary.log
    ( cd "$CODOS_PATH/ingestion/Linear" && bun run linear-sync.ts ) >> logs/summary.log 2>&1 || echo "[$(date)] FAILED: Linear sync" >> logs/summary.log

    echo "[$(date)] Morning sync complete" >> logs/summary.log
fi

# Always sync messages
PYTHONPATH="$CODOS_PATH" uv run python agent.py sync >> logs/cron.log 2>&1

# Generate AI inbox suggestions (background, non-blocking)
SUGGESTIONS_SCRIPT="$CODOS_PATH/skills/Inbox Suggestions/run-inbox-suggestions.sh"
if [ -f "$SUGGESTIONS_SCRIPT" ]; then
    bash "$SUGGESTIONS_SCRIPT" >> logs/suggestions.log 2>&1 &
fi

# Keep only last 1000 lines of logs
tail -1000 logs/cron.log > logs/cron.log.tmp && mv logs/cron.log.tmp logs/cron.log
tail -1000 logs/summary.log > logs/summary.log.tmp 2>/dev/null && mv logs/summary.log.tmp logs/summary.log 2>/dev/null
tail -1000 logs/suggestions.log > logs/suggestions.log.tmp 2>/dev/null && mv logs/suggestions.log.tmp logs/suggestions.log 2>/dev/null
