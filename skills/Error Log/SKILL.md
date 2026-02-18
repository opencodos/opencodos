---
name: errors
description: Aggregate and analyze Claude Code errors from all sources. Use when checking for failures, debugging issues, or asking about errors.
---

# Error Analysis Skill

> Analyze Claude Code errors and generate reports.

## Trigger
`/errors` or `/errors [days]`

## What It Does
1. Aggregates errors from multiple sources:
   - Real-time tool errors (`Vault/5 - Logs/errors-realtime.jsonl`)
   - Debug logs (`~/.claude/debug/`)
   - Session data for prompt correlation
2. Categorizes by type (timeout, permission, parse, etc.)
3. Identifies patterns (peak hours, problematic tools)
4. Generates markdown report in `Vault/5 - Logs/`

## Execution

```bash
bun run "skills/Error Log/aggregate-errors.ts"
```

## Output
- Report saved to: `Vault/5 - Logs/errors-{date}.md`
- Also outputs to stdout for immediate viewing

## Error Sources

| Source | What It Contains |
|--------|------------------|
| `errors-realtime.jsonl` | Tool errors captured by PostToolUse hook |
| `~/.claude/debug/` | System errors, stack traces |
| Session files | For extracting triggering prompts |

## Report Format

```markdown
# Error Report — YYYY-MM-DD

**Period:** Last 7 days | **Total:** N | **Sessions:** N

## By Type
| Type | Count | Example |

## Timeline
| Time | Type | Tool | Error |

## Patterns
- Peak error hours
- Most problematic tools
```

## Related
- Real-time hook: `Dev/Ops/hooks/log-tool-result.ts`
- Configured in: `~/.claude/settings.json` (PostToolUse)
