---
name: plan
description: Research-backed engineering plan before building features. Use when planning implementation or asking how to build something.
---

# Engineering Plan

> Build features with research-backed plans and minimal uncertainty before writing code.

## Trigger

```
/plan [feature description]
```

Examples:
- `/plan add voice input to Atlas`
- `/plan build Slack MCP integration`
- `/plan create real-time sync between Obsidian and Linear`

---

## Execution Flow

```
1. Clarify → 2. Research → 3. Get Docs → 4. Ask Questions → 5. Write Plan
```

**Goal:** Reduce uncertainty to 1/10 before writing any code.

---

### Step 1: Clarify Scope

Parse the feature request and identify:

| Dimension | Question |
|-----------|----------|
| **What** | What exactly are we building? |
| **Why** | What problem does this solve? |
| **Where** | What part of the system does this touch? |
| **Constraints** | Time, tech stack, dependencies? |

Output a one-liner summary for confirmation:
```
Building: [What] to solve [Why] using [Tech/Approach]
```

---

### Step 2: Web Research

**Always research before planning.** Use WebSearch to find:

1. **Existing solutions** — How have others solved this?
2. **Best practices** — What's the recommended approach in 2026?
3. **Pitfalls** — What commonly goes wrong?
4. **Libraries/tools** — What's the current best option?

Search queries to run:
```
[feature] best practices 2026
[feature] implementation guide
[tech stack] [feature] example
[feature] common mistakes to avoid
```

**Summarize findings** in a table:

| Source | Key Insight | Relevance |
|--------|-------------|-----------|
| [Link] | [Finding] | High/Med/Low |

---

### Step 3: Get Documentation (Context7 MCP)

For any libraries/frameworks involved, use the **Context7 MCP** to fetch up-to-date docs.

**Two-step process:**

```
1. mcp__context7__resolve-library-id(libraryName: "react")
   → Returns: context7 library ID (e.g., "/facebook/react")

2. mcp__context7__get-library-docs(context7CompatibleLibraryID: "/facebook/react", topic: "hooks")
   → Returns: Up-to-date documentation snippets
```

**Common libraries to look up:**

| Library | Search Term |
|---------|-------------|
| Claude SDK | `anthropic sdk` |
| LangChain | `langchain` |
| Next.js | `nextjs` |
| Bun | `bun` |
| React | `react` |
| Prisma | `prisma` |
| tRPC | `trpc` |

**Example usage in planning:**
```
// Find the library
resolve-library-id(libraryName: "Model Context Protocol")

// Get relevant docs
get-library-docs(
  context7CompatibleLibraryID: "/anthropic/mcp",
  topic: "creating custom tools"
)
```

**Fallback:** If library not in Context7, use WebFetch on official docs.

---

### Step 4: Reduce Uncertainty (Questions)

Ask questions until uncertainty is <10%. Use this framework:

**Uncertainty Categories:**

| Category | Example Questions |
|----------|-------------------|
| **Requirements** | What's the MVP vs nice-to-have? |
| **Technical** | What's the auth mechanism? What DB? |
| **Integration** | How does this connect to existing code? |
| **Edge cases** | What happens when X fails? |
| **Success criteria** | How do we know it's working? |

**Question Protocol:**
1. List all assumptions you're making
2. Rate each assumption's risk (1-10)
3. Ask about anything rated 5+
4. Don't proceed until all high-risk assumptions are clarified

**Output format:**
```markdown
## Assumptions & Clarifications

| Assumption | Risk | Status |
|------------|------|--------|
| Using SQLite for storage | 3 | Confirmed |
| Need OAuth for Slack | 8 | NEED CLARIFICATION |
| Real-time sync required | 6 | Confirmed: yes |
```

---

### Step 5: Write Plan

Output a structured implementation plan:

```markdown
# Engineering Plan: [Feature Name]

## Summary
[One paragraph: what, why, how]

## Research Summary
[Key findings from Step 2]

## Technical Approach
[Architecture decisions, libraries, patterns]

## Implementation Steps

### Phase 1: [Foundation]
- [ ] Step 1.1
- [ ] Step 1.2

### Phase 2: [Core Feature]
- [ ] Step 2.1
- [ ] Step 2.2

### Phase 3: [Polish & Test]
- [ ] Step 3.1
- [ ] Step 3.2

## Files to Create/Modify
| File | Action | Purpose |
|------|--------|---------|
| `path/file.ts` | Create | Main logic |
| `path/other.ts` | Modify | Add integration |

## Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| [What could go wrong] | [How to prevent/handle] |

## Success Criteria
- [ ] Criterion 1
- [ ] Criterion 2

## Open Questions
- [ ] Anything still unclear
```

---

## After Planning

Once plan is approved:
1. Add implementation tasks to today's todo (`Vault/3 - Todos/{today}.md`)
2. Use Claude Code's `EnterPlanMode` to execute with the plan as context
3. Mark `/plan` task as complete

---

## Example Session

```
User: /plan add Slack MCP integration

Atlas: Let me research and plan this.

[Step 2: Web Research]
WebSearch: "Slack MCP integration 2026"
WebSearch: "Model Context Protocol Slack best practices"

[Step 3: Context7 MCP]
resolve-library-id(libraryName: "Model Context Protocol")
  → /anthropic/model-context-protocol
get-library-docs(context7CompatibleLibraryID: "/anthropic/model-context-protocol", topic: "slack integration")
  → [Returns current MCP docs for Slack tools]

Found: MCP has official Slack adapter, composio also has one...

[Step 4: Questions to reduce uncertainty]
1. Use official MCP Slack or Composio wrapper?
2. Which Slack workspace? (Personal or Work?)
3. Scope: Read-only or also send messages?
4. What channels/DMs to monitor?

[User answers]

[Step 5: Plan]
Here's the plan:
[Structured plan output]

Ready to implement?
```

---

*Last updated: 2026-01-15*
