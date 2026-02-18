# Twitter Feed Browse Workflow

Scan Twitter home timeline to discover trending topics for content creation.

## Inputs

- Twitter account: configured in your profile
- Focus areas: AI/agents, founder sales, distribution, SaaS, crypto

## Workflow Steps

### 1. SETUP

Get browser context and navigate to Twitter:

```
mcp__claude-in-chrome__tabs_context_mcp (createIfEmpty: true)
mcp__claude-in-chrome__navigate (url: "https://x.com/home")
```

Wait 3-5 seconds for the feed to load.

### 2. SCAN FEED

Scroll through the home timeline systematically:

- Take initial snapshot with `read_page`
- Scroll down 10 ticks, capture content
- Repeat 5-10 times to gather ~20-30 posts
- Note trending topics in sidebar

**Capture for each post:**
- Author and handle
- Post content (first ~200 chars)
- Engagement: replies, retweets, likes, views
- Quoted/linked content if relevant
- Timestamp

### 3. SCAN BOOKMARKS

After scanning the feed, navigate to bookmarks to review saved posts:

```
mcp__claude-in-chrome__navigate (url: "https://x.com/i/bookmarks")
```

Wait 3-5 seconds for bookmarks to load.

- Take initial snapshot with `read_page`
- Scroll down and capture bookmarked posts
- Stop when posts are older than 24 hours (check timestamps)
- Typically 1-3 scrolls is enough

**Capture for each bookmarked post (same fields as feed scan):**
- Author and handle
- Post content (first ~200 chars)
- Engagement: replies, retweets, likes, views
- Quoted/linked content if relevant
- Timestamp

**Why bookmarks matter:** These are posts the user intentionally saved — they signal high personal relevance regardless of engagement metrics. Treat them as high-priority inputs for topic synthesis.

### 4. FILTER & RANK

Filter posts (from both feed AND bookmarks) by relevance:

**Include:**
- AI/ML agents, tools, models, research
- Founder-led sales, GTM, distribution strategies
- SaaS growth, B2B building
- Crypto/DeFi/Web3 developments
- Startup building, fundraising, YC
- High engagement (>100 likes OR >10K views)

**Exclude:**
- Pure politics (unless tech-relevant)
- Celebrity/entertainment
- Sports
- Low-signal promotional content

**Rank by:**
1. Relevance to user's interests (AI OS, founder sales, distribution)
2. Engagement signals
3. Recency (prefer <24h)
4. Potential for unique angle from user's experience

### 5. SYNTHESIZE TOPICS

Identify 5 top topics from scan. For each:

```
## [Topic Number]. [Topic Title]

**Engagement:** [X likes, Y views on key posts]

**What's happening:**
- [Bullet 1: Core development/news]
- [Bullet 2: Supporting data point]
- [Bullet 3: Key voices/accounts discussing]

**Angle for user:** [Suggested post angle matching his voice — based on user's background and expertise from Core Memory]
```

### 6. GENERATE POST IDEAS

After synthesizing topics, **always generate 2 ready-to-post drafts** based on the best topics.

**Before writing, study user's Twitter voice:**
- Navigate to your Twitter profile and read 2-3 recent tweets
- Or read `Vault/2 - Projects/Personal/Content/Twitter/Ton of voice - Twitter.md` if populated

**Voice patterns to match:**
- Short, punchy, direct
- First-person, conversational
- Hot takes backed by real experience
- No threads unless topic demands depth
- References real work (AI OS, client deployments, shipping)
- Contrarian when genuine, not for engagement bait
- No hashtags, no "1/" thread openers unless necessary

**For each post idea:**
```
### Post Idea [N]: "[Hook line]"

**Based on:** Topic #X
**Best for:** [Day/timing recommendation]

> [Full draft text, ready to copy-paste into Twitter]
```

**Selection criteria for the 2 posts:**
1. Pick the freshest topic (< 24h) for immediate posting
2. Pick the most contrarian/unique angle for scheduled posting
3. At least one should subtly reference the user's work (from Core Memory)
4. Prefer topics where the user has genuine first-hand experience to share

### 7. OUTPUT

Display topics + post ideas in structured format to user.

**Save** to `Vault/2 - Projects/Personal/Content/Daily research/Twitter/{DATE}-twitter-browse.md`:

```markdown
# Browse: Twitter Feed
**Date:** {DATE} {TIME}
**Source:** Twitter home timeline + bookmarks (last 24h)

---

[Topic entries from Step 4]

---

## Bookmarks (Last 24h)
[List of bookmarked posts with author, content summary, and why it's notable]

## Raw Scan Notes
[Any additional context, threads to revisit, accounts to follow]

---

## Post Ideas

### Post Idea 1: "[Hook]"
**Based on:** Topic #X
**Best for:** [timing]

> [Full draft]

---

### Post Idea 2: "[Hook]"
**Based on:** Topic #X
**Best for:** [timing]

> [Full draft]
```

Where `{DATE}` = `YYYY-MM-DD` format.

### 8. LOG

Append summary to today's todo file if it exists:
- Add under a "Content Research" section
- Note number of posts scanned and topics identified

## Quality Gates

Before presenting topics:

1. **Relevance check**: All 5 topics fit user's focus areas
2. **Freshness check**: Topics are current (<48h)
3. **Engagement check**: Each topic has signal (not just random posts)
4. **Angle check**: Each topic has a non-obvious angle for user's voice
5. **Diversity check**: Topics span different themes (not all AI or all crypto)

## Tips for Better Scans

- Check "Following" tab for curated feed
- Check custom lists if available
- Note "Pinned by people you follow" section
- Check trending sidebar for broader context
- Look for threads, not just single tweets

## Error Handling

**If Twitter not logged in:**
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
