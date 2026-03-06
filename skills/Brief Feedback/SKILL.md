---
name: brief-feedback
description: Process feedback on morning briefs and update quality rules. Use when the brief was wrong or needs improvement.
---

# Brief Feedback Skill

> Process feedback on morning briefs and update quality rules.

## Trigger

`/brief-feedback` followed by your feedback

## What It Does

1. Takes your natural language feedback about the brief
2. Extracts actionable rules from the feedback
3. Appends new rules to `Vault/Core Memory/Brief Feedback.md`
4. Next brief will incorporate these rules

## Example Usage

```
/brief-feedback The Alexei suggestion was bad - you shouldn't propose partnerships without checking their GitHub first. Also stop suggesting random apartment stuff as quick wins.
```

Atlas will:
1. Extract rules: "Check GitHub before suggesting partnerships", "Quick wins must relate to 2026 goals"
2. Add to Brief Feedback.md under appropriate sections
3. Confirm what was added

## Execution Steps

When user invokes `/brief-feedback [feedback]`:

1. Read current `Vault/Core Memory/Brief Feedback.md`
2. Analyze the user's feedback to extract:
   - New "Don't Do" rules
   - New "Do More" rules
   - New "Bad → Good" examples
   - New context that matters
3. Append extracted rules to appropriate sections
4. Update the "Last updated" date
5. Confirm changes to user

## Rule Extraction Guidelines

From feedback, extract:

| Feedback Pattern | Rule Type |
|-----------------|-----------|
| "Don't suggest X" / "Stop doing Y" | Don't Do |
| "You should X first" / "Always Y before Z" | Do More |
| "X was bad, should have been Y" | Bad → Good Example |
| "I care about X" / "X is important" | Context That Matters |
| "X is higher priority than Y" | High-Priority Situations |

## Output Format

After processing feedback:

```
✅ Added to Brief Feedback:

**Don't Do:**
- [new rule]

**Bad → Good:**
| [bad pattern] | [good pattern] |

Updated: Vault/Core Memory/Brief Feedback.md
```
