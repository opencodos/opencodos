#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CODOS_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
VENV_PYTHON="$CODOS_ROOT/backend/.venv/bin/python"

# Load secrets from backend
eval "$("$VENV_PYTHON" -m backend secrets export)"

# Get entity ID from entity.py (single source of truth)
COMPOSIO_ENTITY_ID=$(cd "$CODOS_ROOT" && "$VENV_PYTHON" -c "from backend.codos_utils.entity import get_entity_id; print(get_entity_id())" 2>/dev/null || echo "")

# Export for envsubst
export COMPOSIO_ENTITY_ID="${COMPOSIO_ENTITY_ID:-}"
export COMPOSIO_CUSTOMER_ID="${COMPOSIO_CUSTOMER_ID:-}"
export NOTION_TOKEN="${NOTION_API_KEY:-}"

if [[ -z "$COMPOSIO_ENTITY_ID" ]]; then
  echo "Error: Could not get entity ID" >&2
  exit 1
fi

if [[ $# -lt 2 ]]; then
  echo "Usage: run-mcp.sh <service> \"<prompt>\"" >&2
  exit 1
fi

service="$1"
prompt="$2"
shift 2

config="$SCRIPT_DIR/configs/mcp-${service}-only.json"
if [[ ! -f "$config" ]]; then
  echo "Unknown service: $service" >&2
  exit 1
fi

# Substitute env vars in config
config_tmp="/tmp/mcp-${service}-$$.json"
envsubst < "$config" > "$config_tmp"
trap 'rm -f "$config_tmp"' EXIT

workdir="${MCP_WORKDIR:-$HOME/atlas-mcp}"
[[ -d "$workdir" ]] || mkdir -p "$workdir"

# Load critical tools for this service
critical_tools_file="$SCRIPT_DIR/critical-tools.json"
if [[ -f "$critical_tools_file" ]]; then
  tools=$(python3 -c "
import json
with open('$critical_tools_file') as f:
    data = json.load(f)
tools = data.get('$service', [])
if tools:
    print(', '.join(tools))
" 2>/dev/null || echo "")

  if [[ -n "$tools" ]]; then
    prompt="CRITICAL TOOLS (try first): $tools
If these don't solve the task, explore other available tools.

$prompt"
  fi
fi

cd "$workdir"

# Use subscription instead of API credits
unset ANTHROPIC_API_KEY

claude --print \
  --mcp-config "$config_tmp" \
  --dangerously-skip-permissions \
  "$@" \
  "$prompt"
