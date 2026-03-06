---
name: skill-judge
description: Evaluate AI agent skills against rigorous standards. Use when reviewing or improving skill quality.
---

# Skill Judge

> Evaluate skills against an 8-dimensional rubric (120 points total).

## Trigger

`/skill-judge [skill]` or "evaluate this skill" or "review skill quality"

## Core Principle

> **Skill value = Expert knowledge − What Claude already knows**

A skill is a "knowledge externalization mechanism," not a tutorial. Don't waste tokens on information the model already possesses.

## 8 Evaluation Dimensions

### D1: Knowledge Delta (20 pts) — MOST CRITICAL

Does the skill add genuine expert knowledge?

| Red Flags | Green Flags |
|-----------|-------------|
| Explains basic concepts | Decision trees from experience |
| Standard library usage | Trade-offs experts know |
| Generic best practices | Domain-specific frameworks |
| "What is X" explanations | "When to use X vs Y" guidance |

**Score:**
- 18-20: Genuine expert-only knowledge
- 14-17: Mostly new, some redundant
- 10-13: Mixed new and known
- 5-9: Mostly redundant
- 0-4: Tutorial content Claude knows

### D2: Mindset + Procedures (15 pts)

Does it transfer expert thinking patterns?

| Weak | Strong |
|------|--------|
| Generic operations | Domain-specific workflows |
| Step-by-step tutorials | Mental models for decisions |
| "How to do X" | "How to think about X" |

### D3: Anti-Pattern Quality (15 pts)

Quality of "NEVER do this" guidance.

| Weak Anti-Patterns | Strong Anti-Patterns |
|--------------------|----------------------|
| "Avoid errors" | "Never use SELECT * in production because..." |
| "Be careful with X" | "Don't use OFFSET pagination > 10k rows" |
| Vague warnings | Specific examples with reasoning |

### D4: Specification Compliance (15 pts)

**Description must answer THREE questions:**
1. **WHAT** does it do?
2. **WHEN** should it be used?
3. **KEYWORDS** that trigger it?

```
❌ "Helps with databases"
✅ "PostgreSQL query optimization. Use when fixing slow queries or designing schemas."
```

**Poor descriptions make excellent skills invisible.**

### D5: Progressive Disclosure (15 pts)

Proper content layering:

| Layer | Size | Content |
|-------|------|---------|
| Metadata | ~100 tokens | name, description |
| SKILL.md | <500 lines | Core instructions |
| Resources | On-demand | Reference docs, examples |

Skills should embed loading triggers within workflows:
```
"For complex cases, see references/advanced-patterns.md"
```

### D6: Freedom Calibration (15 pts)

Match specificity to task fragility:

| Freedom | When | Example |
|---------|------|---------|
| High | Creative tasks | "Write engaging copy" |
| Medium | Structured tasks | "Follow this template with adaptations" |
| Low | Fragile operations | "Use this exact script" |

### D7: Pattern Recognition (10 pts)

Does skill follow established patterns?

| Pattern | Lines | Use Case |
|---------|-------|----------|
| Mindset | ~50 | Principles, philosophy |
| Navigation | ~30 | Quick reference |
| Philosophy | ~150 | Frameworks, mental models |
| Process | ~200 | Step-by-step workflows |
| Tool | ~300 | Technical implementation |

### D8: Practical Usability (15 pts)

Can agents actually implement the guidance?

- [ ] Clear decision trees
- [ ] Working code examples
- [ ] Error handling covered
- [ ] Edge cases addressed
- [ ] No ambiguous instructions

## Grading Scale

| Grade | Points | Meaning |
|-------|--------|---------|
| A | 108+ (90%+) | Production-ready expert skill |
| B | 96-107 (80-89%) | Good, minor improvements needed |
| C | 84-95 (70-79%) | Adequate, clear improvement path |
| D | 72-83 (60-69%) | Below average, significant issues |
| F | <72 (<60%) | Needs fundamental redesign |

## Knowledge Classification

Before including content, classify it:

| Type | Include? | Example |
|------|----------|---------|
| Expert knowledge | Yes | "Use cursor pagination over OFFSET for >10k rows" |
| Activation knowledge | Brief reminder | "Remember to add indexes on foreign keys" |
| Redundant knowledge | No | "SQL stands for Structured Query Language" |

## Evaluation Checklist

```markdown
## Skill: [Name]

### D1: Knowledge Delta (__/20)
- [ ] Contains expert-only knowledge
- [ ] No tutorial content Claude knows
- [ ] Provides decision frameworks

### D2: Mindset + Procedures (__/15)
- [ ] Transfers thinking patterns
- [ ] Domain-specific workflows
- [ ] Not generic operations

### D3: Anti-Patterns (__/15)
- [ ] Specific examples
- [ ] Non-obvious reasoning
- [ ] Actionable warnings

### D4: Description (__/15)
- [ ] WHAT it does
- [ ] WHEN to use
- [ ] KEYWORDS for trigger

### D5: Progressive Disclosure (__/15)
- [ ] Metadata concise
- [ ] Body <500 lines
- [ ] Resources on-demand

### D6: Freedom Calibration (__/15)
- [ ] Matches task fragility
- [ ] Creative tasks = high freedom
- [ ] Fragile ops = low freedom

### D7: Pattern Recognition (__/10)
- [ ] Follows established pattern
- [ ] Appropriate length

### D8: Practical Usability (__/15)
- [ ] Decision trees clear
- [ ] Code examples work
- [ ] Edge cases covered

### Total: __/120 (Grade: __)
```

## Common Failure Patterns

### "The Tutorial"
Explains what things are instead of providing expert decision frameworks.

```
❌ "PDFs are documents that preserve formatting..."
✅ "Use pypdf for merging, pdfplumber for table extraction"
```

### "The Vague Description"
```
❌ "Helps with marketing"
✅ "Conversion copywriting for landing pages. Use when writing headlines, CTAs, or page structure."
```

### "The Kitchen Sink"
Includes everything instead of expert-only knowledge.

### "The Missing Trigger"
Great content but description doesn't tell agents when to use it.

## Source

Based on softaworks/agent-toolkit skill-judge (8 dimensions, 120 points).
