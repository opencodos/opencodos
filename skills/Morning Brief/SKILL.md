---
name: brief
description: Generate morning briefing with calendar, inbox highlights, and priority tasks. Use when starting the day, checking priorities, or asking what's on the plate.
---

# Morning Brief

> Generate a daily briefing with inbox highlights, priorities, and actionable next steps.

## Triggers

- **Automatic**: Runs every day when you open your laptop (launchd agent)
- **Manual**: `/brief` command in Atlas
- **Script**: `bun run generate-brief.ts`

## What It Does

1. **Gathers context** from all available sources:
   - `Vault/Core Memory/About me.md` — Background, preferences, timezone
   - `Vault/Core Memory/Goals.md` — Your goals and priorities
   - `Vault/0 - Daily Briefs/End of Day/{yesterday}.md` — **Yesterday's EOD report** (if exists)
   - `Vault/1 - Inbox/` — Telegram, Granola, Gmail, Slack, Linear, etc.
   - `Vault/2 - Projects/` — Active projects
   - `Vault/4 - CRM/` — Key contacts and follow-ups
   - `Vault/3 - Notes/` — Recent daily notes

2. **EOD Carryover Check**:
   Check if yesterday's EOD report exists at `Vault/0 - Daily Briefs/End of Day/{yesterday}.md`

   If it exists:
   - Parse all action items from each person/call section
   - Filter for items that are **still relevant today**:
     - Items with "Tomorrow" or specific future dates → include
     - Items marked for "This week" → include
     - Items with no deadline but still pending → include
     - Items that were likely completed yesterday → exclude
   - Surface these as **Carryover Action Items** in Priority Actions section
   - Flag any items that are now overdue

3. **QMD Deep Context** (when running via Claude Code):
   Before generating, run these QMD queries to surface hidden context:
   ```
   qmd_query("pending commitments promises unfulfilled")
   qmd_query("stale conversations waiting response 48h")
   qmd_query("deals revenue pipeline opportunities")
   qmd_query("relationship tensions concerns blockers")
   ```
   This surfaces relevant items from anywhere in the Vault, not just the hot inbox.

4. **Synthesizes** using Claude API to identify:
   - Highest leverage items for the day
   - **Carryover items from yesterday's EOD** (still pending)
   - Status on your key goals
   - Blockers and dropped threads
   - Quick wins
   - People to follow up with

5. **Saves** the brief to `Vault/0 - Daily Briefs/YYYY-MM-DD.md`

6. **Opens** the brief in Obsidian (when run via launchd)

## Output Format

```markdown
# Morning Brief — {{DATE}}

## 1. System Synthesis
[2-3 sentences: day tone, main blocker, success criteria]

---

## 2. Priority Actions (Score ≥9)
| Action | Why | Score |
|--------|-----|-------|

---

## 2.5 Carryover from Yesterday's EOD
*(Only shown if EOD report exists)*

| Person | Action | Original Deadline | Status |
|--------|--------|-------------------|--------|
| [Name] | [Action item] | [Tomorrow/This week/etc] | Pending |

---

## 3. Today's Schedule (Lead Profiles)

### CLIENT DISCOVERY CALLS
Full prep with company profile:

### HH:MM-HH:MM — [Person] @ [Company]
|              |                                           |
| ------------ | ----------------------------------------- |
| **Org**      | [Company — what they do]                  |
| **Size**     | [Employees]                               |
| **Request**  | [What they asked for]                     |
| **Tried**    | [AI tools already tried]                  |
| **Maturity** | [LOW/MEDIUM/HIGH]                         |
| **Play**     | [Strategic approach for this call]        |

**Key Questions:**
1. "[Context-specific discovery question]"
2. "[Pain point question]"
3. "[Budget/timeline question]"
4. "[Qualify/disqualify question]"
5. "[Success criteria question]"
6. "[Decision-maker question]"

---

### COFOUNDER/INTERNAL SYNCS
### HH:MM — [Name]
**Type:** Cofounder sync
**Prep:**
- [Key topics and decisions]

### NETWORKING CALLS
### HH:MM — [Name] @ [Context]
**Type:** Networking
**Context:** [Relationship context]
**Goals:** [What to explore]

---

## 4. Strategic Leverage (Score ≥7)
| Item | Leverage | Score |
|------|----------|-------|

---

## 5. Messages to Respond
[Full message threads with entity context]

---

## 6. Email Highlights
| Sender | Subject | Action |
|--------|---------|--------|

---

## 7. Tasks (Grouped)
### Deep Work
### Comms
### Long Tail

---

## 8. Context Loaded
### Health / Key Entities / Recent Calls

---

## 9. Errors
[Only if errors occurred]
```

## Files

| File | Purpose |
|------|---------|
| `generate-brief.ts` | Main script that gathers context and calls Claude |
| `run-brief.sh` | Shell wrapper with environment setup |
| `Old Prompt.md` | Original detailed prompt for reference |

## Launchd Agent

Location: `~/Library/LaunchAgents/com.codos.morning-brief.plist`

```bash
# Check status
launchctl list | grep morning-brief

# Reload agent
launchctl unload ~/Library/LaunchAgents/com.codos.morning-brief.plist
launchctl load ~/Library/LaunchAgents/com.codos.morning-brief.plist

# Run manually
launchctl start com.codos.morning-brief

# View logs
tail -f /tmp/morning-brief.log
tail -f /tmp/morning-brief.error.log
```

## Manual Execution

```bash
# Run directly
cd "skills/Morning Brief"
ANTHROPIC_API_KEY=... bun run generate-brief.ts

# Or use the wrapper
skills/Morning Brief/run-brief.sh
```

## Behavior

- **Idempotent**: Won't regenerate if today's brief already exists
- **Graceful degradation**: Works with whatever inbox sources are available
- **Fast**: Uses claude-sonnet-4 for speed
- **Concise**: Output capped at ~500 words
- **QMD-enhanced**: When run via Claude Code, uses local search for deeper context

## QMD Integration

When running `/brief` in Claude Code (not via launchd), the skill should:

1. **Pre-query QMD** before gathering standard context:
   ```bash
   qmd query "stale commitments promises pending follow-ups"
   qmd query "deal pipeline revenue opportunities"
   qmd query "relationship concerns tensions blockers"
   ```

2. **Incorporate results** into the Strategic Leverage and Priority Actions sections

3. **Keep index fresh**: Run `qmd embed` weekly or when new sources are added

This allows the brief to surface important items from archived data, old project notes, and historical conversations - not just the last 7 days of inbox.

## Architecture Note

The brief uses a **summary-first** approach:
- **Telegram**: Consumes only Daily Summaries (which include "Messages Needing Response" with exact quotes)
- **Granola**: Consumes only call Summaries (not raw transcripts)
- **Gmail**: Synced before brief generation, filtered to actionable emails only
- **Calendar**: Events cross-referenced against CRM contacts and Leads for call prep

Raw data (DMs, transcripts) is still stored and available for other skills, but the brief only reads pre-processed summaries to reduce token usage and improve signal-to-noise.

## Data Sources Status

| Source | Path | Status |
|--------|------|--------|
| **EOD Report** | 0 - Daily Briefs/End of Day/ | Active (carryover) |
| Telegram Daily Summary | Inbox/Telegram/Daily Summary/ | Active (primary Telegram source) |
| Telegram Raw DMs | Inbox/Telegram/DMs/ | Removed from brief (summaries only) |
| Granola Summaries | Inbox/Granola/Summaries/ | Active (primary Granola source) |
| Granola Raw Transcripts | Inbox/Granola/{call}/ | Removed from brief (summaries only) |
| Calendar | Inbox/Calendar/ | Active (7 days ahead, CRM-matched) |
| Gmail | Inbox/Gmail/ | Active (synced before brief, actionable only) |
| Slack | Inbox/Slack/ | Pending ingestion |
| Linear | Inbox/Linear/ | Pending ingestion |
| Notion | Inbox/Notion/ | Pending ingestion |

## Calendar Integration

The brief reads calendar data for **today + next 7 days** from `Inbox/Calendar/{date}.md`. This allows:
- Seeing upcoming meetings that need prep
- Identifying scheduling conflicts
- Planning around travel and events

Calendar data is synced automatically at 7:45am via `calendar-sync` launchd agent.

## Call Prep Integration

The brief generates **inline call prep** for each meeting based on call type:

| Call Type | Prep Format |
|-----------|-------------|
| **Client Discovery** | Full profile table (Org, Size, Request, Tried, Maturity, Play) + 6 tailored discovery questions |
| **Cofounder/Internal** | Prep bullets with topics and decisions |
| **Networking** | Context + goals to explore |
| **Other** | Brief prep note or skip |

### Client Discovery Call Prep Includes:

1. **Company Profile Table**
   - Org, Size, Request, Tried, Maturity, Play

2. **AI Maturity Assessment**
   - LOW: Haven't used AI tools systematically
   - MEDIUM: Using tools but no integrated system
   - HIGH: Already has AI bots/automation, looking for next level

3. **Play Strategy**
   - Positioning angle based on their context
   - What to probe for
   - Potential deal size signals

4. **Tailored Discovery Questions**
   - Based on their stated problem/request
   - YC qualifying principles (decision maker, budget, timeline, pain severity)
   - What they've already tried (to avoid)
   - Information gaps to fill

This replaces the need for separate `/call-prep` for most discovery calls — the morning brief front-loads all prep.
