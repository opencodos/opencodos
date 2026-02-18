---
name: profile
description: Load context about a person from CRM. Use when asking who someone is or needing background on a contact.
---

# Profile Skill

> Quickly load context about a person mid-conversation

## Trigger
`/profile {name}` or "who is {name}" or "tell me about {name}"

## What It Does
1. Fuzzy-matches the name against `contacts.yaml`
2. Loads and displays the person's profile from `Vault/4 - CRM/Profiles/{name}.md`
3. Falls back to basic contact info if no profile exists

## Execution Steps

### 1. Parse Name
Extract the person's name from the command:
- `/profile Marcus` -> "Marcus"
- `/profile Alex Chen` -> "Alex Chen"
- `who is John Smith` -> "John Smith"

### 2. Fuzzy Match
Load `Vault/4 - CRM/contacts.yaml` and find best match:

```typescript
// Matching logic:
// - Exact match: 100%
// - One name contains other: 90% (e.g., "Marcus" matches "Alex Chen")
// - First name match: 85%
// - Levenshtein similarity: calculated
```

### 3. Load Profile

**If profile file exists** (`Vault/4 - CRM/Profiles/{name}.md`):
- Read full profile
- Display formatted summary

**If no profile but contact exists**:
- Show basic info from contacts.yaml
- Offer to create profile

**If no match found**:
- Report "No contact found for {name}"
- Suggest similar names if any

### 4. Output Format

```
{name}
Company: {company} | Relationship: {level} | Last: {date}

Notes:
{bullet points from profile}

Recent interactions:
{from interaction log}

Next step: {if exists}
```

## Example

**Input:** `/profile Alex`

**Output:**
```
Alex Chen
Company: Acme Ventures | Relationship: Warmish | Last: 2026-01-16

Notes:
- Works at Acme Ventures (early-stage fund)
- Interested in AI/developer tools space
- Will be at upcoming conference in February

Recent interactions:
- 2026-01-16: Intro call - casual catch-up, agreed to follow up

Next step: Follow up when conference dates confirmed
```

## File Locations

| Type | Path |
|------|------|
| Contacts index | `Vault/4 - CRM/contacts.yaml` |
| Profile files | `Vault/4 - CRM/Profiles/{name}.md` |

## No Script Required

This skill doesn't need a TypeScript script. Atlas can:
1. Read contacts.yaml
2. Fuzzy match using simple rules
3. Read the profile file
4. Format output

The matching rules are simple enough for Atlas to implement inline.

## Related Skills

- `/memory` - Update profiles with new facts
- `/crm` - Full CRM search and management (planned)
