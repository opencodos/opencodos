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

## Execution (Wrapper)

Use the MCP wrapper to load only the needed server:

```bash
"Dev/Ops/mcp/run-mcp.sh" slack "[task description]"
```

Example for `/slack send #general "hello"`:
```bash
"Dev/Ops/mcp/run-mcp.sh" slack "Send message 'hello' to the #general Slack channel using SLACK_SEND_MESSAGE"
```

## MCP Server

`composio-slack` — HTTP transport via Composio (loaded in ~/atlas-mcp)

## Critical Tools (Always Available)

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `SLACK_SEND_MESSAGE` | Send message to channel/user | `channel`, `text` |
| `SLACK_LIST_ALL_CHANNELS` | List workspace channels | `limit` |
| `SLACK_FIND_USERS` | Search users by name/email | `query` |
| `SLACK_LIST_ALL_USERS` | List all workspace members | `limit` |
| `SLACK_FETCH_CONVERSATION_HISTORY` | Get channel messages | `channel`, `oldest`, `limit` |

## Fetching Recent Messages (Last 24h)

**Critical:** Always pass `oldest` timestamp to get recent messages. Without it, the API returns oldest messages first.

```python
# Calculate 24h ago in Unix timestamp
import time
oldest = int(time.time()) - 86400  # 86400 = 24 hours
```

Wrapper call:
```bash
"Dev/Ops/mcp/run-mcp.sh" slack \
  "Call SLACK_FETCH_CONVERSATION_HISTORY with:
   - channel: C08XXXXXX (get from SLACK_LIST_ALL_CHANNELS)
   - oldest: {unix_timestamp_24h_ago}
   - limit: 200
   Return raw message data: sender, timestamp, text"
```

**Example with actual timestamp:**
```bash
"Dev/Ops/mcp/run-mcp.sh" slack \
  "Call SLACK_FETCH_CONVERSATION_HISTORY with channel='C08ABC123', oldest=1736985600, limit=200. Return sender, timestamp, text for each message."
```

## Common Workflows

### Send a Message

```
1. If channel unknown → SLACK_LIST_ALL_CHANNELS to find it
2. SLACK_SEND_MESSAGE with channel ID and text
```

### Find Someone and DM

```
1. SLACK_FIND_USERS with name
2. SLACK_SEND_MESSAGE with user ID
```

### Get Recent Activity

```
1. SLACK_LIST_ALL_CHANNELS to find relevant channel
2. SLACK_FETCH_CONVERSATION_HISTORY with channel ID
```

## Notes

- Channel IDs start with `C` (channels) or `D` (DMs)
- User IDs start with `U`
- Use channel names with `#` prefix when searching
- **Rate limits are strict** — always use low limits (<10 messages per request)
- User IDs work as channel IDs for DMs (e.g., `channel="U09J9V3SZN3"`)

## Important

**Never fabricate results.** If a tool returns 2 items when you requested 10, report those 2 items and explain the API returned fewer results.

**Always resolve user IDs to names.** Messages contain user IDs (e.g., `U09JE8XLMPG`), not names. You MUST call `SLACK_LIST_ALL_USERS` to map IDs to real names. Never guess or hallucinate names.

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
| Channel not found | List channels and ask user to pick |
| User not found | Search with partial name |
| Not in channel | Suggest joining or using different channel |
| Auth expired | Re-authenticate via Composio dashboard |
