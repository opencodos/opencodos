---
name: deep-plan
description: Deep planning with confidence calibration. Use when building complex features that need certainty before implementation.
---

# Deep Planning with Confidence Calibration

> Never start implementation until confidence is 9+/10 on ALL components. Uncertainty compounds.

## Trigger

```
/deep-plan [feature or project]
```

Examples:
- `/deep-plan implement daemon architecture from reference-project`
- `/deep-plan add real-time collaboration to Atlas`
- `/deep-plan migrate ingestion pipeline to new schema`

---

## Core Principle

**Uncertainty compounds.** One unknown can invalidate the whole plan. This skill forces you to systematically eliminate uncertainty through research and evidence gathering until every component has 9+/10 confidence with exact implementation details.

---

## Execution Flow

```
Compare → Identify → Rate → Research → Re-rate → Drill → Implement
```

---

### Step 1: Compare Reference Implementations

Find a similar system to learn from. Configure a reference codebase path as needed.

**Actions:**
1. Launch parallel Explore agents to scan both codebases
2. Create comparison table of relevant components

**Output:**

| Aspect | Our System (Atlas) | Reference | Gap |
|--------|-------------------|-------------------|-----|
| Architecture | ... | ... | ... |
| Key files | ... | ... | ... |
| Patterns used | ... | ... | ... |

---

### Step 2: Identify What to Adopt

From the comparison, list features/patterns to adopt.

**For each feature, categorize:**

| Feature | Value | Effort | Priority |
|---------|-------|--------|----------|
| Feature A | High | Low | P0 - Do first |
| Feature B | High | High | P1 - Worth it |
| Feature C | Low | Low | P2 - Maybe |
| Feature D | Low | High | Skip |

Ask user to confirm which features to include in scope.

---

### Step 3: Rate Confidence (1-10)

For each component in the plan, rate your current confidence:

| Component | Confidence | Evidence | Gaps |
|-----------|------------|----------|------|
| Component A | 7/10 | Saw similar in X | Don't know how auth works |
| Component B | 4/10 | Conceptual understanding | Haven't read actual code |
| Component C | 9/10 | Read implementation in detail | None |

**Confidence scale:**
- **1-3:** No idea how to implement
- **4-6:** Conceptual understanding, haven't read code
- **7-8:** Read related code, some unknowns remain
- **9-10:** Know exact file, line, and code change needed

---

### Step 4: State What Increases Confidence

For every component rated <9, explicitly state what would increase confidence:

| Component | Current | What Would Increase |
|-----------|---------|---------------------|
| Auth flow | 6/10 | Read `auth.py:50-120`, understand token refresh |
| DB schema | 5/10 | Check if migration exists, see field types |
| API routes | 7/10 | Find where routes are registered |

---

### Step 5: Research to Increase Confidence

**Do the actual research.** Don't just describe what you'd read—read it.

- Use parallel Explore agents for large searches
- Read actual files, not just descriptions
- Note exact line numbers and function names
- Test assumptions by tracing code paths

**For each gap:**
1. Read the specific file/lines identified
2. Extract concrete evidence (function signatures, patterns)
3. Document what you learned

---

### Step 6: Re-rate with Evidence

Update confidence ratings with evidence:

| Component | Before | After | Evidence |
|-----------|--------|-------|----------|
| Auth flow | 6/10 | 9/10 | `auth.py:87` uses JWT, refresh at `:142` |
| DB schema | 5/10 | 9/10 | Migration in `001_init.sql`, matches expected |
| API routes | 7/10 | 10/10 | Registered in `server.py:45-89` via FastAPI |

---

### Step 7: Drill Remaining Uncertainty

For any component still <9:

1. **Present options** with trade-offs
2. **Make a recommendation**
3. **Justify** with evidence or reasoning
4. **Ask user** to decide if needed

Example:
```
Component: Real-time sync approach

Options:
A) WebSockets - Low latency, more complex
B) Polling - Simple, higher latency
C) SSE - Middle ground, one-way only

Recommendation: B (Polling)
Reason: Sync frequency is 5min, latency not critical. Simpler = fewer bugs.

Proceed with B?
```

---

### Step 8: Final Plan (End State)

**Only reach this step when ALL components are 9+/10.**

Output the final plan in this format:

```markdown
## Implementation Plan: [Feature Name]

### Components

| Component | Confidence | Evidence | Exact Change |
|-----------|------------|----------|--------------|
| Feature X | 9/10 | `file.py:142` has Y | Add Z after line 150 |
| Feature Y | 10/10 | `routes.py:45` registers | New route at line 90 |

### Implementation Order

1. **[Component A]** - Foundation, no dependencies
   - File: `path/to/file.py`
   - Change: Add function X at line Y
   - Code:
   ```python
   def new_function():
       pass
   ```

2. **[Component B]** - Depends on A
   - File: `path/to/other.py`
   - Change: Import and use A
   ...

### Risks
| Risk | Mitigation |
|------|------------|
| ... | ... |

### Success Criteria
- [ ] Criterion 1
- [ ] Criterion 2
```

---

## Output Format (Summary Table)

The core deliverable is this table for each component:

| Component | Confidence | Evidence | Exact Change |
|-----------|------------|----------|--------------|
| Feature X | 9/10 | `file.py:142` has Y | Add Z after line 150 |
| Feature Y | 10/10 | Found pattern in `:89` | Replicate at new location |

---

## When to Use This vs `/plan`

| Scenario | Use |
|----------|-----|
| Simple feature, clear path | `/plan` |
| Complex feature, multiple unknowns | `/deep-plan` |
| Adopting patterns from another codebase | `/deep-plan` |
| Refactoring with many touchpoints | `/deep-plan` |
| Mission-critical, can't afford mistakes | `/deep-plan` |

---

## Example Session

```
User: /deep-plan implement agent daemon from reference-project

Atlas: Starting deep planning with confidence calibration.

[Step 1: Comparing codebases...]
Launching explore agents for Atlas and reference daemon patterns.

| Aspect | Atlas | Reference | Gap |
|--------|-------|-----------|-----|
| Daemon | None | `daemon/main.py` | Need to build |
| Scheduler | Manual cron | APScheduler | Need to adopt |
| ...

[Step 2: Features to adopt]
| Feature | Value | Effort | Priority |
|---------|-------|--------|----------|
| APScheduler daemon | High | Medium | P0 |
| Agent subprocess | High | Medium | P0 |
| Health checks | Medium | Low | P1 |

Confirm scope?

User: Yes, proceed with P0 + P1

[Step 3-6: Confidence calibration...]

| Component | Confidence | Evidence | Gap → Research → New Evidence |
|-----------|------------|----------|-------------------------------|
| APScheduler | 4/10 → 9/10 | Read reference `scheduler.py:1-150`, uses AsyncIOScheduler |
| Subprocess | 5/10 → 9/10 | `service_manager.py:89` shows subprocess.Popen pattern |
| Health | 7/10 → 10/10 | Simple HTTP endpoint at `health.py:12` |

[Step 8: Final plan with exact changes...]

Ready to implement?
```

---

## Anti-patterns

- Starting implementation at 6/10 confidence ("I'll figure it out")
- Rating confidence without reading actual code
- Skipping research because "it's probably the same"
- Accepting 8/10 because "close enough"

---

## Dependencies

- Explore agents for parallel codebase scanning
- Read tool for file inspection
- Reference codebase (configure path as needed)

---

*Last updated: 2026-01-27*
