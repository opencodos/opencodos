---
name: call-prep
description: Prepare for a call with research, context, and YC qualifying questions. Use before meetings or sales calls.
---

# /call-prep

> Prepare for a call by gathering internal context, external research, and generating a structured prep document.

## Trigger
`/call-prep [name]` or `/call-prep [name] [company]`

## Examples
- `/call-prep Alex`
- `/call-prep "Alex Chen" AcmeCorp`
- `/call-prep investor`

---

## Workflow

### Phase 1: Internal Context
1. **CRM Search** — Look for person in `Vault/4 - CRM/` and `Vault/Core Memory/`
2. **Message History** — Search Telegram/Slack summaries in `Vault/1 - Inbox (Last 7 days)/`
3. **Calendar** — Check past/future meetings with this person
4. **Inbox Notes** — Any related notes or context

### Phase 2: External Research
1. **LinkedIn** — Web search for "[name] LinkedIn"
2. **Twitter/X** — Web search for "[name] Twitter"
3. **Company Website** — Fetch company domain if known
4. **News** — Web search for "[name] [company] news" for recent mentions

### Phase 3: Generate Prep Document

Structure:

```markdown
# [Name] / [Company] Call Prep

## Call Details
- **Time:** [from calendar]
- **Duration:** [from calendar]
- **Contact:** [name, handles]
- **Intro by:** [who connected you]

---

## What We Know

### Company: [Company]
| Fact | Source |
|------|--------|
| ... | ... |

### [Person Name]
| Fact | Source |
|------|--------|
| ... | ... |

---

## Research Gaps
[What couldn't be found, suggested discovery questions]

---

## Recommended Call Agenda

### 1. Discovery (X min)
- Key questions based on context gaps

### 2. Present Value (X min)
- What to demo/pitch based on their needs

### 3. Next Steps (X min)
- Proposed action items

---

## YC Qualifying Questions (MUST ASK)

| # | Question | Notes |
|---|----------|-------|
| 1 | What made you decide to take this call? | |
| 2 | Tell me about the problem. How long have you had it? | |
| 3 | How bad is it? Who else does it affect? | |
| 4 | How do you quantify the cost/impact? | |
| 5 | Why haven't you solved it already? | |
| 6 | What is your budget? | |
| 7 | How do you buy software? Who decides? | |

**Russian versions (if needed):**
| # | Russian |
|---|---------|
| 1 | Что побудило вас согласиться на этот звонок? |
| 2 | Расскажите о проблеме. Как давно она у вас? |
| 3 | Насколько это критично? Кого ещё это затрагивает? |
| 4 | Как вы оцениваете стоимость/влияние этой проблемы? |
| 5 | Почему вы ещё не решили это? |
| 6 | Какой у вас бюджет на решение? |
| 7 | Как у вас принимаются решения о покупке софта? Кто решает? |

---

## Positioning Notes
[Pricing guidance, relationship context, leverage points]

---

## Your Story for This Call
[Tailored background narrative]

---

## Demo Prep Checklist
- [ ] Relevant materials ready
- [ ] Pricing in head
- [ ] Key examples to show
```

### Phase 4: Save & Link
1. **Save** to `Vault/2 - Projects/Meeting Prep/{date}_{name}.md`
2. **Link** in today's todo under the relevant meeting entry

---

## Output Location
`Vault/2 - Projects/Meeting Prep/{YYYY-MM-DD}_{Name-or-Company}.md`

---

## Notes

- **YC 7 Questions are mandatory** — Never skip these. They qualify the lead.
- If call is with Russian speaker, include Russian translations of key questions
- Always include pricing guidance from `Vault/Core Memory/Goals.md`
- Reference past deals for anchoring

---

*Last updated: 2026-01-20*
