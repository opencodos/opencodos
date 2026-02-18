---
name: granola-summary
description: Summarize Granola call transcripts. Use after calls to generate structured summaries with action items.
---

# Granola Summary Skill

Summarize Granola call transcripts using Claude API.

## Trigger

- **Automatic**: Runs after new calls are ingested via SessionStart hook
- **Manual**: Run `/granola-summary` or execute script directly

## Requirements

- `ANTHROPIC_API_KEY` environment variable must be set
- Granola calls must be extracted to `Vault/1 - Inbox (Last 7 days)/Granola/`

## What It Does

1. Scans for calls without existing summaries
2. For each unsummarized call:
   - Reads transcript.md
   - Sends to Claude API for summarization
   - Generates structured summary with:
     - TL;DR
     - Key Points
     - Action Items
     - Decisions Made
     - Notable Quotes
3. Saves summaries to `Vault/1 - Inbox (Last 7 days)/Granola/Summaries/`

## Manual Execution

```bash
# Summarize all unsummarized calls
ANTHROPIC_API_KEY=your-key bun run "ingestion/Granola/summarize-calls.ts"
```

## Output

Summaries are saved as markdown files:
- Path: `Vault/1 - Inbox (Last 7 days)/Granola/Summaries/{call-dir}.md`
- Format: Structured markdown with metadata header

## Hook Integration

The SessionStart hook automatically triggers summarization when:
1. New calls are extracted
2. `ANTHROPIC_API_KEY` is available

Configure API key in `~/.claude/settings.json`:
```json
{
  "env": {
    "ANTHROPIC_API_KEY": "sk-ant-..."
  }
}
```
