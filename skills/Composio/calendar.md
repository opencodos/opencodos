# Google Calendar Integration

> List events, create meetings, find free slots, and manage schedule via Google Calendar.

## Trigger

```
/calendar [action] [args]
```

Examples:
- `/calendar today`
- `/calendar create "Call with Alex" tomorrow 10am`
- `/calendar free slots this week`

## Execution

Calendar tools are available directly via the Official Google Calendar MCP (claude.ai Connectors). No wrapper script needed.

**Tool prefix:** `mcp__claude_ai_Google_Calendar__*`

## Available Tools

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `list_events` | List events in a date range | `timeMin`, `timeMax` |
| `create_event` | Create a new event | `summary`, `start`, `end`, `attendees` |
| `update_event` | Update an existing event | `eventId`, fields to update |
| `delete_event` | Delete an event | `eventId` |
| `freebusy` | Check free/busy status | `timeMin`, `timeMax` |
| `search_events` | Search events by text | `query` |
| `list_calendars` | List all calendars | -- |

> **Note:** Exact tool names are placeholders — use `ToolSearch` for "calendar" to discover actual tool names after enabling the connector.

## Common Workflows

### Check Today's Schedule

```
1. list_events with timeMin=today 00:00, timeMax=today 23:59
```

### Schedule a Meeting

```
1. freebusy to check availability for target date
2. create_event with summary, start, end, attendees, and conferenceData (for Google Meet)
```

### Reschedule Event

```
1. search_events or list_events to find the event
2. update_event with eventId and new start/end times
```

## Time Formats

| Format | Example |
|--------|---------|
| RFC3339 | `2026-02-21T10:00:00+01:00` |
| Date only | `2026-02-21` (for all-day or range boundaries) |
| Relative | `today`, `tomorrow`, `monday`, `friday` |

Timezone: **CET / Europe/Madrid** (+01:00, or +02:00 during CEST).

Always include timezone offset in RFC3339 timestamps.

## Output: Save to Inbox

Save fetched events to: `Vault/1 - Inbox (Last 7 days)/Calendar/{date}.md`

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

## Notes

- Default calendar is `primary`
- Tools are auto-discovered from claude.ai Connectors — no setup needed beyond initial OAuth
- Use `ToolSearch` to discover exact tool names if needed

## Error Handling

| Issue | Action |
|-------|--------|
| Event not found | Search with different query or date range |
| Create fails | Check attendee emails and time format |
| Timezone mismatch | Always use RFC3339 with offset |
| Tools not available | Check claude.ai Settings → Connectors → Google Calendar is connected |
