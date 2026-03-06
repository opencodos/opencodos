---
name: schedule
description: Schedule a meeting - find optimal slot, create calendar event, send confirmation. Use when booking calls or meetings.
---

# Schedule Meeting Skill

> Find optimal meeting slot, create calendar event, send confirmation in original channel/language.

## Trigger

```
/schedule [contact] [context]
```

**Examples:**
- `/schedule Max call tomorrow`
- `/schedule Alex sync - he proposed 9am or 2pm EST`
- `/schedule Chris this week - Lisbon timezone`
- `/schedule Sam reconnect` ← reconnect mode (propose slots first)

## Modes

### Mode 1: Direct Schedule
They replied with availability, or you're creating event now.
→ Find slot → Create event → Send confirmation

### Mode 2: Reconnect (Propose Slots)
Reaching out after a while, need to propose times first.
→ Check travel → Find 2 slots → Confirm with user → Send proposal message

**Detect reconnect mode:** Keywords like "reconnect", "follow up", "been a while", "post-NY", "get back to"

## User's Preferences

**Preferred windows (in user's current timezone):**
- 12:00 - 13:30 (lunch calls)
- 16:00 - 18:30 (afternoon calls)

**Bundling:** Prefer slots adjacent to existing calls (no gaps)

**Empty days:** Prefer late (17:30-18:00) to preserve deep work time

**Their timezone:** Validate slot is 8am-10pm in contact's timezone

**Travel buffer:** Cannot speak 2.5h before or after flights

## Execution Flow

### Step 0: Verify Current Date

Before any date calculations, run:
```bash
date "+%A %B %d, %Y"
```

This returns day of week + full date (e.g., "Monday January 19, 2026").
Use this to accurately calculate relative dates like "Thursday" or "next week".

**Why this matters:** The system prompt only provides the date, not the day of week. Without verification, "Thursday" might be calculated incorrectly.

### Step 1: Parse Input

Extract from user message:
- **Contact name** — who to schedule with
- **Date constraint** — "tomorrow", "this week", specific date
- **Time constraint** — their proposed times, if any
- **Their timezone** — explicit or from CRM
- **Mode** — direct schedule vs reconnect

### Step 2: Resolve Contact

1. Read `Vault/4 - CRM/Initial CRM.md`
2. Find contact by name
3. Extract:
   - Email (required for calendar invite)
   - Preferred channel (Telegram/Slack/Email)
   - Language (Russian/English)
   - Timezone (if known)

**If contact not found:** Ask user for email address

### Step 3: Get User's Timezone (Dynamic)

**Always read fresh on every invocation:**
1. Read `Vault/Core Memory/About me.md`
2. Parse `Current timezone:` field
3. Map to IANA timezone (see algorithm.md)

This ensures correct windows as the user travels (BKK → CET → etc.)

### Step 4: Check Travel (for multi-day scheduling)

If scheduling more than 1 day out:
1. Query calendar for date range
2. Look for flight/travel events
3. Mark blocked windows:
   - Flight time itself
   - 2.5h before departure
   - 2.5h after landing
4. Check if timezone changes (travel to different region)

Use Calendar MCP: `list_events` for the date range. Look for flights, travel, timezone changes.

**If timezone changes during target window:**
→ Confirm with user: "You'll be in CET by Thursday. Should I use CET windows for that call?"

### Step 5: Parse Time Constraints

If they proposed specific times:
1. Parse times from context (e.g., "9am or 2pm EST")
2. Convert each to user's timezone
3. Filter to user's preferred windows

If no times proposed:
1. Use their timezone to calculate valid range
2. Find slots within user's windows that are 8am-10pm their time

### Step 6: Query Calendar

Use Calendar MCP: `list_events` for the target date. Return start/end times.

### Step 7: Apply Slot Algorithm

See `algorithm.md` for full logic.

Score available slots:
- **0 pts:** Immediately after existing call (perfect bundle)
- **1 pt:** Immediately before existing call
- **2 pts:** Same window as existing call
- **5 pts:** Different window (fragmentation)

If no calls that day → prefer 17:30

**Always identify top 2 slots** for reconnect mode.

### Step 8: Confirm with user

**Always confirm before sending, showing 2 options:**

```
Reconnecting with Sam. Proposing 2 slots:

1. Thursday 17:30 BKK (11:30 CET) — after morning call
2. Friday 12:30 BKK (6:30 CET) — lunch window

Travel note: You fly to Barcelona Sunday, so Mon+ would be CET.

Send these options via Telegram (Russian)?
```

### Step 9a: Reconnect Mode → Send Proposal

Send message proposing the 2 slots (see templates.md for format):

**Telegram:**
```bash
cd "ingestion/Telegram-agent" && python send_message.py "[chat_id]" "[message]"
```

**Slack:** Use `slack_send_message` tool directly with channel_id and message.

**Gmail:** Use Gmail MCP: `gmail_send` with recipient, subject, body.

### Step 9b: Direct Mode → Create Event + Confirm

**Event naming convention:**
- **1-1 calls:** `[Person's Name]//[Your Name]` (e.g., "Alex Smith//You")
- **Group calls:** `[Topic] - [Participants]`

Use Calendar MCP: `create_event` with summary "[Person's Name]//[Your Name]", start (ISO datetime), end (ISO datetime + 30min), attendees [email], and conferenceData for Google Meet link.

Then send confirmation message via appropriate channel.

## Error Handling

| Error | Response |
|-------|----------|
| No slots in preferred windows | "No slots available [date] in your preferred windows. Should I check [next day]?" |
| Contact not in CRM | "I don't have [contact]'s email. What's their email address?" |
| Timezone unclear | "What timezone is [contact] in?" |
| Slot is <8am or >10pm their time | "Best slot would be [Y] their time (early/late). Proceed or find alternative?" |
| Travel detected | "You have a flight on [date]. Blocking 2.5h buffer. Adjusted slots: ..." |
| Calendar API fails | "Calendar API error. Please try again or create manually." |

## Output

**Reconnect mode:**
```
Sent proposal to Sam via Telegram:
"Hey! It's been a while — how about a call Thursday 17:30 or Friday 12:30 (BKK time)?"

Waiting for response. When he confirms, say "/schedule Sam confirmed Thursday" to create event.
```

**Direct mode:**
```
Scheduled: Call with [Contact]
- When: [Date] at [Time] (BKK) / [Time] ([Their TZ])
- Where: Google Meet (link in calendar)
- Confirmation sent via [Channel]
```
