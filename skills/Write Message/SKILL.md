---
name: msg
description: Quick send a message via Telegram, Slack, or Email. Use for fast, direct messages.
---

# Write Message

> Quick send a message via Telegram, Slack, or Email. Fast, direct, matches user's voice.

**For polished/thoughtful messages, use `/draft` instead.**

## Trigger

```
/msg [contact] [message]
```

Examples:
- `/msg Pat hi - test`
- `/msg Sam давай созвонимся завтра`
- `/msg Alex can we chat tomorrow?`

## Execution Flow

```
1. Parse → 2. Ask Channel → 3. Find Contact → 4. Fetch Context → 5. Apply Style → 6. Confirm → 7. Send
```

### Step 1: Parse Input

Extract:
- **Contact**: Name or identifier
- **Message**: What to send (can be intent like "schedule call tomorrow")

### Step 2: Ask Channel

Always ask user:

```
Send via:
1. Telegram (recommended)
2. Slack
3. Email
```

### Step 3: Find Contact

Use channel's MCP tools:

| Channel | Tool | Status |
|---------|------|--------|
| Telegram | `search_contacts`, `resolve_username` | Ready |
| Slack | `search_users` | Placeholder |
| Email | `search_contacts` | Placeholder |

### Step 4: Fetch Context

**Before drafting, understand the conversation state.**

1. **Check vault for history:**
   - `Vault/1 - Inbox (Last 7 days)/Telegram/DMs/[contact].md`
   - `Vault/4 - CRM/` for relationship context
   - Grep for contact name in Daily Summaries

2. **If Telegram MCP available:**
   - Use `get_messages` to fetch recent messages
   - Use `get_last_interaction` to see last exchange
   - Note: who sent last message, what was discussed, any open threads

3. **If no history found:**
   - Ask user: "No conversation history found. What's the context?"
   - Get: relationship type, last interaction, topic for this message

4. **Shape message based on context:**
   - Continuing a thread → reference previous topic
   - Cold/new contact → proper introduction
   - Following up → acknowledge time gap if needed

### Step 5: Apply Style

Detect language from contact name, then apply user's voice.

### Step 6: Confirm

```
To: [Contact Name]
Via: [Channel]
Message: [Draft]

Send? (yes/no)
```

Skip confirmation only if user said "send" or "tell them" explicitly.

### Step 7: Send

**Telegram:**
Run directly via Bash (no MCP needed):
```
python3 "$CODOS_PATH/scripts/send-telegram.py" \
  --chat "[chat_name_or_id]" \
  --message "[message]"
```

For files:
```
python3 "$CODOS_PATH/scripts/send-telegram.py" \
  --chat "[chat_name_or_id]" \
  --message "[caption]" \
  --file "/path/to/file"
```

**Slack / Email:** Use channel's MCP: `send_message` (via `run-mcp.sh`)

---

## Channel Tools

### Telegram (Ready — Direct Script)

| Action | How |
|--------|-----|
| Send message | `python3 scripts/send-telegram.py --chat "Name" --message "text"` |
| Send file | `python3 scripts/send-telegram.py --chat "Name" --message "caption" --file /path` |
| Search contacts | Script resolves by name substring automatically |

### Slack (Placeholder)

```
# When Slack MCP is ready:
- search_users
- send_message
- post_message
```

### Email (Placeholder)

```
# When Gmail MCP is ready:
- search_contacts
- send_email
- create_draft
```

---

## Messaging Style

### General Rules

- **Ultra concise** — Fewest words possible
- **No fluff** — Skip pleasantries beyond greeting
- **Lowercase casual** — No caps unless necessary
- **Direct asks** — State what you need upfront
- **No emojis** — Unless they use them first

### Russian

**Greeting:** `Привет!`

**Patterns:**
```
давай созвонимся [когда]?
давай / ок / отправил!
наберемся в ближайшее время?
Вот [что]. Дай знать если захочешь обсудить.
```

**Real examples:**
```
Привет, завтра утром твоим давай созвонимся?
Отправил!
давай
Давай в 10 по Лондону - отправлю ссылку.
```

### English

**Greeting:** `hey` or skip

**Patterns:**
```
how about [time]? I'm in [location] - can speak until [time]
sure / sounds good / works
5 min / on it
```

**Real examples:**
```
how about 10-11a Lisbon? I'm in Asia - can speak until 4p your time
Sure
5 min
```

---

## Language Detection

| Contact Type | Language |
|--------------|----------|
| Cyrillic name | Russian |
| English name | English |
| Unsure | Ask user |

### Known Russian Contacts

Detect from CRM contacts with Cyrillic names.

### Known English Contacts

Detect from CRM contacts with Latin names.

---

## Error Handling

| Issue | Action |
|-------|--------|
| Contact not found | Ask user to clarify |
| Multiple matches | Show options |
| Telegram send fails | Check session string at `~/.codos/config/telegram/session.string` |
| Channel not ready | "Slack/Email MCP not configured yet" |

---

## Execution Notes

**Never use background mode for send operations.** Run MCP sends directly with a longer timeout (120s). Background mode can cause duplicate sends if you retry before the first task completes.
