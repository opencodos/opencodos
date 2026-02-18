---
name: browse
description: Discover trending topics and content ideas from social feeds for post creation. Use when scanning Twitter timeline or finding content inspiration.
---

# Browse Skill

Discover trending topics and content ideas from social feeds via Chrome browser automation.

## Trigger

```
/browse [source]
```

## Capabilities

- **Twitter Feed Scan**: Browse home timeline for high-engagement topics
- **LinkedIn Feed Scan**: Browse LinkedIn feed for B2B topics and discussions
- **Topic Discovery**: Identify trends relevant to user's focus areas
- **Content Ideas**: Generate post angles from discovered topics

## Workflows

- `workflows/twitter-feed.md`: Scan Twitter timeline for topics
- `workflows/linkedin-feed.md`: Scan LinkedIn feed for topics

## Tools Used

- `mcp__claude-in-chrome__tabs_context_mcp`: Get/create browser context
- `mcp__claude-in-chrome__navigate`: Navigate to feeds
- `mcp__claude-in-chrome__read_page`: Extract feed content
- `mcp__claude-in-chrome__computer`: Scroll, screenshot, interact

## Prerequisites

1. Chrome extension "Claude in Chrome" installed (v1.0.36+)
2. `/chrome` enabled in Claude Code (run `/chrome` → "Enabled by default")
3. Logged into x.com and/or linkedin.com in Chrome

## Output Format

Returns structured topic list with:
- Topic title and summary
- Engagement signals (likes, views, retweets)
- Suggested angle for user's voice
- Key sources/accounts

## Topic Filters

Focus on content relevant to:
1. AI/agents and AI operating systems
2. Using AI engineering / Claude Code / OpenClaw / Codex tips and tricks
3. Running many agents in parallel
4. Founder-led sales, marketing and distribution enabled by AI

## Usage

```
/browse twitter        # Scan Twitter home timeline
/browse linkedin       # Scan LinkedIn home feed
```

## Output Location

- Twitter: `Vault/2 - Projects/Personal/Content/Daily research/Twitter/{DATE}-twitter-browse.md`
- LinkedIn: `Vault/2 - Projects/Personal/Content/Daily research/LinkedIn/{DATE}-linkedin-browse.md`

## Integration

Browse output feeds directly into:
- `/social` — Pick topic and generate post
- `/draft` — Expand topic into outreach message
- `/twitter search` — Deep dive on discovered topic

---

*Added: 2026-02-08*
