# Google Calendar Integration

> List events, create meetings, find free slots, and manage schedule.

## Trigger

```
/calendar [action] [args]
```

Examples:
- `/calendar today` — show today's events
- `/calendar create "Call with Alex" tomorrow 10am`
- `/calendar free tomorrow` — find available slots

## Execution (Wrapper)

Use the MCP wrapper to load only the needed server:

```bash
"Dev/Ops/mcp/run-mcp.sh" calendar "[task description]"
```

Example for `/calendar today`:
```bash
"Dev/Ops/mcp/run-mcp.sh" calendar "List today's calendar events using GOOGLECALENDAR_EVENTS_LIST"
```

## MCP Server

`composio-calendar` — HTTP transport via Composio (loaded in ~/atlas-mcp)

## Critical Tools (Always Available)

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `GOOGLECALENDAR_EVENTS_LIST` | List events in time range | `time_min`, `time_max`, `calendar_id` |
| `GOOGLECALENDAR_CREATE_EVENT` | Create new event | `summary`, `start`, `end`, `attendees` |
| `GOOGLECALENDAR_FIND_EVENT` | Search events by query | `query`, `time_min`, `time_max` |
| `GOOGLECALENDAR_UPDATE_EVENT` | Modify existing event | `event_id`, `summary`, `start`, `end` |
| `GOOGLECALENDAR_DELETE_EVENT` | Remove event | `event_id` |
| `GOOGLECALENDAR_FIND_FREE_SLOTS` | Find available time | `time_min`, `time_max`, `duration` |
| `GOOGLECALENDAR_LIST_CALENDARS` | List all calendars | — |

## Common Workflows

### Check Today's Schedule

```
GOOGLECALENDAR_EVENTS_LIST(
  time_min="2026-01-16T00:00:00+07:00",  # today start (BKK timezone)
  time_max="2026-01-16T23:59:59+07:00",  # today end
  max_results=50
)
```
Format results as timeline.

### Schedule a Meeting

```
1. GOOGLECALENDAR_FIND_FREE_SLOTS to find available time
2. GOOGLECALENDAR_CREATE_EVENT with summary, start, end, attendees
```

### Reschedule Event

```
1. GOOGLECALENDAR_FIND_EVENT to locate event
2. GOOGLECALENDAR_UPDATE_EVENT with new time
```

### Check Week Ahead

```
1. GOOGLECALENDAR_EVENTS_LIST with 7-day range
2. Group by day for overview
```

## Time Formats

- Use ISO 8601: `2026-01-15T10:00:00+07:00`
- Include timezone (user is in BKK timezone)
- Duration in minutes for free slot search

## Attendees Format

```json
[
  {"email": "user@example.org"},
  {"email": "contact@example.org"}
]
```

## Notes

- Default calendar is `primary`
- All-day events have date (not dateTime)
- Recurring events return first instance
- Free slots account for existing events

## Output: Save to Inbox

**Always finish by saving fetched events to Inbox.**

Save to: `Vault/1 - Inbox (Last 7 days)/Calendar/{date}.md`

Format:
```markdown
# Calendar — {date}

> Fetched: {date}

## Events

| Time | Event | Attendees | Link |
|------|-------|-----------|------|
| {start} - {end} | {title} | {attendees} | [Meet]({link}) |

## Summary

- {count} events today
- {key observations}
```

This ensures calendar data is persisted for briefs and future reference.

## Error Handling

| Issue | Action |
|-------|--------|
| Event not found | Search with broader query |
| Time conflict | Find alternative slot |
| Invalid time format | Convert to ISO 8601 |
| Auth expired | Re-authenticate via Composio |
