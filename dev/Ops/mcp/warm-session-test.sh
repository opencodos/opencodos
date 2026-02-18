#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <config-path> <prompt>"
  exit 1
fi

config="$1"
prompt="$2"

if command -v uuidgen >/dev/null 2>&1; then
  session_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
else
  session_id=$(python - <<'PY'
import uuid
print(uuid.uuid4())
PY
  )
fi

echo "Session ID: $session_id"

echo "=== COLD START ==="
start=$(date +%s)
claude --print \
  --session-id "$session_id" \
  --mcp-config "$config" \
  --strict-mcp-config \
  --dangerously-skip-permissions \
  "$prompt" > /tmp/mcp-warm-cold-$$.log 2>&1
end=$(date +%s)

echo "Cold: $((end-start))s"

echo "=== WARM RESUME ==="
start=$(date +%s)
claude --print \
  --resume "$session_id" \
  --mcp-config "$config" \
  --strict-mcp-config \
  --dangerously-skip-permissions \
  "$prompt" > /tmp/mcp-warm-warm-$$.log 2>&1
end=$(date +%s)

echo "Warm: $((end-start))s"
