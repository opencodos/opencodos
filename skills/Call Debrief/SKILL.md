---
name: call-debrief
description: Debrief last call with next steps. Use after finishing a call, when asking what happened on a call, or when needing post-call action items.
---

# /call-debrief

> Debrief the most recent call — gather full context, surface related threads, and propose concrete next steps.

## Trigger

- `/call-debrief` — debrief last call
- `/call-debrief [name]` — debrief last call with specific person

## Workflow

```
1. Identify Call → 2. Read Summary + Transcript → 3. Gather Deep Context → 4. Read Shared Docs → 5. Propose Next Steps → 6. Confirm → 7. Save + Update CRM
```

---

### Step 1: Identify the Last Call

**Find the most recent call from two sources:**

1. **Granola** — List calls via Granola data in `Vault/1 - Inbox (Last 7 days)/Granola/`
   - Sort by date, pick most recent (or match `[name]` if provided)
   - Read `metadata.json` for: title, attendees, date, calendar event

2. **Calendar** — Cross-reference with `Vault/1 - Inbox (Last 7 days)/Calendar/{today}.md`
   - Match the Granola call to calendar event for duration, context, who set it up

If no Granola call found today, check yesterday. If name provided, fuzzy-match against call titles and attendees.

**Output to user:**
```
Found: [Call Title] with [Attendees] at [Time]
Debriefing...
```

---

### Step 2: Read Call Content

1. **Summary** — `Vault/1 - Inbox (Last 7 days)/Granola/Summaries/{call-dir}.md`
   - If no summary exists, read raw transcript and summarize inline
2. **Transcript** — `Vault/1 - Inbox (Last 7 days)/Granola/{call-dir}/transcript.md`
   - Skim for: commitments made, questions asked, tone, unresolved threads
3. **Granola AI notes** — Check for `notes_markdown` in the call metadata
   - Granola's own AI summary may capture things the transcript misses

Extract:
- **Decisions made** — What was agreed on
- **Commitments** — Who promised what (yours and theirs)
- **Open questions** — What wasn't resolved
- **Tone/sentiment** — How did it go? Positive, tense, exploratory?

---

### Step 3: Gather Deep Context

Launch parallel searches to understand the full picture:

**3a. CRM / Relationship Context**
- Search `Vault/4 - CRM/contacts.yaml` for all attendees
- Read profiles from `Vault/4 - CRM/Profiles/{name}.md`
- Note: relationship level, deal stage, last interaction, history

**3b. Previous Calls with Same Person**
- Search `Vault/1 - Inbox (Last 7 days)/Granola/Summaries/` for prior calls with same attendees
- Also search `Vault/Archived data/` if available
- Note: what was discussed before, what was promised, what changed

**3c. Message History**
- Search `Vault/1 - Inbox (Last 7 days)/Telegram/DMs/` for conversations with attendees
- Search Telegram Daily Summaries for mentions
- If Telegram MCP available: `get_messages` for recent DM thread
- Note: any pre-call coordination, shared links, context they sent

**3d. Project Context**
- Search `Vault/2 - Projects/` for any project related to this person/company
- Check `Vault/2 - Projects/Meeting Prep/` for any prep doc that was created before this call
- Note: what was the goal going in, what prep was done

**3e. Shared Documents** (if any links were mentioned)
- If transcript or messages contain Google Docs/Notion/Drive links — attempt to read via MCP:
  ```
  run-mcp.sh gdocs "Read document at [URL]"
  run-mcp.sh gdrive "Get file content [ID]"
  run-mcp.sh notion "Read page [URL]"
  ```
- If links found in DMs around the call time — read those too
- Note: what was shared, what's relevant to next steps

---

### Step 4: Synthesize Debrief

Combine all context into a structured debrief. Present to user:

```markdown
# Call Debrief — [Person] ([Company]) — [Date]

## What Happened
[2-3 sentence summary of the call — what was discussed, what was the vibe]

## Key Takeaways
- [Takeaway 1]
- [Takeaway 2]
- [Takeaway 3]

## Decisions Made
| Decision | Details |
|----------|---------|
| ... | ... |

## Commitments
| Who | What | Deadline |
|-----|------|----------|
| You | ... | ... |
| Them | ... | ... |

## Open Questions
- [Unresolved items]

## Context from History
[Relevant context from previous calls, DMs, or docs — what changed, what's new]
```

---

### Step 5: Propose Next Steps

Based on ALL gathered context, propose **2-3 concrete next steps**. Each step should be:
- **Specific** — Not "follow up" but "send Alex the pricing doc he asked about"
- **Actionable** — Something you can do right now or schedule
- **Prioritized** — Most important first

```markdown
## Proposed Next Steps

1. **[Action]** — [Why this matters based on context]
   - *Suggested timing: [Now / Today / This week]*

2. **[Action]** — [Why this matters based on context]
   - *Suggested timing: [Now / Today / This week]*

3. **[Action]** — [Why this matters based on context]
   - *Suggested timing: [Now / Today / This week]*
```

**Good next steps include:**
- Send a follow-up message (offer to draft via `/msg` or `/draft`)
- Share a document or resource mentioned in the call
- Schedule next meeting (offer to run `/schedule`)
- Update a proposal or pricing based on discussion
- Create a task in Linear for engineering work discussed
- Introduce someone mentioned during the call
- Research something that came up

**Present to user and ask:**
```
These are my proposed next steps. Confirm which ones to execute:
1. ✅ [Step] — Do this now?
2. ✅ [Step] — Do this now?
3. ✅ [Step] — Do this now?

Edit any? Add something I missed?
```

---

### Step 6: Execute Confirmed Steps

For each confirmed step, take action:

| Action Type | How |
|-------------|-----|
| Send message | Use `/msg` skill |
| Draft polished note | Use `/draft` skill |
| Schedule meeting | Use `/schedule` skill |
| Create task | Write to `Vault/3 - Todos/{today}.md` |
| Share document | Use relevant MCP (gdocs, gdrive, notion) |
| Update proposal | Read and edit the document |

---

### Step 7: Save + Update CRM

**1. Save debrief** to `Vault/2 - Projects/Call Debriefs/{YYYY-MM-DD}_{Name}.md`

**2. Update CRM** (`Vault/4 - CRM/`):
- Update `contacts.yaml`: `last_connection`, `next_step`, `deal_stage`
- Update/create profile in `Profiles/{Name}.md` with interaction log entry:

```markdown
### {date} — Call Debrief
- **Context**: [Why the call happened]
- **Outcome**: [Key result]
- **Next steps**: [Confirmed action items]
```

**3. Update today's todo** (`Vault/3 - Todos/{today}.md`):
- Mark call as completed if it was a todo item
- Add confirmed next steps as new todo items

---

## Notes

- Always read the transcript, not just the summary — summaries miss nuance
- If multiple calls happened today, list them and ask which one to debrief
- Prioritize next steps that have deadlines or time sensitivity
- If a call-prep doc exists for this call, compare: did the agenda get covered? Were qualifying questions asked?
- If the call was in Russian, keep the debrief in English but note any Russian-specific context
- When proposing follow-up messages, match the language of the relationship (Russian/English)

---

*Created: 2026-02-18*
