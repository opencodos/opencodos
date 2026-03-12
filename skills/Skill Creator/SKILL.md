---
name: skill-creator
description: Create new Atlas skills with proper structure. Use when building new capabilities, automations, or workflows.
---

# Skill Creator

> Guide for creating effective skills that extend Atlas capabilities.

## Trigger

`/skill-creator [name]` or "create a skill for X"

## What Are Skills?

Skills are modular, self-contained packages that transform Atlas into a specialized agent. Each skill provides:

- **Procedural knowledge** — Step-by-step workflows
- **Tool integrations** — MCP calls, scripts, APIs
- **Domain expertise** — Context and best practices
- **Bundled resources** — Templates, references, assets

## Core Principles

### 1. Concise is Key

**The context window is a public good.** Atlas is already intelligent — don't over-explain. Only add what's necessary.

Bad:
```
You are an AI assistant helping with email.
First, understand that emails have subjects, bodies, and recipients...
```

Good:
```
Send professional emails. Match tone to relationship. Keep under 5 sentences.
```

### 2. Appropriate Degrees of Freedom

Match specificity to task fragility:

| Freedom | When to Use | Example |
|---------|-------------|---------|
| **High** | Creative tasks, exploration | "Draft a thank you note" |
| **Medium** | Structured but flexible | "Create meeting agenda with context + action items" |
| **Low** | Critical workflows, integrations | "Sync calendar: fetch → parse → save to exact path" |

### 3. Progressive Disclosure

Skills load in three levels:
1. **Metadata** (always) — name, description in orchestrator
2. **SKILL.md body** (when triggered) — full instructions
3. **Bundled resources** (as needed) — scripts, templates

## Skill Anatomy

```
skills/
└── {Skill Name}/
    ├── SKILL.md          # Required — main instructions
    ├── scripts/          # Optional — automation code
    ├── references/       # Optional — docs, examples
    └── assets/           # Optional — templates, configs
```

## SKILL.md Template

```markdown
---
name: {kebab-case-name}
description: {One sentence. When to use this skill.}
---

# {Skill Name}

> {One-line purpose statement}

## Trigger
`/{command}` or "{natural language triggers}"

## What It Does
{2-3 bullet points explaining the workflow}

## Execution Steps

### 1. {First Step}
{Clear instructions with code/examples if needed}

### 2. {Second Step}
{...}

## Output Format
{Show expected output structure}

## Example Usage
{Input → Output example}

## Dependencies
{Files, scripts, MCPs this skill requires}

## Notes
{Edge cases, gotchas, related skills}
```

## Creation Process

### Step 1: Define the Problem
- What task does this skill automate?
- What triggers it? (command, pattern, schedule)
- What's the expected output?

### Step 2a: Map the Workflow
- List every step from trigger to completion
- Identify data sources (Vault paths, MCPs, APIs)
- Define output location and format

### Step 2b: Check the skill repository
- Check if any similar skill is available in https://skills.sh/
- Check if there are any other great skills on top-20 that we are missing in our repo (if yes - propose to implement them as well)

### Step 3: Write SKILL.md
Use the template above. Focus on:
- Clear trigger patterns
- Numbered execution steps
- Concrete output format
- Working example

### Step 4: Add to Orchestrator
Update `skills/orchestrator.md`:

```markdown
| `/command` | Skill Name | What It Does |
```

And add routing patterns:
```markdown
| "user says X" | `/command` |
```

### Step 5: Test & Iterate
Run the skill, note failures, refine instructions.

## Example: Creating a "Daily Standup" Skill

**Problem:** Generate standup summary from yesterday's work.

**Workflow:**
1. Read yesterday's todo file
2. Read yesterday's brief
3. Summarize: done, blocked, today's plan
4. Output to clipboard or Slack

**SKILL.md:**
```markdown
---
name: standup
description: Generate daily standup summary from yesterday's work
---

# Daily Standup

> Quick standup summary: done, blocked, today

## Trigger
`/standup` or "generate my standup"

## Execution Steps

### 1. Gather Context
Read these files:
- `Vault/3 - Todos/{yesterday}.md`
- `Vault/0 - Daily Briefs/{yesterday}.md`
- `Vault/3 - Todos/{today}.md`

### 2. Generate Summary
Format:
**Yesterday:** {completed items}
**Blockers:** {anything marked blocked or incomplete}
**Today:** {top 3 priorities}

### 3. Output
Copy to clipboard and display.

## Output Format
```
*Standup — Jan 24*
**Yesterday:** Shipped error logging, reviewed Legion task
**Blockers:** Codos Bot health check failing
**Today:** Finish landing, telegram auto-reply research
```
```

## Checklist

Before shipping a new skill:

- [ ] SKILL.md follows template structure
- [ ] Trigger is clear (`/command` format)
- [ ] Execution steps are numbered and specific
- [ ] Output format is defined
- [ ] Example shows real usage
- [ ] Added to orchestrator.md (trigger table + routing)
- [ ] Tested manually at least once

## Related

- `orchestrator.md` — Skill routing and registry
- Existing skills in `skills/` for reference patterns
