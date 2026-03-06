# Engineering Plan: Morning Brief + Todo Improvements

## Summary

Fix 5 critical issues with the brief/todo system: (1) stop repeating old messages by tracking briefed items + 24h cutoff, (2) carry over yesterday's unchecked todos with human decision point, (3) auto-detect new Telegram groups, (4) fix cron reliability, (5) remove CRM from brief context.

## Research Summary

| Source | Key Insight | Applied |
|--------|-------------|---------|
| [ChatGPT Pulse / Proactive AI](https://ttms.com/chatgpt-pulse-how-proactive-ai-briefings-accelerate-enterprise-digital-transformation/) | Proactive briefings should surface NEW info, not repeat known | Track briefed items |
| [launchd behavior](https://www.launchd.info/) | StartCalendarInterval coalesces missed events on wake | Keep as-is, but fix idempotency race |
| [PKM Best Practices 2025](https://www.glukhov.org/post/2025/07/personal-knowledge-management/) | Quality > quantity, connection-making between concepts | Better filtering, entity correlation |

## Technical Approach

### Architecture Changes

```
Current Flow:
  Files (7-day window) → Claude → Brief → Claude → Todo

Improved Flow:
  Files (24h + not-briefed) → Dedup → Claude → Brief → Save briefed IDs
                                                  ↓
  Yesterday's unchecked → Show to user → Decide → Claude → Todo
```

### Key Components

1. **Brief State Tracker** (`briefed-items.json`) - tracks which messages have been included
2. **Interactive Todo Carryover** - show unchecked items, user decides what to carry
3. **New Group Detector** - surface any new Telegram group conversations
4. **Cron Fix** - ensure idempotency works correctly with both `RunAtLoad` and `StartCalendarInterval`

## Implementation Steps

### Phase 1: Fix Message Repetition (Issue #1)

- [ ] Create `briefed-items.json` state file in `Dev/Ops/atlas/`
- [ ] After generating brief, save content hashes/IDs of included items
- [ ] Modify `gatherContext()` to filter out already-briefed items
- [ ] Add 24h cutoff as primary filter, use briefed-items as secondary
- [ ] Handle edge case: important items that span multiple days

**Files:**
| File | Action | Purpose |
|------|--------|---------|
| `generate-brief.ts` | Modify | Add briefed-items tracking |
| `Dev/Ops/atlas/briefed-items.json` | Create | Store content hashes |

### Phase 2: Fix Todo Carryover (Issue #2)

- [ ] Separate todo generation from brief generation
- [ ] Before generating new todo, show yesterday's unchecked items
- [ ] Use `AskUserQuestion` pattern to let user decide what carries over
- [ ] Transform selected items into specific actions (not just copy)
- [ ] If running automated (cron), default to carrying all unchecked

**Files:**
| File | Action | Purpose |
|------|--------|---------|
| `generate-todo.ts` | Modify | Add interactive carryover |
| `SKILL.md` (Daily Todo) | Modify | Document new behavior |

### Phase 3: New Telegram Group Detection (Issue #3)

- [ ] Modify Telegram sync to detect new group memberships
- [ ] Add `new-groups.json` tracker in `Dev/Ops/atlas/`
- [ ] When new group detected, auto-include in inbox even if not whitelisted
- [ ] Brief generator surfaces "NEW:" prefix for first-time groups
- [ ] After 3 briefs, ask user if group should be whitelisted or ignored

**Files:**
| File | Action | Purpose |
|------|--------|---------|
| `telegram-sync.ts` (wherever this is) | Modify | Track new groups |
| `Dev/Ops/atlas/known-groups.json` | Create | Track group membership |
| `generate-brief.ts` | Modify | Surface new groups prominently |

### Phase 4: Cron Reliability (Issue #4)

- [ ] Fix race condition: `RunAtLoad` creates brief → 8am interval skipped
- [ ] Solution: Move idempotency check to AFTER gathering context (time-based check)
- [ ] Add `sleepwatcher` as backup for wake detection
- [ ] Add retry logic if API call fails

**Files:**
| File | Action | Purpose |
|------|--------|---------|
| `morning-brief.sh` | Modify | Better idempotency logic |
| `com.dkos.morning-brief.plist` | Modify | Consider removing RunAtLoad |

### Phase 5: Remove CRM (Issue #5)

- [ ] Remove CRM loading from `gatherContext()`
- [ ] Delete lines 157 and 194-196 in `generate-brief.ts`
- [ ] CRM only loaded when explicitly requested

**Files:**
| File | Action | Purpose |
|------|--------|---------|
| `generate-brief.ts` | Modify | Remove CRM loading |

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| State file corruption loses briefed-items | Use atomic writes, keep last 7 days of backups |
| Interactive carryover breaks automation | Detect if running in cron (no TTY) and auto-carry |
| New group detection surfaces spam | Add easy "ignore this group" mechanism |
| launchd timing still unreliable | Add `sleepwatcher` as redundant trigger |

## Success Criteria

- [ ] Today's brief contains ONLY items from last 24h that weren't in yesterday's brief
- [ ] Todo generation shows yesterday's unchecked items and asks which to carry
- [ ] New Telegram groups appear in brief with "NEW:" prefix
- [ ] Brief runs reliably at 8am OR on wake, never both
- [ ] CRM no longer appears in brief context

## Open Questions

- [ ] Should briefed-items tracking be per-source or global?
- [ ] How long to retain briefed-items history? (proposed: 14 days)
- [ ] Should cron todo generation auto-carry all items or just high-priority?

---
*Plan created: 2026-01-16*
