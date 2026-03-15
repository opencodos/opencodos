/**
 * GitHub Sync - Fetches last 24h of activity via Pipedream Connect (fallback: MCP)
 *
 * Usage: bun run github-sync.ts
 *
 * Outputs to: Vault/1 - Inbox (Last 7 days)/Github/{date}.md
 */

import { execSync } from "child_process";
import { existsSync } from "fs";
import { atomicWriteFileSync, ensureDir } from "../lib/fs";
import { join } from "path";
import { getRunMcpPath, getInboxDir, getDynamicPath } from "../lib/paths";
import { isPipedreamReady, pipedreamProxyGet } from "../lib/pipedream";
import { parseJSON } from "../lib/parse";
import { getFormattedDate, getCurrentTime, getTimezoneLabel } from "../lib/date";

const RUN_MCP_PATH = getRunMcpPath();
const OUTPUT_DIR = getInboxDir("Github");

interface Repo {
  name: string;
  full_name: string;
  description?: string;
  updated_at: string;
  html_url: string;
  pushed_at?: string;
}

interface Commit {
  sha: string;
  message: string;
  author: string;
  date: string;
  repo: string;
}

interface Issue {
  number: number;
  title: string;
  state: string;
  repo: string;
  updated_at: string;
  html_url: string;
}


function getYesterdayISO(): string {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return date.toISOString();
}

function runMCP(prompt: string): string {
  try {
    const result = execSync(`"${RUN_MCP_PATH}" github '${prompt}'`, {
      encoding: "utf-8",
      timeout: 300000,
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

async function fetchRecentRepos(): Promise<Repo[]> {
  console.log("Fetching repositories...");

  try {
    if (isPipedreamReady("github")) {
      const data = await pipedreamProxyGet("github", "https://api.github.com/user/repos", {
        params: { sort: "pushed", per_page: 10 },
        headers: { Accept: "application/vnd.github+json" },
      });
      if (Array.isArray(data)) {
        return data.map((repo: any) => ({
          name: repo.name,
          full_name: repo.full_name,
          description: repo.description,
          updated_at: repo.updated_at,
          html_url: repo.html_url,
          pushed_at: repo.pushed_at,
        }));
      }
    }

    const prompt = `Use GITHUB_LIST_REPOS_FOR_AUTHENTICATED_USER with sort=pushed and per_page=10. Return JSON array with name, full_name, description, updated_at, html_url, pushed_at for each repo.`;
    const response = runMCP(prompt);
    const data = parseJSON(response);
    if (Array.isArray(data)) return data;
    if (data?.repos) return data.repos;
    if (data?.repositories) return data.repositories;
    return [];
  } catch (error) {
    console.error("Failed to fetch repos:", error);
    return [];
  }
}

async function fetchRecentCommits(repo: string): Promise<Commit[]> {
  const yesterday = getYesterdayISO();
  try {
    if (isPipedreamReady("github")) {
      const data = await pipedreamProxyGet(
        "github",
        `https://api.github.com/repos/${repo}/commits`,
        {
          params: { since: yesterday },
          headers: { Accept: "application/vnd.github+json" },
        }
      );
      if (Array.isArray(data)) {
        return data.map((c: any) => ({
          sha: c.sha,
          message: c.commit?.message?.split("\n")[0] || "",
          author: c.commit?.author?.name || "",
          date: c.commit?.author?.date || "",
          repo,
        }));
      }
    }

    const prompt = `Use GITHUB_LIST_COMMITS to get commits for repo "${repo}" since "${yesterday}". Return JSON array with sha, message (first line of commit.message), author (commit.author.name), date (commit.author.date) for each commit.`;
    const response = runMCP(prompt);
    const data = parseJSON(response);
    const commits = Array.isArray(data) ? data : data?.commits || [];
    return commits.map((c: any) => ({
      ...c,
      repo,
      message: c.message?.split("\n")[0] || c.message,
    }));
  } catch (error) {
    console.error(`Failed to fetch commits for ${repo}:`, error);
    return [];
  }
}

async function fetchAssignedIssues(): Promise<Issue[]> {
  // Skip issues fetch for now - too slow via MCP
  // Can enable later if needed
  console.log("Skipping issues fetch (slow)...");
  return [];
}

function isUpdatedRecently(dateStr: string): boolean {
  if (!dateStr) return false;
  const updated = new Date(dateStr);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return updated > yesterday;
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  try {
    const date = new Date(dateStr);
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${month}-${day} ${hours}:${minutes}`;
  } catch {
    return dateStr;
  }
}

function escapeMarkdown(text: string): string {
  if (!text) return "";
  return text
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ")
    .slice(0, 100);
}

function generateMarkdown(
  repos: Repo[],
  commits: Commit[],
  issues: Issue[]
): string {
  const date = getFormattedDate();
  const time = getCurrentTime();

  // Filter to recently updated repos
  const recentRepos = repos.filter(
    (r) => isUpdatedRecently(r.pushed_at || r.updated_at)
  );

  let md = `# GitHub — ${date}\n\n`;
  md += `> Fetched: ${date} ${time} ${getTimezoneLabel()}, last 24h\n\n`;

  // Recent Repos
  md += `## Active Repositories\n\n`;
  if (recentRepos.length === 0) {
    md += `No repositories updated in the last 24h.\n\n`;
  } else {
    md += `| Repo | Description | Last Push |\n`;
    md += `|------|-------------|----------|\n`;
    for (const repo of recentRepos) {
      const name = `[${repo.name}](${repo.html_url})`;
      const desc = escapeMarkdown(repo.description || "-");
      const pushed = formatDate(repo.pushed_at || repo.updated_at);
      md += `| ${name} | ${desc} | ${pushed} |\n`;
    }
    md += `\n`;
  }

  // Recent Commits
  md += `## Recent Commits\n\n`;
  if (commits.length === 0) {
    md += `No commits in the last 24h.\n\n`;
  } else {
    md += `| Time | Repo | Message |\n`;
    md += `|------|------|--------|\n`;
    for (const commit of commits.slice(0, 20)) {
      const time = formatDate(commit.date);
      const msg = escapeMarkdown(commit.message);
      const sha = commit.sha?.slice(0, 7) || "";
      md += `| ${time} | ${commit.repo} | \`${sha}\` ${msg} |\n`;
    }
    md += `\n`;
  }

  // Assigned Issues
  md += `## Assigned Issues/PRs\n\n`;
  if (issues.length === 0) {
    md += `No open issues assigned.\n\n`;
  } else {
    md += `| Repo | Issue | Updated |\n`;
    md += `|------|-------|--------|\n`;
    for (const issue of issues.slice(0, 10)) {
      const title = `[#${issue.number} ${escapeMarkdown(issue.title)}](${issue.html_url})`;
      const updated = formatDate(issue.updated_at);
      md += `| ${issue.repo} | ${title} | ${updated} |\n`;
    }
    md += `\n`;
  }

  // Summary
  md += `## Summary\n\n`;
  md += `- ${recentRepos.length} repos updated\n`;
  md += `- ${commits.length} commits\n`;
  md += `- ${issues.length} open issues assigned\n`;

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
  console.log(`GitHub sync: ${date}`);

  try {
    // Fetch repos
    const repos = await fetchRecentRepos();
    console.log(`Found ${repos.length} repos`);

    // Fetch commits for recently updated repos
    const recentRepos = repos.filter(
      (r) => isUpdatedRecently(r.pushed_at || r.updated_at)
    );

    let allCommits: Commit[] = [];
    for (const repo of recentRepos.slice(0, 5)) {
      console.log(`Fetching commits for ${repo.full_name}...`);
      const commits = await fetchRecentCommits(repo.full_name);
      allCommits = allCommits.concat(commits);
    }
    console.log(`Found ${allCommits.length} commits`);

    // Fetch assigned issues
    const issues = await fetchAssignedIssues();
    console.log(`Found ${issues.length} assigned issues`);

    // Generate and save markdown
    const markdown = generateMarkdown(repos, allCommits, issues);
    const filePath = saveFile(markdown);

    console.log(`Saved to: ${filePath}`);
    console.log("GitHub sync complete");
  } catch (error: any) {
    console.error("GitHub sync failed:", error.message);
    process.exit(1);
  }
}

main();
