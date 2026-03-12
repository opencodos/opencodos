---
name: review
description: Weekly reflection with wins, failures, learnings, and goal progress. Use on Sundays or when reviewing the week.
---

# Weekly Review

> Generate a weekly reflection with wins, failures, learnings, and goal progress.

## Triggers

- **Automatic**: Runs every Sunday at 12pm (launchd agent)
- **Manual**: `/review` command in Atlas
- **Script**: `bun run generate-review.ts`

## What It Does

1. **Gathers data** from the past 7 days:
   - `Vault/0 - Daily Briefs/{dates}.md` — Updates, relationships, risks
   - `Vault/3 - Todos/{dates}.md` — Task completion tracking
   - `Vault/Core Memory/Goals.md` — Short-term + 2026 goals
   - `Vault/Core Memory/Brief Feedback.md` — Quality rules
   - `Vault/1 - Inbox/Granola/Summaries/` — Key meetings

2. **Analyzes** using Claude API to generate:
   - What went well
   - What went poorly (brutally honest)
   - Key learnings
   - Open strategic questions
   - Progress towards goals

3. **Saves** the review to `Vault/0 - Weekly Reviews/{YEAR}-W{WEEK}.md`

4. **Opens** the review in Obsidian (when run via launchd)

## Output Format

```markdown
# Weekly Review — Week 03 (Jan 13 - Jan 19, 2026)

## a) Good Last Week
- [Specific wins with outcomes]

## b) Bad Last Week
- [Hard truths, missed commitments]

## c) Key Learnings
- **[Learning]** - [How to apply]

## d) Open Questions
- [Strategic questions without obvious answers]

## e) Progress Towards Goals

### Short-term Goals
| Goal | Status | Evidence |
|------|--------|----------|

### 2026 Goals
| Goal | This Week | Gap to Target |
|------|-----------|---------------|

## Metrics
- Tasks: X/Y completed (Z%)
- Key meetings: [list]
```

## Files

| File | Purpose |
|------|---------|
| `generate-review.ts` | Main script that gathers context and calls Claude |
| `~/bin/weekly-review.sh` | Shell wrapper with environment setup |

## Launchd Agent

Location: `~/Library/LaunchAgents/com.codos.weekly-review.plist`

```bash
# Check status
launchctl list | grep weekly-review

# Reload agent
launchctl unload ~/Library/LaunchAgents/com.codos.weekly-review.plist
launchctl load ~/Library/LaunchAgents/com.codos.weekly-review.plist

# Run manually
launchctl start com.codos.weekly-review

# View logs
tail -f /tmp/weekly-review.log
tail -f /tmp/weekly-review.error.log
```

## Manual Execution

```bash
# Run directly
cd "skills/Weekly Review"
ANTHROPIC_API_KEY=... bun run generate-review.ts

# Or use the wrapper
~/bin/weekly-review.sh
```

## Behavior

- **Idempotent**: Won't regenerate if this week's review already exists
- **Week boundary**: Uses ISO week (Monday-Sunday)
- **Comprehensive**: Analyzes up to 7 days of briefs + todos

## Data Sources

| Source | Path | Used For |
|--------|------|----------|
| Daily Briefs | `Vault/0 - Daily Briefs/` | Updates, relationships, risks |
| Daily Todos | `Vault/3 - Todos/` | Task completion rate |
| Goals | `Vault/Core Memory/Goals.md` | Goals for progress tracking |
| Meeting Summaries | `Vault/1 - Inbox/Granola/Summaries/` | Key meetings |
