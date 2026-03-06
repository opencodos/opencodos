# LinkedIn Feed Browse Workflow

Scan LinkedIn home feed to discover trending topics for content creation.

## Inputs

- LinkedIn account: loaded from Core Memory
- Focus areas: AI/agents, founder sales, distribution, SaaS, B2B

## Workflow Steps

### 1. SETUP

Get browser context and navigate to LinkedIn:

```
mcp__claude-in-chrome__tabs_context_mcp (createIfEmpty: true)
mcp__claude-in-chrome__navigate (url: "https://www.linkedin.com/feed/")
```

Wait 3-5 seconds for the feed to load.

### 2. SCAN FEED

Scroll through the home feed systematically:

- Take initial snapshot with `read_page`
- Scroll down 10 ticks, capture content
- Repeat 5-10 times to gather ~20-30 posts
- Note any trending hashtags or "News and views" sidebar items

**Capture for each post:**
- Author name, headline, and connection degree
- Post content (first ~200 chars)
- Engagement: reactions, comments, reposts
- Any media (article links, carousels, videos)
- Timestamp

### 3. FILTER & RANK

Filter posts by relevance:

**Include:**
- AI/ML agents, tools, AI engineering workflows
- Claude Code, Codex, OpenClaw tips and tricks
- Running agents in parallel / AI automation
- Founder-led sales, marketing, distribution enabled by AI
- B2B SaaS growth stories
- Startup building, fundraising, YC
- High engagement (>50 reactions OR >20 comments)

**Exclude:**
- Pure motivational/hustle-porn posts
- Recruiter spam / "I'm hiring" posts
- Celebrity endorsements
- Low-signal "agree?" engagement bait
- Politics (unless tech-relevant)

**Rank by:**
1. Relevance to user's interests (AI OS, founder sales, distribution)
2. Engagement signals (comments > reactions — comments mean real discussion)
3. Recency (prefer <48h)
4. Potential for unique angle from user's experience

### 4. SYNTHESIZE TOPICS

Identify 5 top topics from scan. For each:

```
## [Topic Number]. [Topic Title]

**Engagement:** [X reactions, Y comments on key posts]

**What's happening:**
- [Bullet 1: Core development/news]
- [Bullet 2: Supporting data point]
- [Bullet 3: Key voices/people discussing]

**Angle for user:** [Suggested post angle matching his voice — based on user's background and expertise from Core Memory]
```

### 5. OUTPUT

Display topics in structured format to user.

**Save** to `Vault/2 - Projects/Personal/Content/Daily research/LinkedIn/{DATE}-linkedin-browse.md`:

```markdown
# Browse: LinkedIn Feed
**Date:** {DATE} {TIME}
**Source:** LinkedIn home feed

---

[Topic entries from Step 4]

---

## Raw Scan Notes
[Any additional context, posts to revisit, people to connect with]
```

Where `{DATE}` = `YYYY-MM-DD` format.

### 6. LOG

Append summary to today's todo file if it exists:
- Add under a "Content Research" section
- Note number of posts scanned and topics identified

## Quality Gates

Before presenting topics:

1. **Relevance check**: All 5 topics fit user's focus areas
2. **Freshness check**: Topics are current (<48h)
3. **Engagement check**: Each topic has real discussion (not just reactions)
4. **Angle check**: Each topic has a non-obvious angle for user's voice
5. **Diversity check**: Topics span different themes

## Tips for Better Scans

- LinkedIn algorithm favors posts from 1st-degree connections
- Sort by "Top" vs "Recent" for different signals
- Check "My Network" for new connections' content
- Look for long-form articles, not just short posts
- Carousel/document posts often have higher engagement
- Comments section often has better insights than the post itself

## Error Handling

**If LinkedIn not logged in:**
- Report to user, suggest manual login
- Don't attempt automated login

**If feed is empty/loading:**
- Wait additional 3-5 seconds
- Refresh page once
- Report if still failing

**If browser extension not responding:**
- Check `tabs_context_mcp` for available tabs
- Report connection issue to user
- Suggest running `/chrome` to re-enable
