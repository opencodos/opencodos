# Skill Orchestrator

> Route requests to the right skill. When user asks for something, match to a skill below.

## Core Skills

| Trigger | Skill | What It Does |
|---------|-------|--------------|
| `/brief` | Morning Brief | Today's calendar, inbox highlights, priority tasks |
| `/todo` | Daily Todo | Generate today's todo from brief + carryover |
| `/eod` | End of Day | Summarize all calls + messages → action steps per person |
| `/review` | Weekly Review | Weekly reflection with wins, failures, learnings |
| `/compound` | Compound | Extract daily learnings to Core Memory/Learnings.md |
| `/brief-feedback` | Brief Feedback | Process feedback to improve future briefs |
| `/research [topic]` | Research | Deep dive via Gemini Deep Research |
| `/parallel-research [topic]` | Parallel Research | AI-powered deep research via Parallel AI (20+ sources, citations) |
| `/msg [contact] [message]` | Write Message | Quick send via Telegram/Slack/Email |
| `/draft [contact] [topic]` | Draft Message | Polished message with research + iteration |
| `/schedule [contact] [context]` | Schedule Meeting | Find slot, create event, send confirmation |
| `/call-debrief` | Call Debrief | Debrief last call — gather context, propose 2-3 next steps |
| `/granola-summary` | Granola Summary | Summarize call transcripts |
| `/code-review [scope]` | Code Review | Interactive code review with opinionated recommendations |
| `/plan [feature]` | Engineering Plan | Research-backed plan before building |
| `/deep-plan [feature]` | Deep Planning | Confidence-calibrated planning with 9+/10 certainty before implementation |
| `/founder-sales` | Founder Sales | Tactical advice for founder-led sales and first customers |
| `/memory` | Memory Update | Capture person facts from conversation to CRM profiles |
| `/profile [name]` | Profile Lookup | Load context about a person (fuzzy name match) |
| `/call-prep [name]` | Call Prep | Generate meeting prep doc with research + YC questions |
| `/errors` | Error Analysis | Aggregate and analyze Claude Code errors |
| `/skill-creator [name]` | Skill Creator | Create new Atlas skills with proper structure |
| `/pdf [task]` | PDF Processing | Extract text, merge, split, convert tables, OCR |
| `/pptx [task]` | PPTX Processing | Create, edit, analyze PowerPoint presentations |
| `/xlsx [task]` | XLSX Processing | Create, edit Excel spreadsheets with formulas |
| `/docx [task]` | DOCX Processing | Create, edit, analyze Word documents |
| `/react` | React Best Practices | Performance optimization for React/Next.js (57 rules) |
| `/web-design [files]` | Web Design | Review files for UI guideline compliance |
| `/remotion` | Remotion | Create videos programmatically with React |
| `/frontend-design` | Frontend Design | Create distinctive UIs with persistent design memory |
| `/frontend-design:init` | Frontend Design | Initialize project design system, choose direction |
| `/frontend-design:status` | Frontend Design | Display current design system |
| `/frontend-design:audit <path>` | Frontend Design | Audit files against established patterns |
| `/frontend-design:extract` | Frontend Design | Extract patterns from existing code |
| `/mcp-builder` | MCP Builder | Build MCP servers for LLM integrations |
| `/browser` | Agent Browser | Browser automation, scraping, form filling |
| `/copywriting` | Copywriting | Conversion-focused copy for landing pages, ads, emails |
| `/postgres` | Supabase Postgres | PostgreSQL best practices and query optimization |
| `/marketing-psychology` | Marketing Psychology | Psychological frameworks for ethical persuasion |
| `/skill-judge [skill]` | Skill Judge | Evaluate skills against 8-dimension rubric (120 pts) |
| `/pricing` | Pricing Strategy | SaaS pricing, tiers, value metrics, price psychology |
| `/social` | Social Content | Social media content for audience building |
| `/launch` | Launch Strategy | Product launch planning and execution |
| `/launch-marketing` | Launch Marketing | Tactical advice on launch marketing from 26 product leaders (42 insights) |
| `/signup-cro` | Signup Flow CRO | Optimize registration and signup conversion |
| `/brand-story` | Brand Storytelling | Tactical advice on brand storytelling from 30 product leaders |
| `/positioning` | Positioning & Messaging | Positioning & messaging advice from 58 product leaders |
| `/karpathy` | Karpathy Guidelines | Coding principles: think first, simplicity, surgical changes, goal-driven |
| `/twitter [action]` | Twitter Research | Search tweets, read profiles, research people (read-only) |
| `/browse [source]` | Browse | Scan social feeds for trending topics and content ideas |
| `/content-loop [topic]` | Content Loop | Writer + Critic loop for tweets, LinkedIn, Telegram posts |
| `/sales-deck [company]` | Sales Deck | Generate personalized proposal deck from template → PDF |

## Local MCP Tools

These MCP tools run locally and are always available. Use them proactively.

| Tool | When to Use | Skill File |
|------|-------------|------------|
| `qmd_query` | "What did [person] say about [topic]?" | `QMD/SKILL.md` |
| `qmd_search` | Fast keyword search | `QMD/SKILL.md` |
| `qmd_vsearch` | Semantic/conceptual search | `QMD/SKILL.md` |

**QMD Usage:** Before answering questions about past conversations, commitments, or relationships, query QMD first. See `skills/QMD/SKILL.md` for examples.

---

## MCP Integrations

**Native MCP services** (Slack, Notion) are available directly via claude.ai Connectors — no wrapper needed.

**Custom and Pipedream-backed services** run in a subprocess via `run-mcp.sh` to save ~50k tokens of MCP tool schemas.

**How to invoke (non-native only):**
1. Execute: `Dev/Ops/mcp/run-mcp.sh <service> "[task description]"`
2. Optionally read `skills/Composio/<service>.md` for tool hints
3. Return result to user

### Custom MCP (their own servers — NOT Pipedream or Composio)

Do NOT look for skill files in `skills/Composio/`. Just call `run-mcp.sh` directly.

| Trigger | Service | Backend | What It Does |
|---------|---------|---------|--------------|
| `/telegram` | Telegram | Telethon MCP (`ingestion/telegram-mcp/`) | Send messages, search contacts, resolve usernames |
| `/twitter` | Twitter | Custom Python MCP (`Dev/Ops/mcp/bird-mcp/`) | Search tweets, read profiles, research people (read-only) |

Granola (call transcripts) is not an MCP — it syncs via local file system. Use `/granola-summary` skill instead.

### Native MCP services

These use the Official MCP servers via claude.ai Connectors. Tools are available directly — no wrapper needed.

| Trigger | Service | What It Does |
|---------|---------|--------------|
| `/slack` | Slack | Send messages, list channels, fetch history |
| `/notion` | Notion | Search pages, fetch content, create/update pages, manage databases |
| `/linear` | Linear | Create issues, track tasks, manage projects |
| `/gmail` | Gmail | Search, send, draft, read threads |
| `/calendar` | Calendar | List events, create meetings, find free slots |
| `/gdrive` | Google Drive | Search files, download, upload |

## Messaging: /msg vs /draft

| Use Case | Skill |
|----------|-------|
| Quick reply, simple message | `/msg` |
| Follow-up, pitch, thoughtful note | `/draft` |

**Routing by platform:**
- **Telegram:** `run-mcp.sh telegram "Send message to '[chat name]': [message]"`
- **Slack:** Use Official Slack MCP tools directly (e.g., `slack_send_message`)
- **Email:** Use Gmail MCP tools directly (e.g., `gmail_send` with recipient, subject, body)

**Examples:**
- "msg Pat hi" → `/msg`
- "message Alex about partnership" → `/draft`
- "tell Sam I'll call tomorrow" → `/msg`
- "write a thank you note to Chris" → `/draft`

## How to Execute

1. Match user request → skill trigger
2. Read skill file: `skills/[SkillName]/SKILL.md`
3. Follow the steps in that file
4. Output result to appropriate Vault location

## Quick Routing

| User Says | Route To |
|-----------|----------|
| "What's on my plate today?" | `/brief` |
| "Generate my todo" | `/todo` |
| "End of day summary" | `/eod` |
| "Summarize today's calls" | `/eod` |
| "What happened today" | `/eod` |
| "Weekly review" | `/review` |
| "Extract learnings" | `/compound` |
| "What did I learn today" | `/compound` |
| "Compound my day" | `/compound` |
| "The brief was wrong about X" | `/brief-feedback` |
| "Find out about [X]" | `/research [X]` |
| "Deep research on [X]" | `/parallel-research [X]` |
| "Parallel research [X]" | `/parallel-research [X]` |
| "Comprehensive research on [X]" | `/parallel-research [X]` |
| "Research [X] with citations" | `/parallel-research [X]` |
| "Send [person] a message" | `/msg` |
| "Draft a message to [person]" | `/draft` |
| "Write a follow-up to [person]" | `/draft` |
| "Tell [person] [quick thing]" | `/msg` |
| "Schedule a call with [person]" | `/schedule [person]` |
| "Set up meeting with [person]" | `/schedule [person]` |
| "Book time with [person]" | `/schedule [person]` |
| "Build [feature]" | `/plan [feature]` |
| "Let's implement [feature]" | `/plan [feature]` |
| "How should we build [X]?" | `/plan [X]` |
| "Deep plan [feature]" | `/deep-plan [feature]` |
| "Plan with confidence" | `/deep-plan` |
| "Compare with reference and build" | `/deep-plan` |
| "I need certainty before building" | `/deep-plan` |
| "Debrief the last call" | `/call-debrief` |
| "What happened on that call?" | `/call-debrief` |
| "Next steps from my call" | `/call-debrief` |
| "Call debrief" | `/call-debrief` |
| "Summarize my calls" | `/granola-summary` |
| "Remember that [person] [fact]" | `/memory` |
| "Save this to memory" | `/memory` |
| "Who is [person]?" | `/profile [person]` |
| "Tell me about [person]" | `/profile [person]` |
| "What do I know about [person]?" | `/profile [person]` |
| "Prep for my call with [person]" | `/call-prep [person]` |
| "Meeting prep for [person]" | `/call-prep [person]` |
| "Prepare for [person] call" | `/call-prep [person]` |
| "Show me errors" | `/errors` |
| "What errors happened?" | `/errors` |
| "Analyze my errors" | `/errors` |
| "Create a skill for X" | `/skill-creator [X]` |
| "Build a new skill" | `/skill-creator` |
| "How do I make a skill?" | `/skill-creator` |
| "Extract text from this PDF" | `/pdf` |
| "Merge these PDFs" | `/pdf` |
| "Convert PDF to text" | `/pdf` |
| "Get tables from PDF" | `/pdf` |
| "Create a presentation" | `/pptx` |
| "Edit this PowerPoint" | `/pptx` |
| "Make slides for X" | `/pptx` |
| "Create spreadsheet" | `/xlsx` |
| "Edit this Excel file" | `/xlsx` |
| "Build financial model" | `/xlsx` |
| "Create Word document" | `/docx` |
| "Edit this document" | `/docx` |
| "Generate a report" | `/docx` |
| "Optimize this React code" | `/react` |
| "Review for performance" | `/react` |
| "Fix React performance" | `/react` |
| "Review this UI" | `/web-design` |
| "Check design compliance" | `/web-design` |
| "Create video with Remotion" | `/remotion` |
| "Animate this" | `/remotion` |
| "Make a video" | `/remotion` |
| "Design this UI" | `/frontend-design` |
| "Make this look distinctive" | `/frontend-design` |
| "Avoid AI slop design" | `/frontend-design` |
| "Initialize design system" | `/frontend-design:init` |
| "Set up design tokens" | `/frontend-design:init` |
| "Show design system" | `/frontend-design:status` |
| "Audit this component" | `/frontend-design:audit` |
| "Check design compliance" | `/frontend-design:audit` |
| "Extract design patterns" | `/frontend-design:extract` |
| "Build an MCP server" | `/mcp-builder` |
| "Create MCP integration" | `/mcp-builder` |
| "Automate browser" | `/browser` |
| "Scrape this page" | `/browser` |
| "Fill this form" | `/browser` |
| "Write copy for X" | `/copywriting` |
| "Landing page copy" | `/copywriting` |
| "Headline for X" | `/copywriting` |
| "Optimize this query" | `/postgres` |
| "Database best practices" | `/postgres` |
| "Fix slow query" | `/postgres` |
| "Psychology behind X" | `/marketing-psychology` |
| "Persuasion techniques" | `/marketing-psychology` |
| "Pricing psychology" | `/marketing-psychology` |
| "Evaluate this skill" | `/skill-judge` |
| "Review skill quality" | `/skill-judge` |
| "How should I price this" | `/pricing` |
| "Pricing strategy" | `/pricing` |
| "Design pricing tiers" | `/pricing` |
| "Write a LinkedIn post" | `/social` |
| "Create a Twitter thread" | `/social` |
| "Social media content" | `/social` |
| "Plan a launch" | `/launch` |
| "Launch strategy for X" | `/launch` |
| "Product Hunt launch" | `/launch` |
| "Optimize signup flow" | `/signup-cro` |
| "Improve registration" | `/signup-cro` |
| "Signup conversion" | `/signup-cro` |
| "Brand story" | `/brand-story` |
| "Founder story" | `/brand-story` |
| "Origin story" | `/brand-story` |
| "Storytelling advice" | `/brand-story` |
| "Launch marketing advice" | `/launch-marketing` |
| "How to launch on Product Hunt" | `/launch-marketing` |
| "PR strategy for launch" | `/launch-marketing` |
| "Build anticipation for launch" | `/launch-marketing` |
| "Launch campaign advice" | `/launch-marketing` |
| "Position my product" | `/positioning` |
| "Positioning strategy" | `/positioning` |
| "Value proposition" | `/positioning` |
| "Tagline help" | `/positioning` |
| "How to message this" | `/positioning` |
| "What did [person] say about X?" | `qmd_query` |
| "Find mentions of [topic]" | `qmd_query` |
| "Search for [keyword]" | `qmd_search` |
| "Think deeply about X" | `/deep-think` |
| "Strategic question" | `/deep-think` |
| "What should I do about X" | `/deep-think` |
| "Apply Karpathy rules" | `/karpathy` |
| "Review this code" | `/code-review` |
| "Code review" | `/code-review` |
| "Review my changes" | `/code-review` |
| "Review this PR" | `/code-review` |
| "Audit this code" | `/code-review` |
| "Code review principles" | `/karpathy` |
| "Simple code guidelines" | `/karpathy` |
| "Browse Twitter" | `/browse twitter` |
| "What's trending on Twitter" | `/browse twitter` |
| "Content ideas from Twitter" | `/browse twitter` |
| "Scan my feed" | `/browse twitter` |
| "Browse LinkedIn" | `/browse linkedin` |
| "What's trending on LinkedIn" | `/browse linkedin` |
| "Content ideas from LinkedIn" | `/browse linkedin` |
| "Scan LinkedIn feed" | `/browse linkedin` |
| "Search Twitter for X" | `/twitter search` |
| "What is @user tweeting about?" | `/twitter user` |
| "Check this tweet" | `/twitter read` |
| "Research @person on Twitter" | `/twitter user` |
| "Twitter mentions of X" | `/twitter mentions` |
| "Search Notion for X" | `/notion` |
| "Get my Notion pages" | `/notion` |
| "Write a tweet about X" | `/content-loop` |
| "Generate a post about X" | `/content-loop` |
| "Content loop on X" | `/content-loop` |
| "Write a LinkedIn post" | `/content-loop` |
| "Write a Telegram post" | `/content-loop` |
| "Iterate on this post" | `/content-loop` |
| "Make a deck for X" | `/sales-deck` |
| "Generate proposal for X" | `/sales-deck` |
| "Sales deck for X" | `/sales-deck` |
| "Proposal deck" | `/sales-deck` |
| "Client deck for X" | `/sales-deck` |

## Fallback

If no skill matches → help directly using Core Memory + Vault context.

---

## Future Skills (Not Implemented)

These skills have folders but no SKILL.md yet:

| Trigger | Intended Purpose | Status |
|---------|------------------|--------|
| `/crm` | Full CRM search/management (advanced) | Planned |
| `/archive` | Compress old notes (>7 days) to Archive | Folder exists |
| `/backlink` | Cross-reference notes, add [[wikilinks]] | Folder exists |
| `/init [name]` | Create new project folder structure | Planned |

---

*Last updated: 2026-02-12 — Added /launch-marketing (26 guests, 42 insights from Lenny's Podcast)*
