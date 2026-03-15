#!/bin/bash
# =============================================================================
# Codos Environment Loader
# =============================================================================
# Reads paths from ~/.codos/paths.json and loads API keys.
# Source this file in any shell script that needs CODOS_PATH, VAULT_PATH, or API keys.
#
# Usage: source ~/.codos/env.sh
# =============================================================================

# Require paths.json - fail fast if not set up
if [ ! -f "$HOME/.codos/paths.json" ]; then
    echo "Error: ~/.codos/paths.json not found. Run setup first." >&2
    exit 1
fi

# Parse paths from JSON (pure bash, no jq dependency)
CODOS_PATH=$(grep -o '"codosPath"[[:space:]]*:[[:space:]]*"[^"]*"' "$HOME/.codos/paths.json" | cut -d'"' -f4)
export CODOS_PATH
VAULT_PATH=$(grep -o '"vaultPath"[[:space:]]*:[[:space:]]*"[^"]*"' "$HOME/.codos/paths.json" | cut -d'"' -f4)
export VAULT_PATH
USER_NAME=$(grep -o '"userName"[[:space:]]*:[[:space:]]*"[^"]*"' "$HOME/.codos/paths.json" | cut -d'"' -f4)
export USER_NAME

# Validate paths exist
if [ ! -d "$CODOS_PATH" ]; then
    echo "Error: CODOS_PATH does not exist: $CODOS_PATH" >&2
    exit 1
fi

# Add common binary paths
export PATH="$HOME/.bun/bin:$HOME/.nvm/versions/node/v22.20.0/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

# Load API keys from secrets backend
eval "$("$CODOS_PATH/backend/.venv/bin/python" -m backend secrets export)"
