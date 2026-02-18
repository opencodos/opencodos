---
name: todo
description: Generate today's todo list from brief, calendar, and carryover items. Use when planning the day or asking about tasks.
---

# Daily Todo Skill

Generate today's todo list by combining:
1. Unchecked items from yesterday's todo (with interactive selection)
2. Scheduled calls from calendar
3. Action items from today's morning brief

## Trigger
- `/todo` command
- Automatically after `/brief` completes

## Interactive Carryover

When run manually (with TTY), you'll see yesterday's unchecked items and can select which to carry:
```
📋 Unchecked items from yesterday:
  1. Task A
  2. Task B
  3. Task C

Which items to carry over?
  - Enter numbers: 1,3 (carry items 1 and 3)
  - Enter "all" or press Enter (carry everything)
  - Enter "none" (skip all)
```

When run via cron/launchd (no TTY), all items are auto-carried.

## Execution
```bash
bun run "skills/Daily Todo/generate-todo.ts"
```

## Output
Saves to: `Vault/3 - Todos/{YYYY-MM-DD}.md`

## Format
```markdown
# YYYY-MM-DD

## Deep Work
- [ ] (carried) Item from yesterday
- [ ] (new) Item from brief

## Comms
- [ ] HH:MM - Call with Name (scheduled)
- [ ] Send message to Name re: topic

## Long Tail
- [ ] Lower priority item
```

## Sources
| Source | What it provides |
|--------|------------------|
| Yesterday's todo | Unchecked `[ ]` items → carry forward |
| Calendar (7 days) | Today + next 7 days events → Schedule section |
| Today's brief | Action items → all buckets |
| Granola summaries | Recent calls → context for follow-ups |
| Telegram DMs | Recent conversations → context for messages |

## Calendar Integration

The todo generator reads calendar data for **today + next 7 days** from `Inbox/Calendar/{date}.md`. This allows:
- Scheduling prep time for upcoming meetings
- Seeing important calls that might conflict with deep work
- Identifying travel days to adjust priorities

---
*Last updated: 2026-01-19*
