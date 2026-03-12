/**
 * Notion Sync - Fetches all user-accessible pages via Pipedream Connect (fallback: Notion MCP)
 *
 * Usage: bun run notion-sync.ts
 *
 * Uses Pipedream Connect proxy for Notion API calls when configured (fallback: @notionhq/notion-mcp-server).
 * Fetches all pages the user shared with the integration, then syncs to Obsidian Vault.
 *
 * Outputs to: Vault/1 - Inbox (Last 7 days)/Notion/
 */

import { existsSync, readFileSync } from "fs";
import { atomicWriteFileSync, ensureDir } from "../lib/fs";
import { join } from "path";
import { execSync } from "child_process";
import { getInboxDir, loadEnv, loadPaths } from "../lib/paths";
import { isPipedreamReady, pipedreamProxyGet, pipedreamProxyPost } from "../lib/pipedream";
import { getFormattedDate, getCurrentTime } from "../lib/date";

// Load environment from dev/Ops/.env
const ENV = loadEnv();
const NOTION_API_KEY = ENV.NOTION_API_KEY || process.env.NOTION_API_KEY || "";

if (!isPipedreamReady("notion") && !NOTION_API_KEY) {
  console.error("Error: NOTION_API_KEY not set in dev/Ops/.env (Pipedream account not configured)");
  console.error("To set up Notion:");
  console.error("1. Connect Notion via Pipedream in the dashboard, or");
  console.error("2. Go to notion.so/my-integrations");
  console.error("3. Create an internal integration");
  console.error("4. Copy the token and save it via the Setup Wizard");
  process.exit(1);
}

const OUTPUT_BASE = getInboxDir("Notion");
const STATE_FILE = join(OUTPUT_BASE, ".notion-sync-state.json");
const NOTION_VERSION = "2022-06-28";

// Load CODOS_PATH
const { codosPath: CODOS_PATH } = loadPaths();

// Path to run-mcp.sh
const RUN_MCP_PATH = join(CODOS_PATH, "dev/Ops/mcp/run-mcp.sh");

interface NotionPage {
  id: string;
  title: string;
  url?: string;
  lastEditedTime?: string;
  properties?: Record<string, any>;
  content?: string;
}

interface SyncState {
  lastSyncTime: string | null;
  syncedPageIds: string[];
}

function loadSyncState(): SyncState {
  if (existsSync(STATE_FILE)) {
    try {
      return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
    } catch {
      // Corrupted state file, start fresh
    }
  }
  return { lastSyncTime: null, syncedPageIds: [] };
}

function saveSyncState(state: SyncState): void {
  ensureDir(OUTPUT_BASE);
  atomicWriteFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

interface NotionBlock {
  id: string;
  type: string;
  has_children: boolean;
  [key: string]: any;
}


function safeFilename(name: string): string {
  if (!name) return "untitled";
  return name
    .replace(/[^a-zA-Z0-9\s\-_]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 60);
}

/**
 * Execute run-mcp.sh with a prompt and parse the JSON response
 */
function callMCP(prompt: string): any {
  console.log(`  Calling MCP: ${prompt.slice(0, 80)}...`);

  try {
    const output = execSync(`"${RUN_MCP_PATH}" notion "${prompt}"`, {
      encoding: "utf-8",
      timeout: 300000, // 5 minute timeout
      env: {
        ...process.env,
        NOTION_API_KEY: NOTION_API_KEY,
      },
    });

    // Parse JSON from output - look for JSON object/array in the response
    const jsonMatch = output.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1]);
      } catch {
        // Not valid JSON, return raw output
        return { raw: output };
      }
    }

    return { raw: output };
  } catch (error: any) {
    console.error("MCP call failed:", error.message);
    return { error: error.message };
  }
}

async function callNotionSearch(pageSize: number): Promise<any> {
  return pipedreamProxyPost("notion", "https://api.notion.com/v1/search", {
    headers: {
      "Notion-Version": NOTION_VERSION,
    },
    body: {
      page_size: pageSize,
      sort: { direction: "descending", timestamp: "last_edited_time" },
    },
  });
}

async function callNotionBlocks(blockId: string, startCursor?: string): Promise<any> {
  return pipedreamProxyGet("notion", `https://api.notion.com/v1/blocks/${blockId}/children`, {
    headers: {
      "Notion-Version": NOTION_VERSION,
    },
    params: {
      page_size: 100,
      start_cursor: startCursor,
    },
  });
}

/**
 * First-time sync: Fetch pages with full content using the comprehensive prompt
 */
async function firstTimeSync(pageSize: number = 20): Promise<NotionPage[]> {
  console.log(`First-time sync: fetching up to ${pageSize} pages with full content...`);

  if (isPipedreamReady("notion")) {
    try {
      const result = await callNotionSearch(pageSize);
      return parsePageResults(result);
    } catch (error) {
      console.error("Pipedream Notion search failed, falling back to MCP:", error);
    }
  }

  const prompt = `Use API-post-search, sort by last_edited_time descending, page_size ${pageSize}. For each page: 1) fetch page properties using API-get-page, 2) fetch blocks. Return JSON array with objects containing: id, title, last_edited_time, url, properties (all page properties), content (full text from blocks). No explanation, just the JSON array.`;

  const result = callMCP(prompt);

  if (result.error) {
    console.error("Failed first-time sync:", result.error);
    return [];
  }

  return parsePageResults(result);
}

/**
 * Incremental sync: Fetch only recently edited pages
 */
async function incrementalSync(lastSyncTime: string, pageSize: number = 10): Promise<NotionPage[]> {
  console.log(`Incremental sync: fetching pages edited after ${lastSyncTime}...`);

  let result: any = null;
  if (isPipedreamReady("notion")) {
    try {
      result = await callNotionSearch(pageSize);
    } catch (error) {
      console.error("Pipedream Notion search failed, falling back to MCP:", error);
    }
  }

  if (!result) {
    const prompt = `Use API-post-search, sort by last_edited_time descending, page_size ${pageSize}. For each page: 1) fetch page properties using API-get-page, 2) fetch blocks. Return JSON array with objects containing: id, title, last_edited_time, url, properties (all page properties), content (full text from blocks). No explanation, just the JSON array.`;

    result = callMCP(prompt);

    if (result.error) {
      console.error("Failed incremental sync:", result.error);
      return [];
    }
  }

  const pages = parsePageResults(result);

  // Filter to only pages edited after lastSyncTime
  return pages.filter(p => {
    if (!p.lastEditedTime) return true; // Include if no timestamp
    return new Date(p.lastEditedTime) > new Date(lastSyncTime);
  });
}

/**
 * Parse page results from MCP response
 */
function parsePageResults(result: any): NotionPage[] {
  let pages: NotionPage[] = [];

  if (Array.isArray(result)) {
    pages = result.map((item: any) => ({
      id: item.id,
      title: item.title || "Untitled",
      url: item.url,
      lastEditedTime: item.last_edited_time || item.lastEditedTime,
      properties: item.properties,
      content: item.content,
    }));
  } else if (result.results && Array.isArray(result.results)) {
    // Direct API response format
    pages = result.results.map((item: any) => {
      let title = "Untitled";
      if (item.properties?.title?.title?.[0]?.plain_text) {
        title = item.properties.title.title[0].plain_text;
      } else if (item.properties?.Name?.title?.[0]?.plain_text) {
        title = item.properties.Name.title[0].plain_text;
      }
      return {
        id: item.id,
        title,
        url: item.url,
        lastEditedTime: item.last_edited_time,
        properties: item.properties,
        content: item.content,
      };
    });
  } else if (result.raw) {
    // Try to extract from raw output
    console.log("Raw MCP output:", result.raw.slice(0, 500));
  }

  return pages.filter((p) => p.id);
}

/**
 * Legacy: List all accessible pages using API-post-search (kept for compatibility)
 */
async function discoverAccessiblePages(): Promise<NotionPage[]> {
  console.log("Discovering accessible Notion pages...");

  if (isPipedreamReady("notion")) {
    try {
      const result = await callNotionSearch(50);
      return parsePageResults(result);
    } catch (error) {
      console.error("Pipedream Notion search failed, falling back to MCP:", error);
    }
  }

  const prompt = `Use API-post-search, sort by last_edited_time descending. Return ONLY a JSON array with objects containing: id, title (from properties.title.title[0].plain_text or properties.Name.title[0].plain_text), url, last_edited_time. No explanation, just the JSON array.`;

  const result = callMCP(prompt);

  if (result.error) {
    console.error("Failed to list pages:", result.error);
    return [];
  }

  return parsePageResults(result);
}

/**
 * Fetch block children for a page using API-get-block-children
 */
async function fetchBlockChildren(blockId: string): Promise<NotionBlock[]> {
  if (isPipedreamReady("notion")) {
    try {
      const blocks: NotionBlock[] = [];
      let cursor: string | undefined = undefined;
      let hasMore = true;

      while (hasMore) {
        const result = await callNotionBlocks(blockId, cursor);
        if (Array.isArray(result?.results)) {
          blocks.push(...result.results);
        }
        hasMore = Boolean(result?.has_more);
        cursor = result?.next_cursor || undefined;
      }

      return blocks;
    } catch (error) {
      console.error(`Pipedream Notion blocks failed, falling back to MCP:`, error);
    }
  }

  const prompt = `Call API-get-block-children with block_id="${blockId}". Return ONLY the results array as JSON. No explanation.`;

  const result = callMCP(prompt);

  if (result.error) {
    console.error(`Failed to fetch blocks for ${blockId}:`, result.error);
    return [];
  }

  if (Array.isArray(result)) {
    return result;
  } else if (result.results && Array.isArray(result.results)) {
    return result.results;
  }

  return [];
}

function extractTextFromRichText(richText: any[]): string {
  if (!richText || !Array.isArray(richText)) return "";
  return richText.map((rt) => rt.plain_text || "").join("");
}

function blockToMarkdown(block: NotionBlock, depth: number = 0): string {
  const indent = "  ".repeat(depth);
  const type = block.type;
  const content = block[type];

  if (!content) return "";

  switch (type) {
    case "paragraph":
      const pText = extractTextFromRichText(content.rich_text);
      return pText ? `${indent}${pText}\n\n` : "\n";

    case "heading_1":
      return `${indent}# ${extractTextFromRichText(content.rich_text)}\n\n`;

    case "heading_2":
      return `${indent}## ${extractTextFromRichText(content.rich_text)}\n\n`;

    case "heading_3":
      return `${indent}### ${extractTextFromRichText(content.rich_text)}\n\n`;

    case "bulleted_list_item":
      return `${indent}- ${extractTextFromRichText(content.rich_text)}\n`;

    case "numbered_list_item":
      return `${indent}1. ${extractTextFromRichText(content.rich_text)}\n`;

    case "to_do":
      const checked = content.checked ? "x" : " ";
      return `${indent}- [${checked}] ${extractTextFromRichText(content.rich_text)}\n`;

    case "toggle":
      return `${indent}<details>\n${indent}<summary>${extractTextFromRichText(content.rich_text)}</summary>\n`;

    case "quote":
      return `${indent}> ${extractTextFromRichText(content.rich_text)}\n\n`;

    case "code":
      const lang = content.language || "";
      const code = extractTextFromRichText(content.rich_text);
      return `${indent}\`\`\`${lang}\n${code}\n\`\`\`\n\n`;

    case "divider":
      return `${indent}---\n\n`;

    case "callout":
      const emoji = content.icon?.emoji || "";
      const calloutText = extractTextFromRichText(content.rich_text);
      return `${indent}> ${emoji} ${calloutText}\n\n`;

    case "table_row":
      return "";

    default:
      if (content.rich_text) {
        return `${indent}${extractTextFromRichText(content.rich_text)}\n\n`;
      }
      return "";
  }
}

function convertBlocksToMarkdown(blocks: NotionBlock[]): string {
  let markdown = "";
  for (const block of blocks) {
    markdown += blockToMarkdown(block);
  }
  return markdown;
}

async function syncPage(page: NotionPage & { content?: string }): Promise<boolean> {
  const date = getFormattedDate();
  const time = getCurrentTime();

  console.log(`Syncing: ${page.title}`);

  let content: string;

  // Check if content was already fetched (from first-time/incremental sync)
  if (page.content && typeof page.content === "string" && page.content.trim()) {
    console.log(`  Using pre-fetched content`);
    content = page.content;
  } else {
    // Fallback: Fetch page content via blocks
    const blocks = await fetchBlockChildren(page.id);

    if (blocks.length === 0) {
      console.log(`  No blocks fetched for ${page.title}`);
      // Still save if we have properties (CRM entries)
      if (!page.properties || Object.keys(page.properties).length === 0) {
        return false;
      }
      content = "";
    } else {
      console.log(`  Fetched ${blocks.length} blocks`);
      content = convertBlocksToMarkdown(blocks);
    }
  }

  // Build markdown output
  const notionUrl =
    page.url || `https://www.notion.so/${page.id.replace(/-/g, "")}`;
  let markdown = `# ${page.title}\n\n`;
  markdown += `> Fetched: ${date} ${time} via Atlas Notion Sync\n`;
  markdown += `> Source: [Notion](${notionUrl})\n`;
  if (page.lastEditedTime) {
    markdown += `> Last edited: ${page.lastEditedTime}\n`;
  }
  markdown += `\n---\n\n`;

  // Add properties section if available (useful for CRM/database entries)
  if (page.properties && Object.keys(page.properties).length > 0) {
    markdown += `## Properties\n\n`;
    for (const [key, value] of Object.entries(page.properties)) {
      const displayValue = formatPropertyValue(value);
      if (displayValue) {
        markdown += `- **${key}:** ${displayValue}\n`;
      }
    }
    markdown += `\n---\n\n`;
  }

  if (content.trim()) {
    markdown += content;
  } else {
    markdown += `*(No block content)*\n`;
  }

  // Save to output directory
  ensureDir(OUTPUT_BASE);

  const safeTitle = safeFilename(page.title);
  const filename = `${date} ${safeTitle}.md`;
  const filePath = join(OUTPUT_BASE, filename);
  atomicWriteFileSync(filePath, markdown);

  console.log(`  Saved: ${filePath}`);
  return true;
}

/**
 * Format a Notion property value for display
 */
function formatPropertyValue(prop: any): string {
  if (!prop) return "";

  // Handle different property types
  if (prop.type === "title" && prop.title) {
    return prop.title.map((t: any) => t.plain_text).join("");
  }
  if (prop.type === "rich_text" && prop.rich_text) {
    return prop.rich_text.map((t: any) => t.plain_text).join("");
  }
  if (prop.type === "select" && prop.select) {
    return prop.select.name || "";
  }
  if (prop.type === "multi_select" && prop.multi_select) {
    return prop.multi_select.map((s: any) => s.name).join(", ");
  }
  if (prop.type === "status" && prop.status) {
    return prop.status.name || "";
  }
  if (prop.type === "date" && prop.date) {
    return prop.date.start || "";
  }
  if (prop.type === "checkbox") {
    return prop.checkbox ? "Yes" : "No";
  }
  if (prop.type === "number" && prop.number !== null) {
    return String(prop.number);
  }
  if (prop.type === "url" && prop.url) {
    return prop.url;
  }
  if (prop.type === "email" && prop.email) {
    return prop.email;
  }
  if (prop.type === "phone_number" && prop.phone_number) {
    return prop.phone_number;
  }
  if (prop.type === "relation" && prop.relation) {
    return `${prop.relation.length} linked`;
  }
  if (prop.type === "people" && prop.people) {
    return prop.people.map((p: any) => p.name || p.id).join(", ");
  }

  return "";
}

async function main() {
  const date = getFormattedDate();
  const args = process.argv.slice(2);
  const forceFullSync = args.includes("--full") || args.includes("--initial");
  const pageSize = parseInt(args.find(a => a.startsWith("--pages="))?.split("=")[1] || "20");

  console.log(`Notion sync: ${date}`);
  console.log(`Using ${isPipedreamReady("notion") ? "Pipedream Connect" : "@notionhq/notion-mcp-server"}`);

  // Load sync state
  const state = loadSyncState();
  const isFirstTime = !state.lastSyncTime || forceFullSync;

  if (isFirstTime) {
    console.log(`Mode: First-time sync (page_size: ${pageSize})`);
  } else {
    console.log(`Mode: Incremental sync (since: ${state.lastSyncTime})`);
  }

  // Fetch pages based on sync mode
  let pages: NotionPage[];

  if (isFirstTime) {
    pages = await firstTimeSync(pageSize);
  } else {
    pages = await incrementalSync(state.lastSyncTime!, pageSize);
  }

  if (pages.length === 0) {
    if (isFirstTime) {
      console.log("\nNo accessible pages found.");
      console.log("Make sure you:");
      console.log("1. Created an integration at notion.so/my-integrations");
      console.log("2. Shared specific pages with the integration in Notion");
      console.log("   (Click Share on a page, then Add connections, select your integration)");
    } else {
      console.log("\nNo pages updated since last sync.");
    }
    return;
  }

  console.log(`\nFound ${pages.length} pages to sync:`);
  for (const page of pages) {
    const editTime = page.lastEditedTime ? ` (edited: ${page.lastEditedTime})` : "";
    console.log(`  - ${page.title}${editTime}`);
  }
  console.log("");

  // Sync each page
  let synced = 0;
  const syncedIds: string[] = [];

  for (const page of pages) {
    try {
      const success = await syncPage(page);
      if (success) {
        synced++;
        syncedIds.push(page.id);
      }
      // Small delay between pages
      await new Promise((r) => setTimeout(r, 500));
    } catch (error: any) {
      console.error(`Failed to sync ${page.title}:`, error.message);
    }
  }

  // Update sync state
  const newState: SyncState = {
    lastSyncTime: new Date().toISOString(),
    syncedPageIds: [...new Set([...state.syncedPageIds, ...syncedIds])],
  };
  saveSyncState(newState);

  console.log(`\nNotion sync complete: ${synced}/${pages.length} pages synced`);
  console.log(`State saved. Next sync will be incremental.`);
}

main();
