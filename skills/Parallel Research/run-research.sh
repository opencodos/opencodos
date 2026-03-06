#!/bin/bash
#
# Research Runner - LaunchAgent entry point
#
# Sources environment (API keys, paths) and runs research-runner.py
#

set -e

source ~/.codos/env.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOCKFILE="/tmp/atlas-research-runner.lock"

# Lockfile guard
cleanup() { rm -f "$LOCKFILE"; }
trap cleanup EXIT

if [ -f "$LOCKFILE" ]; then
    PID=$(cat "$LOCKFILE")
    if kill -0 "$PID" 2>/dev/null; then
        echo "Research already running (PID $PID), skipping"
        exit 0
    fi
    rm -f "$LOCKFILE"
fi

echo $$ > "$LOCKFILE"

# Use the root venv Python if available
CODOS_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
if [ -f "$CODOS_ROOT/.venv/bin/python" ]; then
    PYTHON="$CODOS_ROOT/.venv/bin/python"
else
    PYTHON="python3"
fi

cd "$SCRIPT_DIR"
exec "$PYTHON" research-runner.py
