/**
 * Gmail Sync - Fetches last 24h of emails via Pipedream Connect (fallback: Composio)
 *
 * Usage: bun run gmail-sync.ts
 *
 * Outputs to: Vault/1 - Inbox (Last 7 days)/Gmail/{date}.md
 */

import { existsSync } from "fs";
import { atomicWriteFileSync, ensureDir } from "../lib/fs";
import { join } from "path";
import { getInboxDir, loadEnv } from "../lib/paths";
import { isPipedreamReady, pipedreamProxyGet } from "../lib/pipedream";
import { getFormattedDate, getCurrentTime, getTimezoneLabel } from "../lib/date";

const OUTPUT_DIR = getInboxDir("Gmail");

const ENV = loadEnv();
const COMPOSIO_API_KEY = ENV.COMPOSIO_API_KEY || process.env.COMPOSIO_API_KEY || "";
const COMPOSIO_ENTITY_ID = ENV.COMPOSIO_ENTITY_ID || process.env.COMPOSIO_ENTITY_ID || "";

// Skip noise (newsletters, notifications, marketing)
const SKIP_SENDERS = [
  "noreply@",
  "notifications@",
  "marketing@",
  "no-reply@",
  "donotreply@",
  "newsletter@",
];

const SKIP_SUBJECTS = [
  "Your receipt",
  "Order confirmation",
  "Shipping notification",
];

interface Email {
  id: string;
  sender: string;
  subject: string;
  date: string;
  snippet?: string;
  isUnread?: boolean;
}


async function fetchEmailsFromAPI(): Promise<any> {
  if (!COMPOSIO_API_KEY) {
    throw new Error("COMPOSIO_API_KEY not set in dev/Ops/.env");
  }
  if (!COMPOSIO_ENTITY_ID) {
    throw new Error("COMPOSIO_ENTITY_ID not set in dev/Ops/.env");
  }

  const url = "https://backend.composio.dev/api/v2/actions/GMAIL_FETCH_EMAILS/execute";

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "x-api-key": COMPOSIO_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      entityId: COMPOSIO_ENTITY_ID,
      appName: "gmail",
      input: {
        max_results: 50,
        query: "newer_than:1d",
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Composio API error (${response.status}): ${text}`);
  }

  const data = await response.json();
  return data;
}

async function fetchEmailsFromPipedream(): Promise<any[]> {
  const list = await pipedreamProxyGet(
    "gmail",
    "https://gmail.googleapis.com/gmail/v1/users/me/messages",
    {
      params: {
        maxResults: 50,
        q: "newer_than:1d",
      },
    }
  );

  const messageIds = list?.messages || [];
  const messages: any[] = [];

  // Fetch message details in small batches to avoid rate limits
  const batchSize = 5;
  for (let i = 0; i < messageIds.length; i += batchSize) {
    const batch = messageIds.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map((msg: any) =>
        pipedreamProxyGet(
          "gmail",
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}`,
          {
            params: {
              format: "metadata",
              metadataHeaders: ["From", "Subject"],
            },
          }
        )
      )
    );
    messages.push(...batchResults);
  }

  return messages;
}

function getHeaderValue(headers: any[], name: string): string {
  if (!Array.isArray(headers)) return "";
  const header = headers.find(
    (h) => (h.name || "").toLowerCase() === name.toLowerCase()
  );
  return header?.value || "";
}

async function fetchEmails(): Promise<Email[]> {
  console.log("Fetching emails from last 24h...");

  try {
    let response: any;
    let messages: any[] = [];
    let usingPipedream = false;

    if (isPipedreamReady("gmail")) {
      try {
        messages = await fetchEmailsFromPipedream();
        usingPipedream = true;
        console.log("Using Pipedream Gmail proxy");
      } catch (error) {
        console.error("Pipedream Gmail failed, falling back to Composio:", error);
      }
    }

    if (!usingPipedream) {
      response = await fetchEmailsFromAPI();
      // The API returns { data: { messages: [...] } }
      messages = response?.data?.messages || [];
    }

    // Map to our Email interface
    const emails: Email[] = messages.map((msg: any) => ({
      id: msg.messageId || msg.id || "",
      sender:
        getHeaderValue(msg.payload?.headers, "From") ||
        msg.messageText?.match(/From: ([^\n]+)/)?.[1] ||
        msg.sender ||
        "",
      subject:
        getHeaderValue(msg.payload?.headers, "Subject") ||
        msg.messageText?.match(/Subject: ([^\n]+)/)?.[1] ||
        msg.subject ||
        "",
      date:
        msg.date ||
        (msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : ""),
      snippet: msg.snippet || msg.messageText?.slice(0, 200) || "",
      isUnread: msg.labelIds?.includes("UNREAD") || false,
    }));

    return emails;
  } catch (error) {
    console.error("Failed to fetch emails:", error);
    return [];
  }
}

function shouldSkip(email: Email): boolean {
  const sender = (email.sender || "").toLowerCase();
  const subject = (email.subject || "").toLowerCase();

  // Skip by sender patterns
  for (const pattern of SKIP_SENDERS) {
    if (sender.includes(pattern.toLowerCase())) return true;
  }

  // Skip by subject patterns
  for (const pattern of SKIP_SUBJECTS) {
    if (subject.includes(pattern.toLowerCase())) return true;
  }

  return false;
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  try {
    const date = new Date(dateStr);
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${hours}:${minutes}`;
  } catch {
    return dateStr;
  }
}

function escapeMarkdown(text: string): string {
  if (!text) return "";
  return text
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ")
    .slice(0, 200);
}

function extractSenderName(sender: string): string {
  // Extract name from "Name <email@example.com>" format
  const match = sender.match(/^([^<]+)\s*</);
  if (match) return match[1].trim();

  // Extract username from email
  const emailMatch = sender.match(/([^@]+)@/);
  if (emailMatch) return emailMatch[1];

  return sender;
}

function generateMarkdown(emails: Email[]): string {
  const date = getFormattedDate();
  const time = getCurrentTime();

  // Filter out noise
  const filtered = emails.filter((e) => !shouldSkip(e));
  const unreadCount = filtered.filter((e) => e.isUnread).length;

  let md = `# Gmail — ${date}\n\n`;
  md += `> Fetched: ${date} ${time} ${getTimezoneLabel()}, last 24h\n\n`;
  md += `## Emails\n\n`;

  if (filtered.length === 0) {
    md += `No significant emails in the last 24h.\n\n`;
  } else {
    md += `| Time | Sender | Subject |\n`;
    md += `|------|--------|--------|\n`;

    for (const email of filtered) {
      const time = formatDate(email.date);
      const sender = extractSenderName(email.sender);
      const subject = escapeMarkdown(email.subject);
      const unreadMarker = email.isUnread ? "**" : "";

      md += `| ${time} | ${sender} | ${unreadMarker}${subject}${unreadMarker} |\n`;
    }

    md += `\n`;
  }

  md += `## Summary\n\n`;
  md += `- ${filtered.length} emails (${unreadCount} unread)\n`;
  md += `- ${emails.length - filtered.length} filtered out (newsletters, notifications)\n`;

  // Highlight action items
  const actionable = filtered.filter(
    (e) =>
      e.subject?.toLowerCase().includes("action") ||
      e.subject?.toLowerCase().includes("required") ||
      e.subject?.toLowerCase().includes("urgent") ||
      e.subject?.toLowerCase().includes("confirm")
  );

  if (actionable.length > 0) {
    md += `\n### Action Required\n\n`;
    for (const email of actionable) {
      md += `- ${extractSenderName(email.sender)}: ${email.subject}\n`;
    }
  }

  return md;
}

function saveFile(content: string): string {
  if (!existsSync(OUTPUT_DIR)) {
    ensureDir(OUTPUT_DIR);
  }

  const date = getFormattedDate();
  const filePath = join(OUTPUT_DIR, `${date}.md`);
  atomicWriteFileSync(filePath, content);
  return filePath;
}

async function main() {
  const date = getFormattedDate();
  console.log(`Gmail sync: ${date}`);

  try {
    const emails = await fetchEmails();
    console.log(`Found ${emails.length} total emails`);

    const markdown = generateMarkdown(emails);
    const filePath = saveFile(markdown);

    console.log(`Saved to: ${filePath}`);
    console.log("Gmail sync complete");
  } catch (error: any) {
    console.error("Gmail sync failed:", error.message);
    process.exit(1);
  }
}

main();
