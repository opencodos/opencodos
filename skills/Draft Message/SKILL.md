---
name: draft
description: Craft a polished message with research and iteration. Use for follow-ups, pitches, or thoughtful notes.
---

# Draft Message

> Craft a thoughtful, polished message. Research context, generate options, iterate before sending.

**For quick fire-and-forget messages, use `/msg` instead.**

## Trigger

```
/draft [contact] [topic/intent]
```

Examples:
- `/draft Alex follow-up on partnership discussion`
- `/draft Sam thank him for intro to investor`
- `/draft Chris pitch Atlas product`
- `/draft Pat plan weekend trip`

## Execution Flow

```
1. Parse → 2. Research Context → 3. Ask Channel → 4. Determine Tone → 5. Draft Options → 6. Iterate → 7. Send
```

### Step 1: Parse Input

Extract:
- **Contact**: Who to message
- **Intent**: What the message should accomplish

### Step 2: Research Context

Gather background before drafting:

| Source | Path | What to Find |
|--------|------|--------------|
| CRM | `Vault/4 - CRM/` | Relationship level, hypothesis, notes |
| Inbox | `Vault/1 - Inbox/` | Recent messages with this person |
| Granola | `Vault/1 - Inbox/Granola/` | Recent meeting notes mentioning them |

**Also use MCP tools:**
- `get_last_interaction` — Most recent exchange
- `search_messages` — Find relevant past conversations

### Step 3: Ask Channel

```
Send via:
1. Telegram
2. Slack
3. Email
```

### Step 4: Determine Tone

Based on context:

| Factor | Impact on Tone |
|--------|----------------|
| Relationship level (1-5) | Higher = more casual |
| Topic (business/personal) | Business = slightly more polished |
| Recent interaction | Warm = more familiar |
| Language | Russian/English patterns |

**Tone Matrix:**

| Relationship | Topic | Tone |
|--------------|-------|------|
| Close (5) | Casual | Very informal, warm |
| Close (5) | Business | Direct but friendly |
| Medium (3-4) | Casual | Friendly, light |
| Medium (3-4) | Business | Professional, concise |
| New (1-2) | Any | Clear, value-focused |

### Step 5: Draft Options

Generate 2-3 versions with different approaches:

```markdown
## Draft Options for [Contact]

**Context:** [1-2 sentence summary of relationship + recent interactions]

**Intent:** [What this message should accomplish]

---

### Option 1: Casual
[Draft text]

### Option 2: Professional
[Draft text]

### Option 3: Brief
[Draft text]

---

Pick 1/2/3, request edits, or ask for more options.
```

### Step 6: Iterate

User can:
- Pick an option: "go with 2"
- Request edits: "make it shorter" / "add mention of our last call"
- Ask for more: "give me a warmer version"

Keep iterating until user is satisfied.

### Step 7: Send

Once approved:

```
Final message to [Contact] via [Channel]:

[Final draft]

Send? (yes/no)
```

Use the appropriate channel's tools to send: Telegram script, Slack MCP tools directly, or Gmail MCP tools for email (e.g., `gmail_send` with recipient, subject, body).

---

## Tone Examples by Relationship

### Close Friend (Level 5) — Russian

**Casual:**
```
Привет! Как дела? Давно не общались - давай как-нибудь созвонимся, расскажу что нового.
```

**Business:**
```
Привет! Есть идея обсудить - думаю тебе будет интересно. Когда удобно созвониться?
```

### Close Contact (Level 4) — English

**Casual:**
```
hey! been a while - would love to catch up when you have time. how's everything going?
```

**Business:**
```
hey, wanted to follow up on our last chat. have some updates that might be relevant - free for a quick call this week?
```

### New Connection (Level 1-2) — English

**Professional:**
```
Hi [Name], hope you're doing well. [Mutual connection] suggested I reach out - I'm working on [brief context] and thought there might be some interesting overlap with what you're building. Would you be open to a quick intro call?
```

---

## Research Prompts

When gathering context, look for:

1. **Last interaction**: When did we last talk? What about?
2. **Relationship history**: How did we meet? What's the connection?
3. **Current relevance**: Why am I reaching out now?
4. **Their context**: What are they working on? Recent news?
5. **Shared interests**: What do we have in common?

---

## Channel-Specific Formatting

### Telegram
- Short paragraphs
- No subject line
- Casual punctuation

### Slack
- Can be slightly longer
- Use threads for context
- @mentions if needed

### Email
- Subject line required
- More structured
- Signature appropriate

---

## Error Handling

| Issue | Action |
|-------|--------|
| No context found | Ask user for background |
| Contact not in CRM | Proceed with available info |
| User wants to save draft | Copy to clipboard or save to Inbox |
| Channel not ready | Offer to save draft for later |
