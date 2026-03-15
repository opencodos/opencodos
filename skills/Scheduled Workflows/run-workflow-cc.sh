#!/bin/bash
#
# Scheduled Workflow Runner - Claude Code Wrapper
#
# Usage:
#   ./run-workflow-cc.sh --id <workflow-id>
#   ./run-workflow-cc.sh --config <path>
#

set -e

# shellcheck source=/dev/null
source ~/.codos/env.sh

# Parse args
WORKFLOW_ID=""
CONFIG_PATH=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --id)
      WORKFLOW_ID="$2"
      shift 2
      ;;
    --config)
      CONFIG_PATH="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

if [[ -z "$WORKFLOW_ID" && -z "$CONFIG_PATH" ]]; then
  echo "Error: must provide --id or --config" >&2
  exit 1
fi

LOCK_ID="${WORKFLOW_ID:-custom}"
LOCKFILE="/tmp/atlas-workflow-${LOCK_ID}.lock"

cleanup() { rm -f "$LOCKFILE"; }
trap cleanup EXIT

if [ -f "$LOCKFILE" ]; then
  PID=$(cat "$LOCKFILE")
  if kill -0 "$PID" 2>/dev/null; then
    echo "Workflow already running (PID $PID), skipping"
    exit 0
  fi
  rm -f "$LOCKFILE"
fi

echo $$ > "$LOCKFILE"

cd "$CODOS_PATH/skills/Scheduled Workflows"

if [[ -n "$WORKFLOW_ID" ]]; then
  bun run run-workflow.ts --id "$WORKFLOW_ID"
else
  bun run run-workflow.ts --config "$CONFIG_PATH"
fi
