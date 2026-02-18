# Gmail Integration

> Send emails, read inbox, search messages, and manage drafts.

## Trigger

```
/gmail [action] [args]
```

Examples:
- `/gmail inbox` — fetch recent emails
- `/gmail send user@example.org "subject" "body"`
- `/gmail search from:john`

## Execution (Wrapper)

Use the MCP wrapper to load only the needed server:

```bash
"Dev/Ops/mcp/run-mcp.sh" gmail "[task description]"
```

Example for `/gmail inbox`:
```bash
"Dev/Ops/mcp/run-mcp.sh" gmail "Fetch my 5 most recent emails using GMAIL_FETCH_EMAILS with ids_only=true"
```

## MCP Server

`composio-gmail` — HTTP transport via Composio (loaded in ~/atlas-mcp)

## Critical Tools (Always Available)

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `GMAIL_SEND_EMAIL` | Send email | `to`, `subject`, `body` |
| `GMAIL_FETCH_EMAILS` | List emails (use `ids_only=true` first) | `query`, `max_results`, `ids_only` |
| `GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID` | Get full email content | `message_id` |
| `GMAIL_CREATE_EMAIL_DRAFT` | Save draft | `to`, `subject`, `body` |
| `GMAIL_REPLY_TO_THREAD` | Reply to existing thread | `thread_id`, `body` |
| `GMAIL_SEARCH_PEOPLE` | Find contacts | `query` |

## Two-Phase Email Fetching (Critical)

**Phase 1: Lightweight listing (~20 tokens per email)**
```
GMAIL_FETCH_EMAILS(
  query="after:2025/12/16",  # Gmail query syntax
  ids_only=true,             # KEY: Only returns message IDs
  include_payload=false,     # Skip body/attachments
  verbose=false,             # Minimal metadata
  max_results=20
)
```

**Phase 2: Fetch ONLY 3-5 most relevant emails**
```
GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID(
  message_id="19b4a209...",
  format="metadata"  # Use "full" only when body content needed
)
```

**DO NOT fetch all emails** — filter out notifications, calendar accepts, etc. Pick 3-5 based on subject/sender from Phase 1.

## Common Workflows

### Check Inbox

```
1. GMAIL_FETCH_EMAILS with ids_only=true, max_results=10
2. For important ones → GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID
```

### Send Email to Contact

```
1. If email unknown → GMAIL_SEARCH_PEOPLE to find it
2. GMAIL_SEND_EMAIL with recipient, subject, body
```

### Reply to Thread

```
1. GMAIL_FETCH_EMAILS to find message
2. GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID to get thread_id
3. GMAIL_REPLY_TO_THREAD with response
```

## Gmail Search Operators

| Operator | Example |
|----------|---------|
| `from:` | `from:contact@example.org` |
| `to:` | `to:recipient@example.org` |
| `subject:` | `subject:meeting` |
| `is:unread` | Unread emails |
| `newer_than:` | `newer_than:7d` |
| `has:attachment` | Emails with attachments |

## Notes

- Thread IDs are different from message IDs
- Use search operators to filter large inboxes
- Drafts can be edited before sending
- CC/BCC supported in send

## Output: Save to Inbox

**Always finish by saving fetched emails to Inbox.**

Save to: `Vault/1 - Inbox (Last 7 days)/Gmail/{date}.md`

Format:
```markdown
# Gmail — {date}

> Fetched: {date}, last 24h emails

## Emails

| Time | Sender | Subject |
|------|--------|---------|
| {time} | {sender} | {subject} |

## Summary

- {count} emails total
- {key observations: action items, important senders, notifications}
```

Filter out noise (calendar accepts, marketing) and highlight action items.

## Error Handling

| Issue | Action |
|-------|--------|
| Contact not found | Search with partial name/email |
| Thread not found | Fetch recent emails to locate |
| Send failed | Check recipient format |
| Auth expired | Re-authenticate via Composio |
