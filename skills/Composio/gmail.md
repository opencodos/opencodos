# Gmail Integration

> Search emails, read threads, send messages, and manage drafts via Gmail.

## Trigger

```
/gmail [action] [args]
```

Examples:
- `/gmail check inbox`
- `/gmail search "from:alex newer_than:7d"`
- `/gmail send alex@example.com "Meeting follow-up"`

## Execution

Gmail tools are available directly via the Official Gmail MCP (claude.ai Connectors). No wrapper script needed.

**Tool prefix:** `mcp__claude_ai_Gmail__gmail_*`

## Available Tools

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `gmail_search` | Search threads/messages | `query` (Gmail query syntax) |
| `gmail_get_thread` | Get full thread with all messages | `thread_id` |
| `gmail_get_message` | Get a single message by ID | `message_id` |
| `gmail_send` | Send an email | `to`, `subject`, `body` |
| `gmail_create_draft` | Create a draft email | `to`, `subject`, `body` |
| `gmail_list_drafts` | List existing drafts | -- |
| `gmail_reply` | Reply to a message/thread | `message_id`, `body` |

> **Note:** Exact tool names are placeholders — use `ToolSearch` for "gmail" to discover actual tool names after enabling the connector.

## Common Workflows

### Check Inbox (Two-Phase)

```
1. gmail_search with query "newer_than:1d" → get thread list
2. gmail_get_thread for each relevant thread → full content
```

### Reply to Thread

```
1. gmail_search with query "from:alex subject:proposal"
2. gmail_reply with message_id and body
```

### Send with Attachment

```
1. gmail_send with to, subject, body, and attachment parameters
```

## Gmail Search Query Syntax

| Operator | Example | Description |
|----------|---------|-------------|
| `from:` | `from:alex@example.com` | Sender |
| `to:` | `to:team@example.com` | Recipient |
| `subject:` | `subject:meeting` | Subject line |
| `newer_than:` | `newer_than:7d` | Age (d=days, m=months, y=years) |
| `older_than:` | `older_than:30d` | Older than |
| `is:unread` | `is:unread` | Unread emails |
| `is:starred` | `is:starred` | Starred emails |
| `has:attachment` | `has:attachment` | Has attachments |
| `filename:` | `filename:pdf` | Attachment type |
| `label:` | `label:important` | By label |
| `in:` | `in:sent` | In folder (sent, trash, spam) |
| `{a b}` | `{from:a from:b}` | OR (curly braces) |
| `-` | `-from:noreply` | NOT (exclude) |

Combine operators: `from:alex subject:budget newer_than:7d has:attachment`

## Output: Save to Inbox

Save fetched emails to: `Vault/1 - Inbox (Last 7 days)/Gmail/{date}.md`

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
- {key observations: action items, important senders}
```

Filter out noise (calendar accepts, marketing) and highlight action items.

## Notes

- Thread IDs differ from message IDs
- Tools are auto-discovered from claude.ai Connectors — no setup needed beyond initial OAuth
- Use `ToolSearch` to discover exact tool names if needed

## Error Handling

| Issue | Action |
|-------|--------|
| Thread not found | Search with different query |
| Send fails | Check recipient address |
| Tools not available | Check claude.ai Settings → Connectors → Gmail is connected |
