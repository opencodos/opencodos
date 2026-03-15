# Slack Integration

> Send messages, list channels, find users, and fetch conversation history from Slack.

## Trigger

```
/slack [action] [args]
```

Examples:
- `/slack send #general "hey team, quick update"`
- `/slack history #engineering`
- `/slack find user john`

## Execution

Slack tools are available directly via the Official Slack MCP (claude.ai Connectors). No wrapper script needed.

**Tool prefix:** `mcp__claude_ai_Slack__slack_*`

## Available Tools

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `slack_send_message` | Send message to channel/user | `channel`, `text` |
| `slack_search_channels` | Search workspace channels | query |
| `slack_search_users` | Search users by name/email | query |
| `slack_read_channel` | Read channel messages | `channel` |
| `slack_read_thread` | Read a thread | `channel`, `thread_ts` |
| `slack_read_user_profile` | Get user profile info | `user` |
| `slack_search_public` | Search public messages | `query` |
| `slack_search_public_and_private` | Search all messages | `query` |
| `slack_read_canvas` | Read a canvas | `canvas_id` |
| `slack_create_canvas` | Create a new canvas | `title`, `content` |
| `slack_send_message_draft` | Create message draft | `channel`, `text` |
| `slack_schedule_message` | Schedule a message | `channel`, `text`, `post_at` |

## Common Workflows

### Send a Message

```
1. If channel unknown → slack_search_channels to find it
2. slack_send_message with channel ID and text
```

### Find Someone and DM

```
1. slack_search_users with name
2. slack_send_message with user ID as channel
```

### Get Recent Activity

```
1. slack_search_channels to find relevant channel
2. slack_read_channel with channel ID
```

### Search Messages

```
1. slack_search_public_and_private with search query
```

## Notes

- Channel IDs start with `C` (channels) or `D` (DMs)
- User IDs start with `U`
- Tools are auto-discovered from claude.ai Connectors — no setup needed beyond initial OAuth
- Use `ToolSearch` to discover exact tool names if needed

## Output: Save to Inbox

**Always finish by saving fetched messages to Inbox.**

Save to: `Vault/1 - Inbox (Last 7 days)/Slack/{date} {channel}.md`

Format:
```markdown
# Slack #{channel} — {date}

> Fetched: {date}, last 24h messages

## Messages

| Time | Sender | Message |
|------|--------|---------|
| {time} | {resolved_name} | {text} |

## Summary

- {count} messages total
- {key observations}
```

This ensures messages are persisted for briefs and future reference.

## Error Handling

| Issue | Action |
|-------|--------|
| Channel not found | Search channels and ask user to pick |
| User not found | Search with partial name |
| Not in channel | Suggest joining or using different channel |
| Tools not available | Check claude.ai Settings → Connectors → Slack is connected |
