# /compound — Extract Daily Learnings

> Manual learning extraction from today's activity. Run before bed for best recall.

## What This Skill Does

1. Reviews today's brief (what was planned)
2. Compares against actual activity (Granola calls, Slack, completed tasks)
3. Extracts learnings: what worked, what blocked, patterns
4. Appends new insights to `Core Memory/Learnings.md`

## Execution Steps

### Step 1: Load Today's Context

Read these files in parallel:
- `$VAULT_PATH/0 - Daily Briefs/{today}.md`
- `$VAULT_PATH/3 - Todos/{today}.md`
- `$VAULT_PATH/Core Memory/Learnings.md`

If today's files don't exist, use yesterday's.

### Step 2: Gather Actual Activity

Check what actually happened:
- Granola call summaries in the brief
- Todo completion rate (what got done vs planned)
- Any Slack/email context mentioned

### Step 3: Analyze Gaps and Wins

Compare planned vs actual:

**Questions to ask:**
- What got done that wasn't planned? (reactive work)
- What was planned but didn't happen? (blockers)
- What worked better than expected? (tactical patterns)
- What took longer or failed? (process friction)

### Step 4: Extract Learnings

Categorize insights into three buckets:

| Category | What Goes Here |
|----------|---------------|
| **Tactical Patterns** | Actions that worked well, repeatable wins |
| **Blockers to Watch** | Recurring issues, context switches, energy drains |
| **Process Improvements** | Better workflows discovered, tool optimizations |

### Step 5: Update Learnings.md

**Format for new entries:**
```markdown
- [YYYY-MM-DD] Learning statement (brief, actionable)
```

**Deduplication:**
- Read existing entries first
- Skip if semantically similar learning already exists
- Prefer updating/strengthening existing entries over adding duplicates

**Example entries:**
```markdown
## Tactical Patterns
- [2026-01-29] Same-day deck sending increases enterprise response rate
- [2026-01-29] Calling after demo shows 2x follow-through vs email

## Blockers to Watch
- [2026-01-29] Context switching after 3pm kills deep work
- [2026-01-29] Slack alerts during calls break focus

## Process Improvements
- [2026-01-29] Run /compound before bed for fresher recall
- [2026-01-29] Morning brief review takes 5 min, saves 30 min of context-loading
```

### Step 6: Report Summary

Output to user:
```
## /compound Summary — {date}

**Learnings extracted:** {count}
- Tactical Patterns: {list}
- Blockers: {list}
- Process: {list}

**Skipped (duplicates):** {count if any}

Updated: Core Memory/Learnings.md
```

## Quality Checks

- Each learning should be **actionable** — not just an observation
- Be **specific** — "Sending deck same day works" > "Follow up quickly"
- Include **context** when the pattern only applies to certain situations
- **Prune** periodically — remove learnings that no longer apply

## Example Session

User runs `/compound` at 10pm:

```
## /compound Summary — 2026-01-29

**Learnings extracted:** 3

**Tactical Patterns:**
- [2026-01-29] Client demo: showing command center first hooks enterprise buyers

**Blockers to Watch:**
- [2026-01-29] REDACTED_NOTE caused context switch

**Process Improvements:**
- [2026-01-29] Deck sending before EOD increases next-day response rate

Updated: Core Memory/Learnings.md
```

---

*Created: 2026-01-29 — Manual-first approach, automation later.*
