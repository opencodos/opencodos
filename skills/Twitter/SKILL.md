---
name: twitter
description: Read tweets, search Twitter/X, research people before calls
---

# Twitter/X Research

> Read-only Twitter access via bird CLI. Use for research, not posting.

## Trigger

```
/twitter [action] [args]
```

## Actions

| Action | Example | Description |
|--------|---------|-------------|
| search | `/twitter search "from:karpathy"` | Search tweets |
| read | `/twitter read https://x.com/user/status/123` | Read single tweet |
| user | `/twitter user @elonmusk` | Get user's recent tweets |
| mentions | `/twitter mentions @yourusername` | Get mentions of a user |
| thread | `/twitter thread <url>` | Get full conversation |

## Execution

This skill runs via MCP subprocess to save context:

```bash
Dev/Ops/mcp/run-mcp.sh twitter "[task]"
```

### Examples

```bash
# Search for tweets
run-mcp.sh twitter "Search for tweets about 'AI agents' from the last week, return top 10"

# Research a person before a call
run-mcp.sh twitter "Get recent tweets from @naval, summarize his current interests"

# Read a specific tweet and replies
run-mcp.sh twitter "Read this tweet and its replies: https://x.com/karpathy/status/123"

# Find mentions
run-mcp.sh twitter "Find recent mentions of @yourusername"
```

## Available Tools (MCP)

| Tool | Purpose |
|------|---------|
| `twitter_search` | Search tweets by query |
| `twitter_read` | Read single tweet by URL/ID |
| `twitter_user_tweets` | Get user's profile tweets |
| `twitter_mentions` | Get mentions of a user |
| `twitter_thread` | Get conversation thread |
| `twitter_replies` | Get replies to a tweet |

## Search Query Syntax

Twitter search supports operators:

| Operator | Example | Description |
|----------|---------|-------------|
| `from:` | `from:elonmusk` | Tweets from user |
| `to:` | `to:openai` | Replies to user |
| `@` | `@anthropic` | Mentions of user |
| `"phrase"` | `"AI safety"` | Exact phrase |
| `-word` | `AI -crypto` | Exclude word |
| `since:` | `since:2024-01-01` | After date |
| `until:` | `until:2024-12-31` | Before date |
| `filter:links` | `filter:links` | Only tweets with links |
| `filter:media` | `filter:media` | Only tweets with media |

## Use Cases

### Pre-call Research
Before meeting someone, check their recent tweets:
```
/twitter user @personname
```

### Monitor Topics
Track what people are saying about a topic:
```
/twitter search "example protocol"
```

### Competitive Intelligence
See what competitors are posting:
```
/twitter user @competitor
```

### Find Conversations
Get context on a viral thread:
```
/twitter thread https://x.com/user/status/123
```

## Setup

Credentials stored in the secrets backend (`~/.codos/secrets.json`):
```
TWITTER_AUTH_TOKEN=xxx
TWITTER_CT0=xxx
```

Set via: `python -m backend secrets set TWITTER_AUTH_TOKEN <token>`

Extract from Chrome DevTools: x.com > Application > Cookies > `auth_token` and `ct0`

## Limitations

- **Read-only**: No posting (X blocks bots aggressively)
- **Rate limits**: X may rate-limit heavy usage
- **Cookie expiry**: Credentials may expire, re-extract if errors occur

---

*Added: 2026-01-28*
