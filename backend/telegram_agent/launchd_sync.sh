#!/bin/bash
# Wrapper script for launchd - logs execution for debugging

CODOS_PATH="${CODOS_PATH:-$HOME/codos}"
LOG_DIR="$CODOS_PATH/backend/telegram_agent/logs"
AGENT_DIR="$CODOS_PATH/backend/telegram_agent"

echo "[$(date)] Starting launchd sync" >> "$LOG_DIR/launchd.log"

cd "$AGENT_DIR" || { echo "[$(date)] Failed to cd to $AGENT_DIR" >> "$LOG_DIR/launchd.log"; exit 1; }

poetry run python "$AGENT_DIR/agent.py" sync >> "$LOG_DIR/launchd.log" 2>&1
EXIT_CODE=$?

echo "[$(date)] Sync finished with exit code $EXIT_CODE" >> "$LOG_DIR/launchd.log"
exit $EXIT_CODE
