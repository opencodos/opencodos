#!/usr/bin/env bash
set -euo pipefail

# Per-component coverage required (percentage)
# Format: "path:threshold"
COMPONENTS="
  codos_utils:95
  codos_models:95
  codos_adapters:95
  codos_usecases:95
  codos_services/codos_bot:0
  codos_services/gateway:22
  codos_services/telegram_agent:3
  codos_services/telegram_mcp:18
"

failed=0

for entry in $COMPONENTS; do
  component="${entry%%:*}"
  threshold="${entry##*:}"

  pct=$(uv run --project backend coverage report --include="backend/${component}/*" 2>/dev/null \
    | tail -1 | awk '{print $NF}' | tr -d '%')

  if ! [[ "$pct" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then
    echo "WARNING: No coverage data for ${component}"
    continue
  fi

  label="${component//\//.}"

  if [ "$(echo "$pct < $threshold" | bc -l)" -eq 1 ]; then
    echo -e "\033[31m✗ ${label}: ${pct}% (required: ${threshold}%)\033[0m"
    failed=1
  else
    echo -e "\033[32m✓ ${label}: ${pct}% (required: ${threshold}%)\033[0m"
  fi
done

if [ "$failed" -eq 1 ]; then
  echo "Coverage check failed"
  exit 1
fi
echo "All coverage checks passed"
