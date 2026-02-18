# /msg and /draft Skills Plan

## Overview

Two messaging skills with different intents:
- `/msg` - Quick send, minimal friction
- `/draft` - Polished composition, iterative

Both route through channel selection (ask user each time).

---

## Skill 1: `/msg` (Quick Send)

### Purpose
Fire off a quick message to a contact. Fast, direct, matches user's casual voice.

### Trigger
```
/msg [contact] [message]
/msg Pat hi
/msg Sam давай завтра созвонимся
```

### Flow

```
1. Parse input
   ├── Extract contact name
   └── Extract message (or intent to draft quick message)

2. Ask channel
   └── "Send via: Telegram / Slack / Email / Other?"

3. Find contact
   └── Use channel's MCP: search_contacts, resolve_username, etc.

4. Apply style
   ├── Detect language (Russian/English based on contact)
   └── Match user's voice (concise, no fluff)

5. Confirm
   └── "To: [Name] via [Channel]: [Message] — Send?"

6. Send
   └── Use channel's MCP: send_message
```

### MCP Tools by Channel

| Channel | Find Contact | Send |
|---------|--------------|------|
| Telegram | `search_contacts`, `resolve_username` | `send_message` |
| Slack | TBD (when MCP ready) | TBD |
| Email | TBD (when MCP ready) | TBD |

### Style Rules (from existing SKILL.md)

**Russian:**
- Greeting: `Привет!`
- Ultra concise: `давай`, `ок`, `отправил!`
- Direct scheduling: `давай созвонимся завтра?`

**English:**
- Greeting: `hey` or skip
- Lowercase, no fluff
- Example: `sounds good`, `5 min`

---

## Skill 2: `/draft` (Compose)

### Purpose
Craft a thoughtful, polished message. Research context, draft options, iterate before sending.

### Trigger
```
/draft [contact] [topic/intent]
/draft Alex follow-up on partnership discussion
/draft Sam thank him for intro to investor
/draft Chris pitch Atlas product
```

### Flow

```
1. Parse input
   ├── Extract contact name
   └── Extract topic/intent

2. Research context
   ├── Check CRM: relationship level, last interaction
   ├── Check Inbox: recent messages with this person
   └── Check Calendar/Granola: recent meetings

3. Ask channel
   └── "Send via: Telegram / Slack / Email / Other?"

4. Determine tone
   ├── Relationship level (close friend vs business contact)
   ├── Topic (casual catch-up vs formal request)
   └── Language (Russian/English)

5. Draft message
   ├── Generate 2-3 options with different tones
   └── Show to user for selection

6. Iterate
   └── User picks one, requests edits, or asks for more options

7. Confirm final
   └── "To: [Name] via [Channel]: [Final Message] — Send?"

8. Send
   └── Use channel's MCP
```

### Context Sources

| Source | Path | What to Extract |
|--------|------|-----------------|
| CRM | `Vault/4 - CRM/` | Relationship level, hypothesis, last contact |
| Inbox | `Vault/1 - Inbox/` | Recent messages, tone of conversation |
| Granola | `Vault/1 - Inbox/Granola/` | Recent meeting notes |
| Calendar | TBD | Upcoming/past meetings |

### Tone Matrix

| Relationship | Topic | Tone |
|--------------|-------|------|
| Close (5) | Casual | Very informal, jokes ok |
| Close (5) | Business | Direct but warm |
| Medium (3-4) | Casual | Friendly, concise |
| Medium (3-4) | Business | Professional but not stiff |
| New (1-2) | Any | Polished, clear value prop |

### Draft Output Format

```markdown
## Draft Options for [Contact]

**Context:** [Summary of relationship + recent interactions]

### Option 1 (Casual)
[Draft text]

### Option 2 (Professional)
[Draft text]

### Option 3 (Brief)
[Draft text]

---
Pick 1/2/3, or tell me how to adjust.
```

---

## File Structure

```
2 - Skills/
├── Write Message/
│   └── SKILL.md        # /msg - Quick send (update existing)
└── Draft Message/
    └── SKILL.md        # /draft - Polished composition (new)
```

---

## Implementation Order

1. **Update `/msg` SKILL.md**
   - Add channel selection step (ask user)
   - Keep style rules
   - Simplify: remove "polished" use cases (those go to /draft)

2. **Create `/draft` SKILL.md**
   - Full research → draft → iterate flow
   - Tone matrix
   - Multiple draft options

3. **Update orchestrator.md**
   - Add `/draft` to skill list
   - Clarify when to use `/msg` vs `/draft`

---

## Open Questions

1. **Channel MCP availability**: Only Telegram ready now. Stub out Slack/Email?
2. **CRM format**: Is current CRM structure enough for relationship lookup?
3. **Draft storage**: Save drafts to a file for later, or just in conversation?

---

*Created: 2025-01-15*
