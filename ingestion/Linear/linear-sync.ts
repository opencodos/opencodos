/**
 * Linear Sync - Fetches issues updated in last 24h via Pipedream Connect (fallback: MCP)
 *
 * Usage: bun run linear-sync.ts
 *
 * Outputs to: Vault/1 - Inbox (Last 7 days)/Linear/{date}.md
 */

import { execSync } from "child_process";
import { existsSync } from "fs";
import { atomicWriteFileSync, ensureDir } from "../lib/fs";
import { join } from "path";
import { getRunMcpPath, getInboxDir, getDynamicPath } from "../lib/paths";
import { isPipedreamReady, pipedreamProxyPost } from "../lib/pipedream";
import { parseJSON } from "../lib/parse";
import { getFormattedDate, getCurrentTime, getTimezoneLabel } from "../lib/date";

const RUN_MCP_PATH = getRunMcpPath();
const OUTPUT_DIR = getInboxDir("Linear");

interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  state: string;
  assignee?: string;
  priority: number;
  updatedAt: string;
  url?: string;
}


function runMCP(prompt: string): string {
  try {
    const result = execSync(`"${RUN_MCP_PATH}" linear '${prompt}'`, {
      encoding: "utf-8",
      timeout: 300000, // 5 min timeout
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        PATH: getDynamicPath(),
      },
    });
    return result;
  } catch (error: any) {
    console.error("MCP error:", error.message);
    throw error;
  }
}

async function fetchRecentIssues(): Promise<LinearIssue[]> {
  console.log("Fetching Linear issues from last 24h...");

  try {
    if (isPipedreamReady("linear")) {
      const query = `
        query {
          issues(first: 30, orderBy: updatedAt) {
            nodes {
              id
              identifier
              title
              priority
              updatedAt
              url
              state { name }
              assignee { name email }
            }
          }
        }
      `;
      const data = await pipedreamProxyPost("linear", "https://api.linear.app/graphql", {
        headers: { "Content-Type": "application/json" },
        body: { query },
      });
      const nodes = data?.data?.issues?.nodes || [];
      return nodes.map((issue: any) => ({
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        state: issue.state?.name || "Unknown",
        assignee: issue.assignee?.name || issue.assignee?.email || "Unassigned",
        priority: issue.priority ?? 0,
        updatedAt: issue.updatedAt,
        url: issue.url,
      }));
    }

    const prompt = `Call LINEAR_LIST_LINEAR_ISSUES with first=30. Return ONLY a JSON array (no explanation) with fields: identifier, title, state, assignee, priority. Example: [{"identifier":"MET-1","title":"Test","state":"Todo","assignee":"user@email.com","priority":2}]`;
    const response = runMCP(prompt);
    const data = parseJSON(response);
    const issues = Array.isArray(data) ? data : data.issues || [];
    return issues;
  } catch (error) {
    console.error("Failed to fetch issues:", error);
    return [];
  }
}

function groupByStatus(issues: LinearIssue[]): Map<string, LinearIssue[]> {
  const grouped = new Map<string, LinearIssue[]>();

  // Define status order
  const statusOrder = [
    "Pending Release",
    "In Review",
    "In Progress",
    "Todo",
    "Backlog",
    "Done",
    "Canceled",
  ];

  // Initialize groups
  for (const status of statusOrder) {
    grouped.set(status, []);
  }
  grouped.set("Other", []);

  for (const issue of issues) {
    const status = issue.state || "Other";
    const matchedStatus = statusOrder.find(
      (s) => s.toLowerCase() === status.toLowerCase()
    );

    if (matchedStatus) {
      grouped.get(matchedStatus)!.push(issue);
    } else {
      grouped.get("Other")!.push(issue);
    }
  }

  return grouped;
}

function priorityLabel(priority: number): string {
  switch (priority) {
    case 1:
      return "Urgent";
    case 2:
      return "High";
    case 3:
      return "Normal";
    case 4:
      return "Low";
    default:
      return "None";
  }
}

function generateMarkdown(issues: LinearIssue[]): string {
  const date = getFormattedDate();
  const time = getCurrentTime();

  let md = `# Linear Updates — ${date}\n\n`;
  md += `> ${issues.length} issues updated in last 24 hours\n\n`;

  const grouped = groupByStatus(issues);

  for (const [status, statusIssues] of grouped) {
    if (statusIssues.length === 0) continue;

    md += `## ${status} (${statusIssues.length})\n\n`;
    md += `| Issue | Title | Assignee | Priority |\n`;
    md += `|-------|-------|----------|----------|\n`;

    for (const issue of statusIssues) {
      const id = issue.identifier || issue.id;
      const url = issue.url || `https://linear.app/REDACTED/issue/${id}`;
      const title = (issue.title || "Untitled").slice(0, 60);
      const assignee = issue.assignee || "Unassigned";
      const priority = priorityLabel(issue.priority);

      md += `| [${id}](${url}) | ${title} | ${assignee} | ${priority} |\n`;
    }

    md += `\n`;
  }

  md += `---\n*Fetched: ${date} ${time} ${getTimezoneLabel()} via Linear MCP*\n`;

  return md;
}

function saveToFile(content: string): string {
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
  console.log(`Linear sync: ${date}`);

  const issues = await fetchRecentIssues();
  console.log(`Found ${issues.length} issues`);

  if (issues.length === 0) {
    console.log("No issues found in last 24h");
    // Still create file to show sync ran
    const content = `# Linear Updates — ${date}\n\n> No issues updated in last 24 hours\n`;
    const filePath = saveToFile(content);
    console.log(`Saved to ${filePath}`);
    return;
  }

  const markdown = generateMarkdown(issues);
  const filePath = saveToFile(markdown);

  console.log(`Saved ${issues.length} issues to ${filePath}`);
  console.log("Linear sync complete");
}

main();
