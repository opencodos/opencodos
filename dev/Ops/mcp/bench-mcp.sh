#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <config-path> <prompt>"
  exit 1
fi

config="$1"
prompt="$2"
output="${3:-/tmp/mcp-bench-$$.log}"

start=$(date +%s)
claude --print \
  --mcp-config "$config" \
  --strict-mcp-config \
  --dangerously-skip-permissions \
  "$prompt" > "$output" 2>&1
end=$(date +%s)

echo "Elapsed: $((end-start))s"
echo "Output: $output"
