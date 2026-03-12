#!/bin/bash
# Granola Sync Runner
# Loads secrets from backend and runs the granola worker

CODOS_PATH="${CODOS_PATH:-$HOME/codos}"

# Load secrets from backend
eval "$("$CODOS_PATH/backend/.venv/bin/python" -m backend secrets export)"

# Set PATH to include bun
export PATH="$HOME/.bun/bin:$PATH"

# Change to the Granola directory
cd "$CODOS_PATH/ingestion/Granola" || exit 1

# Run the worker
bun run granola-worker.ts
