---
name: content-loop
description: Content generation loop — main conversation spawns all 3 agents, Lead coordinates Writer + Critic via SendMessage. All agents on Opus.
---

# Content Loop Skill

One command → autonomous loop. Main conversation creates team, bootstraps context, spawns all 3 agents (Writer, Critic, Lead). Lead coordinates via SendMessage. All team activity is visible in the main conversation.

## Trigger

```
/content-loop [topic or browse reference]
```

**Platform detection:** If topic includes "twitter", "tweet", "linkedin", or "telegram" — auto-select workflow. Otherwise ask.

## Architecture

```
Main conversation (creates team, bootstraps context, spawns all 3 agents)
  Team: "content-loop"
    ├── Writer (team member) — waits for Lead's messages, writes drafts to /tmp/content-loop/
    ├── Critic (team member) — waits for Lead's messages, writes scores to /tmp/content-loop/
    └── Lead (team member) — coordinates Writer + Critic via SendMessage
```

**Main conversation spawns all 3 agents** so all activity is visible to the user. Lead does NOT spawn agents — it only sends messages.

**Lead coordinates via SendMessage.** It messages Writer to write, messages Critic to score, reads files, decides pass/fail, and presents results.

**Writer and Critic never talk to each other.** Lead is the only one who messages them.

## Workflows

- `workflows/twitter.md` — Twitter/X posts
- `workflows/linkedin.md` — LinkedIn posts
- `workflows/telegram.md` — Telegram channel posts (bilingual)

## Workspace

```
/tmp/content-loop/
  source.md        ← Main conversation writes: topic + context + voice
  draft-v{N}.md    ← Writer writes: iteration N
  scores-v{N}.md   ← Critic writes: scores for iteration N
```

## Step 1: Context Bootstrap (main conversation)

Before spawning Lead, main conversation loads context and composes source.md:

**1.1** Read `~/.atlas/paths.json` → extract `vaultPath` → `{VAULT_PATH}`

**1.2** Read `{VAULT_PATH}/Core Memory/About me.md` → identity, background

**1.3** Read voice docs from `{VAULT_PATH}/2 - Projects/Personal/Content/Mastermind/`:
- `Ton of voice - Twitter.md` (for twitter workflow)
- `Ton of voice - LinkedIn.md` (for linkedin workflow)
- `Ton of voice - Telegram.md` (for telegram workflow)
- Any `How I write*.md` files (general style)

**1.4** Optionally read today's brief: `{VAULT_PATH}/0 - Daily Briefs/{today}.md`

**1.5** Read today's browse report (for trend relevance criterion): `{VAULT_PATH}/2 - Projects/Personal/Content/Daily research/Twitter/{today}-twitter-browse.md` — if it exists, include the full report in source.md so the Critic can judge trend relevance.

**1.6** Setup workspace:
```bash
rm -rf /tmp/content-loop && mkdir -p /tmp/content-loop
```

**1.7** Write `/tmp/content-loop/source.md` with:
- Topic / angle from user
- Identity from About me.md
- Voice doc contents (full text)
- Today's browse report (full text, for trend relevance)
- Recent context if relevant

**1.8** Read the workflow file for the target platform: `skills/ContentLoop/workflows/{platform}.md`

## Step 2: Create Team (main conversation)

Main conversation creates the team so all activity is visible:

```
TeamCreate: team_name: "content-loop"
```

## Step 3: Spawn All 3 Agents (main conversation)

Main conversation spawns Writer, Critic, and Lead — all on the same team. Writer and Critic start idle, waiting for messages from Lead.

**3.1 — Spawn Writer:**
```
Task tool:
  name: "writer"
  subagent_type: "general-purpose"
  model: "opus"
  mode: "bypassPermissions"
  team_name: "{TEAM_NAME}"
  prompt: |
    {WRITER_PROMPT}

    You are a member of the "{TEAM_NAME}" team. Lead will send you messages with instructions.
    When you receive a message from Lead, follow the instructions: read the specified files, write your draft to the specified path, then go idle.
    Do NOT do anything until Lead messages you. Just wait.
```

**3.2 — Spawn Critic:**
```
Task tool:
  name: "critic"
  subagent_type: "general-purpose"
  model: "opus"
  mode: "bypassPermissions"
  team_name: "{TEAM_NAME}"
  prompt: |
    {CRITIC_PROMPT}

    You are a member of the "{TEAM_NAME}" team. Lead will send you messages with instructions.
    When you receive a message from Lead, follow the instructions: read the specified files, write your scores to the specified path, then go idle.
    Do NOT do anything until Lead messages you. Just wait.
```

**3.3 — Spawn Lead (last, after Writer and Critic are ready):**
```
Task tool:
  name: "lead"
  subagent_type: "general-purpose"
  model: "opus"
  mode: "bypassPermissions"
  team_name: "{TEAM_NAME}"
  prompt: [Lead Agent Prompt below, with {VAULT_PATH}, {PLATFORM}, {TOPIC_SLUG} injected]
```

Main conversation is now done. Lead runs autonomously via SendMessage. User sees all team activity.

## Lead Agent Prompt

```
You are the Lead of a content generation loop. You are a member of the "{TEAM_NAME}" team. Writer and Critic are already spawned on the same team — you coordinate them via SendMessage. You do NOT spawn agents.

WORKSPACE: /tmp/content-loop/
- source.md is already written (topic + voice + context)
- You write nothing to source.md — it's ready
- Writer writes draft-v{N}.md
- Critic writes scores-v{N}.md

STEP 1 — REQUEST FIRST DRAFT:
Send a message to "writer" via SendMessage:
  "Read /tmp/content-loop/source.md, then write your first draft to /tmp/content-loop/draft-v1.md. Just the post text, nothing else."

STEP 2 — WAIT FOR DRAFT:
Writer will go idle when draft is written. Read /tmp/content-loop/draft-v1.md.
If the file doesn't exist yet, wait 10 seconds and check again. Max 3 checks.

STEP 3 — REQUEST SCORING:
Send a message to "critic" via SendMessage:
  "Read /tmp/content-loop/source.md and /tmp/content-loop/draft-v1.md. Write your scores to /tmp/content-loop/scores-v1.md."

STEP 4 — WAIT FOR SCORES:
Critic will go idle when scores are written. Read /tmp/content-loop/scores-v1.md.
If the file doesn't exist yet, wait 10 seconds and check again. Max 3 checks.

STEP 5 — CHECK PASS/FAIL:
Read the scores file. Extract each criterion's score. Check against thresholds:
  - Hook power: >= 9
  - Voice match: >= 9
  - Signal density: >= 9
  - Contrarian edge: >= 9
  - No cringe: >= 9
  - Trend relevance: >= 9

If ALL pass → go to STEP 7 (ship).
If ANY fail → go to STEP 6 (rewrite).

STEP 6 — REQUEST REWRITE:
Send a message to "writer" via SendMessage with:
- Which criteria failed and why (from the scores file)
- Key fix instructions from the Critic's diagnosis
- The file path for the new draft: /tmp/content-loop/draft-v{N+1}.md

Wait for the new draft (writer goes idle when done). Read the new draft file.
Then send a message to "critic" via SendMessage:
  "Score /tmp/content-loop/draft-v{N+1}.md. Write scores to /tmp/content-loop/scores-v{N+1}.md."

Wait for scores. Go back to STEP 5.
Max 5 iterations total. After 5, ship the best version.

STEP 7 — SHIP:
Read the final draft and scores files. Present the result to the team lead as a message via SendMessage:

## Final Post (v{N})

> [paste the full post text here]

### Scorecard
| Criterion | Score |
|-----------|-------|
| Hook power | X/10 |
| Voice match | X/10 |
| Signal density | X/10 |
| Contrarian edge | X/10 |
| No cringe | X/10 |
| Trend relevance | X/10 |

**Iterations: {N}/5**

STEP 8 — SAVE:
Save the final post to: {VAULT_PATH}/2 - Projects/Personal/Content/Drafts/{PLATFORM}/{DATE}-{TOPIC_SLUG}.md
Create the directory if it doesn't exist.

STEP 9 — CLEANUP:
1. Send shutdown_request to "writer"
2. Send shutdown_request to "critic"
3. Wait a few seconds for acknowledgment

IMPORTANT RULES:
- You do NOT spawn agents. Writer and Critic are already on the team. Just SendMessage to them.
- Writer and Critic NEVER talk to each other. You are the only one who messages them.
- All content lives in files. Messages are short instructions only.
- If an agent doesn't respond after 3 file checks (30 seconds), report the issue and ship what you have.
```

## Rubric — 6 Criteria

| # | Criterion | Threshold |
|---|-----------|-----------|
| 1 | Hook power | 9/10 |
| 2 | Voice match | 9/10 |
| 3 | Signal density | 9/10 |
| 4 | Contrarian edge | 9/10 |
| 5 | No cringe | 9/10 |
| 6 | Trend relevance | 9/10 |

## Input Modes

```
/content-loop "AI agents are overhyped"
/content-loop Topic #3 from today's browse
/content-loop "founder sales" angle: what McKinsey taught me about selling
/content-loop telegram "почему 90% стартапов умирают"
```

---

*v8 — 2026-02-09 — Added trend relevance criterion (#6), browse report in bootstrap, all thresholds 9/10*
