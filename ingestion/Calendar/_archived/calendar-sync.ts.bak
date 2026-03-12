/**
 * Calendar Sync - Fetches Google Calendar events for the next 7 days via Pipedream Connect (fallback: Composio)
 *
 * Usage: bun run calendar-sync.ts
 *
 * Outputs to: Vault/1 - Inbox (Last 7 days)/Calendar/{date}.md (one file per day)
 */

import { existsSync } from "fs";
import { atomicWriteFileSync, ensureDir } from "../lib/fs";
import { join } from "path";
import { getInboxDir, loadEnv } from "../lib/paths";
import { isPipedreamReady, pipedreamProxyGet } from "../lib/pipedream";
import { getFormattedDate, getCurrentTime, getTimezoneLabel } from "../lib/date";

const OUTPUT_DIR = getInboxDir("Calendar");
const DAYS_AHEAD = 7;

const ENV = loadEnv();
const COMPOSIO_API_KEY = ENV.COMPOSIO_API_KEY || process.env.COMPOSIO_API_KEY || "";
const COMPOSIO_ENTITY_ID = ENV.COMPOSIO_ENTITY_ID || process.env.COMPOSIO_ENTITY_ID || "";
const USER_EMAIL_FILTERS = (ENV.USER_EMAIL_FILTER || "").split(",").filter(Boolean);

interface CalendarEvent {
  date: string; // YYYY-MM-DD
  start: string; // HH:MM
  end: string; // HH:MM
  summary: string;
  attendees: string[];
  meetLink?: string | null;
}


async function fetchCalendarEventsFromAPI(startDate: string, endDate: string): Promise<any[]> {
  if (!COMPOSIO_API_KEY) {
    throw new Error("COMPOSIO_API_KEY not set in dev/Ops/.env");
  }
  if (!COMPOSIO_ENTITY_ID) {
    throw new Error("COMPOSIO_ENTITY_ID not set in dev/Ops/.env");
  }

  console.log(`Fetching calendar events from ${startDate} to ${endDate}...`);

  const url = "https://backend.composio.dev/api/v2/actions/GOOGLECALENDAR_EVENTS_LIST/execute";

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "x-api-key": COMPOSIO_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      entityId: COMPOSIO_ENTITY_ID,
      appName: "googlecalendar",
      input: {
        calendar_id: "primary",
        time_min: `${startDate}T00:00:00Z`,
        time_max: `${endDate}T23:59:59Z`,
        max_results: 100,
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Composio API error (${response.status}): ${text}`);
  }

  const data = await response.json();
  return data?.data?.items || [];
}

async function fetchCalendarEventsFromPipedream(startDate: string, endDate: string): Promise<any[]> {
  console.log(`Fetching calendar events from ${startDate} to ${endDate} via Pipedream...`);
  const data = await pipedreamProxyGet(
    "googlecalendar",
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    {
      params: {
        timeMin: `${startDate}T00:00:00Z`,
        timeMax: `${endDate}T23:59:59Z`,
        maxResults: 100,
        singleEvents: true,
        orderBy: "startTime",
      },
    }
  );
  return data?.items || [];
}

function extractDateFromISO(isoStr: string): string {
  // Extract YYYY-MM-DD from "2026-01-20T15:30:00+07:00"
  const match = isoStr.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
}

function extractTimeFromISO(isoStr: string): string {
  // Extract HH:MM from "2026-01-20T15:30:00+07:00"
  const match = isoStr.match(/T(\d{2}:\d{2})/);
  return match ? match[1] : "";
}

function parseDateTime(value: any): { date: string; time: string } {
  // Handle object format: { dateTime: "2026-01-20T15:30:00+07:00" }
  let str = value;
  if (typeof value === "object" && value !== null) {
    str = value.dateTime || value.date || "";
  }

  if (!str || typeof str !== "string") {
    return { date: "", time: "" };
  }

  return {
    date: extractDateFromISO(str),
    time: extractTimeFromISO(str) || str,
  };
}

function parseEvents(items: any[]): CalendarEvent[] {
  return items.map((e: any) => {
    const startParsed = parseDateTime(e.start);
    const endParsed = parseDateTime(e.end);

    // Extract attendee emails
    let attendees: string[] = [];
    if (Array.isArray(e.attendees)) {
      attendees = e.attendees
        .map((a: any) => (typeof a === "string" ? a : a.email))
        .filter(Boolean);
    }

    // Extract meet link
    let meetLink = e.hangoutLink || null;
    if (!meetLink && e.conferenceData?.entryPoints) {
      const videoEntry = e.conferenceData.entryPoints.find(
        (ep: any) => ep.entryPointType === "video"
      );
      if (videoEntry) meetLink = videoEntry.uri;
    }

    return {
      date: startParsed.date,
      start: startParsed.time,
      end: endParsed.time,
      summary: e.summary || e.title || "Untitled",
      attendees,
      meetLink,
    };
  });
}

function groupEventsByDate(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const grouped = new Map<string, CalendarEvent[]>();

  for (const event of events) {
    if (!event.date) continue;

    if (!grouped.has(event.date)) {
      grouped.set(event.date, []);
    }
    grouped.get(event.date)!.push(event);
  }

  // Sort events within each day by start time
  for (const [date, dayEvents] of grouped) {
    dayEvents.sort((a, b) => a.start.localeCompare(b.start));
  }

  return grouped;
}

function formatAttendees(attendees: string[]): string {
  if (!attendees || attendees.length === 0) return "-";

  return (
    attendees
      .filter((a) => a && !USER_EMAIL_FILTERS.some(f => a.includes(f)))
      .slice(0, 3)
      .join(", ") || "-"
  );
}

function formatMeetLink(link?: string | null): string {
  if (!link) return "-";

  if (link.includes("meet.google.com")) {
    return `[Meet](${link})`;
  } else if (link.includes("zoom")) {
    return `[Zoom](${link})`;
  }

  return `[Link](${link})`;
}

function generateMarkdown(date: string, events: CalendarEvent[]): string {
  const time = getCurrentTime();

  let md = `# Calendar — ${date}\n\n`;
  md += `> Fetched: ${getFormattedDate()} ${time} ${getTimezoneLabel()}\n\n`;
  md += `## Events\n\n`;

  if (events.length === 0) {
    md += `No events scheduled.\n\n`;
  } else {
    md += `| Time | Event | Attendees | Link |\n`;
    md += `|------|-------|-----------|------|\n`;

    for (const event of events) {
      const timeRange = `${event.start} - ${event.end}`;
      const summary = event.summary || "Untitled";
      const attendees = formatAttendees(event.attendees);
      const link = formatMeetLink(event.meetLink);

      md += `| ${timeRange} | ${summary} | ${attendees} | ${link} |\n`;
    }

    md += `\n`;
  }

  md += `## Summary\n\n`;
  md += `- ${events.length} event${events.length !== 1 ? "s" : ""}\n`;

  if (events.length > 0) {
    md += `- First: ${events[0].summary} at ${events[0].start}\n`;
  }

  return md;
}

function saveToFile(date: string, content: string): string {
  if (!existsSync(OUTPUT_DIR)) {
    ensureDir(OUTPUT_DIR);
  }

  const filePath = join(OUTPUT_DIR, `${date}.md`);
  atomicWriteFileSync(filePath, content);

  return filePath;
}

async function main() {
  const startDate = getFormattedDate(0); // Today
  const endDate = getFormattedDate(DAYS_AHEAD - 1); // 7 days ahead

  console.log(`Calendar sync: ${startDate} to ${endDate}`);

  try {
    let items: any[] = [];
    if (isPipedreamReady("googlecalendar")) {
      try {
        items = await fetchCalendarEventsFromPipedream(startDate, endDate);
      } catch (error) {
        console.error("Pipedream Calendar failed, falling back to Composio:", error);
      }
    }

    if (items.length === 0) {
      // Fallback to Composio REST API
      items = await fetchCalendarEventsFromAPI(startDate, endDate);
    }

    // Parse events
    const events = parseEvents(items);
    console.log(`Found ${events.length} total events`);

    // Group by date
    const eventsByDate = groupEventsByDate(events);

    // Generate files for each of the next 7 days
    for (let i = 0; i < DAYS_AHEAD; i++) {
      const date = getFormattedDate(i);
      const dayEvents = eventsByDate.get(date) || [];

      const markdown = generateMarkdown(date, dayEvents);
      const filePath = saveToFile(date, markdown);

      console.log(`${date}: ${dayEvents.length} events → ${filePath}`);
    }

    console.log("Calendar sync complete");
  } catch (error: any) {
    console.error("Calendar sync failed:", error.message);
    process.exit(1);
  }
}

main();
