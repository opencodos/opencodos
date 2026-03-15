---
name: code-review
description: Interactive code review with opinionated recommendations. Use when reviewing code changes, PRs, or existing code quality.
---

# Code Review

> Review code thoroughly before making changes. For every issue, explain tradeoffs, give an opinionated recommendation, and ask for input before assuming a direction.

## Trigger

```
/code-review [scope]
```

Examples:
- `/code-review` — Review all uncommitted changes
- `/code-review src/auth/` — Review specific directory
- `/code-review --pr 42` — Review a pull request

---

## Engineering Preferences

Use these to guide all recommendations:

- **DRY is important** — flag repetition aggressively
- **Well-tested code is non-negotiable** — rather have too many tests than too few
- **"Engineered enough"** — not under-engineered (fragile, hacky) and not over-engineered (premature abstraction, unnecessary complexity)
- **Err on the side of handling more edge cases**, not fewer; thoughtfulness > speed
- **Bias toward explicit over clever**

---

## Execution Flow

### BEFORE YOU START

Ask the user which mode they want using AskUserQuestion:

**1/ BIG CHANGE** — Work through interactively, one section at a time (Architecture > Code Quality > Tests > Performance) with at most 4 top issues per section.

**2/ SMALL CHANGE** — Work through interactively, ONE question per review section.

---

## Review Sections

### 1. Architecture Review

Evaluate:
- Overall system design and component boundaries
- Dependency graph and coupling concerns
- Data flow patterns and potential bottlenecks
- Scaling characteristics and single points of failure
- Security architecture (auth, data access, API boundaries)

### 2. Code Quality Review

Evaluate:
- Code organization and module structure
- DRY violations — be aggressive here
- Error handling patterns and missing edge cases (call these out explicitly)
- Technical debt hotspots
- Areas that are over-engineered or under-engineered relative to preferences above

### 3. Test Review

Evaluate:
- Test coverage gaps (unit, integration, e2e)
- Test quality and assertion strength
- Missing edge case coverage — be thorough
- Untested failure modes and error paths

### 4. Performance Review

Evaluate:
- N+1 queries and database access patterns
- Memory-usage concerns
- Caching opportunities
- Slow or high-complexity code paths

---

## Issue Presentation Format

For every specific issue (bug, smell, design concern, or risk):

1. **Describe** the problem concretely, with file and line references
2. **Present 2-3 options** (including "do nothing" where reasonable), labeled with LETTERS (A, B, C)
3. **For each option**, specify: implementation effort, risk, impact on other code, and maintenance burden
4. **Give your recommended option and why**, mapped to the engineering preferences above
5. **Ask** whether the user agrees or wants a different direction before proceeding

**Number each issue** (Issue 1, Issue 2, etc.) and label each option with a letter (A, B, C) so there's no confusion.

Make the recommended option always the **first option (A)**.

---

## Interaction Protocol

- After each section, **pause and ask for feedback** before moving on using AskUserQuestion
- Present your opinionated recommendation AND the explanation with pros/cons
- Do not assume priorities on timeline or scale
- When using AskUserQuestion, make sure each option clearly labels the **issue NUMBER** and **option LETTER** so the user doesn't get confused

---

## Step-by-Step Execution

### Step 1: Determine Scope

Read the code to review:
- If no scope given: `git diff` for uncommitted changes + `git diff --staged`
- If directory/file given: read those files
- If `--pr N` given: `gh pr diff N`

### Step 2: Ask Review Mode

Use AskUserQuestion to ask BIG CHANGE vs SMALL CHANGE.

### Step 3: Run Review Sections

For each section (Architecture > Code Quality > Tests > Performance):

1. Analyze the code against that section's criteria
2. Identify top issues (up to 4 for BIG, 1 for SMALL)
3. For each issue, use the Issue Presentation Format above
4. Use AskUserQuestion to get the user's decisions on each issue
5. Pause before moving to next section

### Step 4: Summary

After all sections, output:

```markdown
## Review Summary

| # | Issue | Decision | Action |
|---|-------|----------|--------|
| 1 | [Description] | Option A (recommended) | [What to do] |
| 2 | [Description] | Option B (user chose) | [What to do] |
| ... | ... | ... | ... |

### Next Steps
- [ ] Action item 1
- [ ] Action item 2
```

### Step 5: Execute (if requested)

If the user says "go ahead" or "implement":
1. Make the agreed changes
2. Run tests to verify nothing breaks
3. Update today's todo file

---

## Example Issue Presentation

```
### Issue 1: Duplicated validation logic

`src/api/users.ts:45-62` and `src/api/teams.ts:78-95` contain nearly identical
input validation. This violates DRY and means bug fixes need to happen in two places.

**A) Extract shared validator (Recommended)**
- Effort: Low (30 min)
- Risk: Low — pure refactor, no behavior change
- Impact: Reduces maintenance surface, single source of truth
- Why: Directly addresses DRY preference. Two identical blocks = guaranteed future divergence.

**B) Do nothing**
- Effort: None
- Risk: Medium — validation logic will drift over time
- Impact: Tech debt accumulates
- Why: Only acceptable if this code is being deprecated soon.

**C) Inline validation with shared schema**
- Effort: Medium (1 hr)
- Risk: Low
- Impact: Cleaner than A but more work for similar benefit
- Why: Better if validation rules differ slightly between contexts.

I recommend **A**. Agree, or prefer a different direction?
```

---

*Last updated: 2026-02-12*
