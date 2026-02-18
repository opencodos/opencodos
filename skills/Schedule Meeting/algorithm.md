# Slot Selection Algorithm

## Timezone Mapping

User's timezone is dynamic. Read from `Vault/Core Memory/About me.md`:

```
Current timezone: BKK
```

**Alias → IANA mapping:**

| Alias | IANA Timezone | UTC Offset |
|-------|---------------|------------|
| BKK | Asia/Bangkok | +7 |
| CET | Europe/Paris | +1/+2 |
| Barcelona | Europe/Madrid | +1/+2 |
| EST | America/New_York | -5/-4 |
| PST | America/Los_Angeles | -8/-7 |
| Lisbon | Europe/Lisbon | +0/+1 |
| London | Europe/London | +0/+1 |
| Moscow | Europe/Moscow | +3 |
| Dubai | Asia/Dubai | +4 |
| Singapore | Asia/Singapore | +8 |
| Tokyo | Asia/Tokyo | +9 |

## Preferred Windows

In user's current timezone:
- **Window A:** 12:00 - 13:30 (lunch calls)
- **Window B:** 16:00 - 18:30 (afternoon calls)

## Algorithm Steps

### 1. Collect Constraints

```python
# Input
their_proposed_times = []  # e.g., ["9am EST", "2pm EST"]
their_timezone = "EST"     # from CRM or explicit
target_date = "2026-01-18"
user_tz = "BKK"            # from About me.md
```

### 2. Convert Their Times to User's Timezone

```python
# If they proposed specific times
for time in their_proposed_times:
    converted = convert_tz(time, their_timezone, user_tz)
    if is_in_preferred_window(converted):
        valid_slots.append(converted)
```

### 3. Query Existing Calendar

```python
existing_calls = query_calendar(target_date)
# Returns: [{"start": "16:00", "end": "16:30", "title": "Client call"}]
```

### 4. Score Available Slots

```python
def score_slot(slot, existing_calls):
    """
    Lower score = better slot
    """
    for call in existing_calls:
        # Perfect: immediately after existing call
        if slot.start == call.end:
            return 0

        # Good: immediately before existing call
        if slot.end == call.start:
            return 1

        # OK: same window, small gap
        if same_window(slot, call) and gap < 60min:
            return 2

        # Bad: different window (fragmentation)
        if different_window(slot, call):
            return 5

    # No existing calls - use late preference
    return 3  # baseline for empty day

def same_window(slot, call):
    """Check if both are in same preferred window"""
    slot_window = get_window(slot.start)  # 'A' or 'B'
    call_window = get_window(call.start)
    return slot_window == call_window
```

### 5. Empty Day Logic

If no calls exist on target day:
- Prefer 17:30 start time (preserves deep work morning)
- Second choice: 17:00
- Third choice: 12:30

```python
if len(existing_calls) == 0:
    preferred_order = ["17:30", "17:00", "18:00", "12:30", "12:00", "13:00"]
    for time in preferred_order:
        if is_valid_their_tz(time, their_timezone):
            return time
```

### 6. Validate Their Timezone

Ensure slot is reasonable for them:

```python
def is_valid_their_tz(slot_user_tz, their_tz):
    their_time = convert_tz(slot_user_tz, user_tz, their_tz)
    their_hour = their_time.hour

    # Must be 8am - 10pm their time
    if their_hour < 8:
        return False, "too_early"
    if their_hour >= 22:
        return False, "too_late"
    return True, "ok"
```

### 7. Select Best Slot

```python
def select_best_slot(valid_slots, existing_calls):
    scored = [(slot, score_slot(slot, existing_calls)) for slot in valid_slots]
    scored.sort(key=lambda x: x[1])

    # If top 2 are close in score, offer choice
    if len(scored) >= 2 and scored[1][1] - scored[0][1] <= 1:
        return "choice", [scored[0][0], scored[1][0]]

    return "single", scored[0][0]
```

## Example Scenarios

### Scenario 1: They proposed times

```
Input: "Alex sync - he proposed 9am or 2pm EST"
Target: Tomorrow
User TZ: BKK (UTC+7)

9am EST = 9pm BKK → in Window B (16:00-18:30)? No, too late
2pm EST = 2am BKK → No, outside windows

Result: "Neither proposed time works in your preferred windows.
        9am EST = 9pm BKK (after your window)
        2pm EST = 2am BKK (middle of night)
        Should I suggest alternatives?"
```

### Scenario 2: Empty day, their timezone known

```
Input: "Chris call this week - Lisbon timezone"
Target: Wednesday (no calls)
User TZ: BKK (UTC+7)

17:30 BKK = 10:30 Lisbon → Valid (8am-10pm check passes)

Result: Suggest 17:30 BKK / 10:30 Lisbon
```

### Scenario 3: Bundling with existing call

```
Input: "Max call tomorrow"
Target: Tomorrow
Existing: [16:00-16:30 Client call]
User TZ: BKK

Slots to consider:
- 16:30 BKK (right after client call) → Score 0
- 17:00 BKK → Score 2 (same window, small gap)
- 12:30 BKK → Score 5 (different window)

Result: Suggest 16:30 BKK (bundles with client call)
```

## Travel Detection & Buffers

### Detecting Flights

Look for calendar events containing:
- "flight", "fly", "plane"
- Airline codes (e.g., "TG", "SQ", "LH", "BA")
- Airport codes (e.g., "BKK", "BCN", "SFO")
- "travel", "transit"

### Travel Buffer Rules

```python
TRAVEL_BUFFER = timedelta(hours=2, minutes=30)

def get_blocked_windows(flight_event):
    """
    Block 2.5h before departure and 2.5h after landing
    """
    departure = flight_event.start
    landing = flight_event.end

    blocked = []
    # Can't speak 2.5h before flight
    blocked.append((departure - TRAVEL_BUFFER, departure))
    # Can't speak during flight
    blocked.append((departure, landing))
    # Can't speak 2.5h after landing
    blocked.append((landing, landing + TRAVEL_BUFFER))

    return blocked

def is_slot_blocked_by_travel(slot, flights):
    for flight in flights:
        blocked = get_blocked_windows(flight)
        for block_start, block_end in blocked:
            if slot.start < block_end and slot.end > block_start:
                return True, flight
    return False, None
```

### Timezone Changes

If flight crosses timezones:
1. Detect destination from event (title, location)
2. Map to IANA timezone
3. Confirm with user before using new timezone windows

```python
def detect_timezone_change(flights, target_date):
    for flight in flights:
        if flight.end.date() <= target_date:
            # Flight lands before target date
            dest_tz = parse_destination_tz(flight)
            if dest_tz != current_user_tz:
                return dest_tz
    return None
```

## Two-Slot Selection (Reconnect Mode)

For reconnect mode, **always propose exactly 2 options**:

```python
def select_two_slots(valid_slots, existing_calls):
    """
    Return exactly 2 slots for reconnect proposal.
    Pick best slot + different-window alternative.
    """
    scored = [(slot, score_slot(slot, existing_calls)) for slot in valid_slots]
    scored.sort(key=lambda x: x[1])

    if len(scored) < 2:
        # Not enough slots - need to check more days
        return None, "need_more_days"

    best = scored[0][0]
    best_window = get_window(best)

    # Second slot: prefer different window for flexibility
    for slot, score in scored[1:]:
        if get_window(slot) != best_window:
            return [best, slot]

    # Fallback: just take #2 even if same window
    return [best, scored[1][0]]
```

### Selection Priority for Reconnect

1. **Slot 1:** Best bundling score (lowest points)
2. **Slot 2:** Different window OR different day

This gives the other person flexibility while respecting the user's preferences.

## Quick Reference

| Situation | Best Slot |
|-----------|-----------|
| After existing call | +0 min from call end |
| Before existing call | -30 min from call start |
| Same window, gap | Closest to existing |
| Empty day | 17:30 → 17:00 → 12:30 |
| Travel day | Block flight ± 2.5h |
| Reconnect mode | 2 slots from different windows |
| Nothing works | Suggest alternative day |
