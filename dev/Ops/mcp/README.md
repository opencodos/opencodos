# MCP Ops

Minimal MCP configs and runbooks for reliable subprocess usage without loading full tool schemas.

## Files

- `configs/` — per-service minimal MCP configs
- `known-good-commands.md` — safe test prompts per service
- `bench-mcp.sh` — simple latency baseline runner
- `warm-session-test.sh` — cold vs warm session timing

## Usage

1. Use the wrapper (`run-mcp.sh`) to pick the right minimal config.
2. Use the known-good command for a fast, read-only test.
3. Override workdir with `MCP_WORKDIR` if `~/atlas-mcp` is different.

Example:

```bash
"Dev/Ops/mcp/run-mcp.sh" calendar \
  "Use GOOGLECALENDAR_LIST_CALENDARS. Return only names."
```

## Notes

- Keep per-service configs to minimize cold-start overhead.
- If warm sessions are unstable, prefer cold-starts with minimal configs.
- OAuth must be completed per service before tool calls will work.
