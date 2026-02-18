#!/bin/bash
# Granola Sync Runner
# Sources API key and runs the granola worker

# Source API key from Claude Code's environment or ~/.zshrc
if [ -f ~/.zshrc ]; then
    source ~/.zshrc 2>/dev/null
fi

# Or source from a secrets file if it exists
if [ -f "${CODOS_PATH:-$HOME/codos}/dev/Ops/secrets.env" ]; then
    source "${CODOS_PATH:-$HOME/codos}/dev/Ops/secrets.env"
fi

# Set PATH to include bun
export PATH="$HOME/.bun/bin:$PATH"

# Change to the Granola directory
cd "${CODOS_PATH:-$HOME/codos}/ingestion/Granola" || exit 1

# Run the worker
bun run granola-worker.ts
