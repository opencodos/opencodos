#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPS_ENV="$SCRIPT_DIR/../.env"

# Load environment
if [[ -f "$OPS_ENV" ]]; then
  set -a
  source "$OPS_ENV"
  set +a
fi

# Get entity ID from entity.py (single source of truth - same as server.py)
CONNECTOR_BACKEND="$SCRIPT_DIR/../../connector-backend"
if [[ -f "$CONNECTOR_BACKEND/entity.py" ]]; then
  COMPOSIO_ENTITY_ID=$(cd "$CONNECTOR_BACKEND" && python3 -c "from entity import get_entity_id; print(get_entity_id())" 2>/dev/null || echo "")
fi

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
trap "rm -f '$config_tmp'" EXIT

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
