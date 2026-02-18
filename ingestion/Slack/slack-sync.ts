/**
 * Slack Sync - Fetches last 24h of messages via Pipedream Connect (fallback: Composio)
 *
 * Usage: bun run slack-sync.ts
 *
 * Outputs to:
 *   - Vault/1 - Inbox (Last 7 days)/Slack/Channels/{date} {channel}.md
 *   - Vault/1 - Inbox (Last 7 days)/Slack/DMs/{date} {user}.md
 */

import { existsSync, readFileSync } from "fs";
import { atomicWriteFileSync, ensureDir } from "../lib/fs";
import { join } from "path";
import { parse as parseYaml } from "yaml";
import { getInboxDir, getVaultRoot, loadEnv } from "../lib/paths";
import { isPipedreamReady, pipedreamProxyGet } from "../lib/pipedream";
import { getFormattedDate, getCurrentTime, getTimezoneLabel } from "../lib/date";
import { withRetry } from "../lib/retry";

const OUTPUT_DIR = getInboxDir("Slack");
const CHANNELS_DIR = join(OUTPUT_DIR, "Channels");
const DMS_DIR = join(OUTPUT_DIR, "DMs");
const CONFIG_PATH = join(getVaultRoot(), "3 - Ingestion/Slack/config.yaml");

const ENV = loadEnv();
const COMPOSIO_API_KEY = ENV.COMPOSIO_API_KEY || process.env.COMPOSIO_API_KEY || "";
const COMPOSIO_ENTITY_ID = ENV.COMPOSIO_ENTITY_ID || process.env.COMPOSIO_ENTITY_ID || "";

// Config types
interface SlackSyncConfig {
  sync?: {
    initial_lookback_days?: number;
    schedule_hours?: number;
  };
  conversations?: {
    whitelist?: string[];
    ignored?: string[];
  };
  team_id?: string;
}

// Load config from YAML
function loadConfig(): SlackSyncConfig {
  try {
    if (!existsSync(CONFIG_PATH)) {
      console.log("No config.yaml found, syncing all channels");
      return {};
    }
    const content = readFileSync(CONFIG_PATH, "utf-8");
    return parseYaml(content) || {};
  } catch (error) {
    console.error("Failed to load config.yaml:", error);
    return {};
  }
}

// Get whitelist and ignored channel IDs from config
function getChannelFilters(): { whitelist: Set<string>; ignored: Set<string> } {
  const config = loadConfig();
  const whitelist = new Set(config.conversations?.whitelist || []);
  const ignored = new Set(config.conversations?.ignored || []);
  return { whitelist, ignored };
}

interface SlackMessage {
  channel: string;
  user: string;
  text: string;
  ts?: string;
  timestamp?: string;
}

// Caches for ID -> name resolution
let userCache: Map<string, string> = new Map();
let channelCache: Map<string, string> = new Map();


async function callComposioAPI(action: string, input: Record<string, any>): Promise<any> {
  if (!COMPOSIO_API_KEY) {
    throw new Error("COMPOSIO_API_KEY not set in dev/Ops/.env");
  }
  if (!COMPOSIO_ENTITY_ID) {
    throw new Error("COMPOSIO_ENTITY_ID not set in dev/Ops/.env");
  }

  const url = `https://backend.composio.dev/api/v2/actions/${action}/execute`;

  const data = await withRetry(async () => {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "x-api-key": COMPOSIO_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        entityId: COMPOSIO_ENTITY_ID,
        appName: "slack",
        input,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Composio API error (${response.status}): ${text}`);
    }

    const json = await response.json();
    return json?.data || json;
  }, { maxAttempts: 2, baseDelay: 3000, label: "composio:slack" });

  return data;
}

async function callSlackAPI(endpoint: string, params: Record<string, any>): Promise<any> {
  const data = await pipedreamProxyGet(
    "slack",
    `https://slack.com/api/${endpoint}`,
    { params }
  );
  if (data?.ok === false) {
    throw new Error(`Slack API error: ${data?.error || "unknown"}`);
  }
  return data;
}

async function fetchUsers(): Promise<void> {
  console.log("Fetching user list...");
  if (isPipedreamReady("slack")) {
    try {
      const seenCursors = new Set<string>();
      let cursor: string | undefined;
      while (true) {
        const data = await callSlackAPI("users.list", {
          limit: 200,
          ...(cursor ? { cursor } : {}),
        });
        const users = data?.members || [];
        for (const user of users) {
          const displayName = user.real_name || user.name || user.id;
          userCache.set(user.id, displayName);
        }
        const nextCursor = (data?.response_metadata?.next_cursor || "").trim();
        if (!nextCursor || seenCursors.has(nextCursor)) {
          break;
        }
        seenCursors.add(nextCursor);
        cursor = nextCursor;
      }
      console.log(`Cached ${userCache.size} users (Pipedream)`);
      return;
    } catch (error) {
      console.error("Pipedream Slack users failed, falling back to Composio:", error);
    }
  }

  try {
    const data = await callComposioAPI("SLACK_LIST_ALL_USERS", { limit: 200 });
    const users = data?.members || data?.users || [];
    for (const user of users) {
      const displayName = user.real_name || user.name || user.id;
      userCache.set(user.id, displayName);
    }
    console.log(`Cached ${userCache.size} users (Composio)`);
  } catch (error) {
    console.error("Failed to fetch users:", error);
  }
}

async function fetchChannels(): Promise<void> {
  console.log("Fetching channel list...");
  if (isPipedreamReady("slack")) {
    try {
      const seenCursors = new Set<string>();
      let cursor: string | undefined;
      while (true) {
        const data = await callSlackAPI("conversations.list", {
          types: "public_channel,private_channel",
          limit: 200,
          exclude_archived: true,
          ...(cursor ? { cursor } : {}),
        });
        const channels = data?.channels || [];
        for (const ch of channels) {
          channelCache.set(ch.id, ch.name);
        }
        const nextCursor = (data?.response_metadata?.next_cursor || "").trim();
        if (!nextCursor || seenCursors.has(nextCursor)) {
          break;
        }
        seenCursors.add(nextCursor);
        cursor = nextCursor;
      }
      console.log(`Cached ${channelCache.size} channels (Pipedream)`);
      return;
    } catch (error) {
      console.error("Pipedream Slack channels failed, falling back to Composio:", error);
    }
  }

  try {
    const data = await callComposioAPI("SLACK_LIST_ALL_CHANNELS", {
      types: "public_channel,private_channel",
      limit: 200,
    });
    const channels = data?.channels || [];
    for (const ch of channels) {
      channelCache.set(ch.id, ch.name);
    }
    console.log(`Cached ${channelCache.size} channels (Composio)`);
  } catch (error) {
    console.error("Failed to fetch channels:", error);
  }
}

function resolveUser(userId: string): string {
  return userCache.get(userId) || userId;
}

function resolveChannel(channelId: string): string {
  return channelCache.get(channelId) || channelId;
}

async function fetchChannelHistory(channelId: string): Promise<SlackMessage[]> {
  // Get messages from last 24h
  const oldest = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000).toString();

  if (isPipedreamReady("slack")) {
    try {
      const data = await callSlackAPI("conversations.history", {
        channel: channelId,
        oldest,
        limit: 100,
      });
      const messages = data?.messages || [];
      return messages.map((m: any) => ({ ...m, channel: channelId }));
    } catch (error: any) {
      if (!error.message?.includes("not_in_channel")) {
        console.error(`Pipedream Slack fetch failed ${channelId}:`, error.message?.slice(0, 100));
      }
    }
  }

  try {
    const data = await callComposioAPI("SLACK_FETCH_CONVERSATION_HISTORY", {
      channel: channelId,
      oldest,
      limit: 100,
    });
    const messages = data?.messages || [];
    // Add channel ID to each message
    return messages.map((m: any) => ({ ...m, channel: channelId }));
  } catch (error: any) {
    // Silently skip channels we can't access
    if (!error.message?.includes("not_in_channel")) {
      console.error(`Failed to fetch ${channelId}:`, error.message?.slice(0, 100));
    }
    return [];
  }
}

async function fetchAllRecentMessages(): Promise<SlackMessage[]> {
  console.log("Fetching messages from last 24h...");

  const { whitelist, ignored } = getChannelFilters();
  const hasWhitelist = whitelist.size > 0;

  // Determine which channels to fetch
  let channelsToFetch: string[] = [];

  if (hasWhitelist) {
    // Use whitelist
    channelsToFetch = Array.from(whitelist);
    console.log(`Using whitelist: ${channelsToFetch.length} channels`);
  } else {
    // Fetch from all cached channels (up to 100)
    channelsToFetch = Array.from(channelCache.keys()).slice(0, 100);
    if (channelCache.size > 100) {
      console.warn(`Warning: ${channelCache.size} channels found but no whitelist configured — only syncing first 100. Set conversations.whitelist in config.yaml to control which channels are synced.`);
    }
    console.log(`Fetching from ${channelsToFetch.length} channels`);
  }

  // Filter out ignored
  channelsToFetch = channelsToFetch.filter(
    (ch) => !ignored.has(ch) && !ignored.has(channelCache.get(ch) || "")
  );

  // Fetch in parallel (batches of 5)
  const allMessages: SlackMessage[] = [];
  for (let i = 0; i < channelsToFetch.length; i += 5) {
    const batch = channelsToFetch.slice(i, i + 5);
    const results = await Promise.all(batch.map((ch) => fetchChannelHistory(ch)));
    for (const msgs of results) {
      allMessages.push(...msgs);
    }
  }

  return allMessages;
}

function groupMessagesByChannel(
  messages: SlackMessage[]
): Map<string, SlackMessage[]> {
  const grouped = new Map<string, SlackMessage[]>();
  const { whitelist, ignored } = getChannelFilters();

  const hasWhitelist = whitelist.size > 0;
  console.log(`Channel filter: ${hasWhitelist ? `whitelist (${whitelist.size} channels)` : "all channels"}, ignored: ${ignored.size}`);

  for (const msg of messages) {
    // Resolve channel name
    const channelName = resolveChannel(msg.channel);
    const channelId = msg.channel;

    // If whitelist is set, only include whitelisted channels
    if (hasWhitelist) {
      if (!whitelist.has(channelId) && !whitelist.has(channelName)) {
        continue;
      }
    }

    // Skip ignored channels (check both ID and name)
    if (ignored.has(channelId) || ignored.has(channelName)) {
      continue;
    }

    // Skip empty messages (bot alerts with attachments only)
    if (!msg.text || msg.text.trim() === "") continue;

    // Use resolved name as key
    if (!grouped.has(channelName)) {
      grouped.set(channelName, []);
    }
    grouped.get(channelName)!.push(msg);
  }

  return grouped;
}

function getTimestamp(msg: SlackMessage): string {
  return msg.ts || msg.timestamp || "0";
}

function formatTimestamp(ts: string): string {
  const unixTime = parseFloat(ts);
  const date = new Date(unixTime * 1000);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function escapeMarkdown(text: string): string {
  return text
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ")
    .slice(0, 300);
}

function isDM(channelName: string): boolean {
  // DM channels typically start with 'D' or are user IDs
  return channelName.startsWith("D") || channelName.startsWith("U");
}

function generateMarkdown(
  channelName: string,
  messages: SlackMessage[],
  isDM: boolean
): string {
  const date = getFormattedDate();
  const time = getCurrentTime();

  const prefix = isDM ? "DM with" : "Slack #";
  let md = `# ${prefix}${channelName} — ${date}\n\n`;
  md += `> Fetched: ${date} ${time} ${getTimezoneLabel()}, last 24h\n\n`;
  md += `## Messages\n\n`;

  if (messages.length === 0) {
    md += `No messages in the last 24h.\n\n`;
  } else {
    md += `| Time | Sender | Message |\n`;
    md += `|------|--------|--------|\n`;

    // Sort by timestamp (oldest first)
    const sorted = [...messages].sort(
      (a, b) => parseFloat(getTimestamp(a)) - parseFloat(getTimestamp(b))
    );

    for (const msg of sorted) {
      const time = formatTimestamp(getTimestamp(msg));
      // User might already be resolved name from search, or ID
      const sender = msg.user?.startsWith("U") ? resolveUser(msg.user) : msg.user || "unknown";
      const text = escapeMarkdown(msg.text);

      md += `| ${time} | ${sender} | ${text} |\n`;
    }

    md += `\n`;
  }

  md += `## Summary\n\n`;
  md += `- ${messages.length} messages\n`;

  return md;
}

function saveFile(dir: string, filename: string, content: string): string {
  if (!existsSync(dir)) {
    ensureDir(dir);
  }

  const filePath = join(dir, filename);
  atomicWriteFileSync(filePath, content);
  return filePath;
}

async function main() {
  const date = getFormattedDate();
  console.log(`Slack sync: ${date}`);

  // Fetch users and channels for name resolution
  await fetchUsers();
  await fetchChannels();

  // Fetch messages from channels
  const messages = await fetchAllRecentMessages();
  console.log(`Found ${messages.length} total messages`);

  // Group by channel
  const byChannel = groupMessagesByChannel(messages);
  console.log(`${byChannel.size} channels with content`);

  // Save each channel
  for (const [channelName, channelMessages] of byChannel) {
    const isDirectMessage = isDM(channelName);
    const dir = isDirectMessage ? DMS_DIR : CHANNELS_DIR;
    const markdown = generateMarkdown(channelName, channelMessages, isDirectMessage);
    const filename = `${date} ${channelName}.md`;
    const filePath = saveFile(dir, filename, markdown);
    console.log(`${channelName}: ${channelMessages.length} messages → ${filePath}`);
  }

  console.log("Slack sync complete");
}

main();
