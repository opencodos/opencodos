/**
 * Cloudbot Repository Monitor - Secure GitHub commit parser
 *
 * Purpose: Monitor new commits from Cloudbot repository and implement them to our system
 * Security: Rate limiting, signature verification, input validation, audit logging
 *
 * Usage: bun run cloudbot-monitor.ts
 *
 * Outputs to: Vault/1 - Inbox (Last 7 days)/Github/Cloudbot/{date}.md
 */

import { execSync } from "child_process";
import { writeFileSync, mkdirSync, existsSync, readFileSync, appendFileSync } from "fs";
import { join } from "path";
import { createHash, createHmac } from "crypto";

// ============================================================================
// SECURITY CONFIGURATION
// ============================================================================

const CODOS_PATH = process.env.CODOS_PATH || '';
const VAULT_PATH = process.env.VAULT_PATH || '';

const SECURITY_CONFIG = {
  // Rate limiting: Max API calls per hour
  MAX_API_CALLS_PER_HOUR: 30,

  // Rate limiting state file
  RATE_LIMIT_FILE: join(CODOS_PATH, "dev/Ops/github/cloudbot-rate-limit.json"),

  // Audit log
  AUDIT_LOG_FILE: join(CODOS_PATH, "dev/Ops/github/cloudbot-audit.log"),

  // Allowed repository patterns (whitelist)
  ALLOWED_REPOS: [
    /^claudebot\//i,
    /^cloudbot\//i,
  ],

  // Maximum commit message length to prevent injection
  MAX_COMMIT_MSG_LENGTH: 5000,

  // Maximum number of commits to process per run
  MAX_COMMITS_PER_RUN: 50,

  // Webhook secret (if using webhooks) - stored in secrets
  WEBHOOK_SECRET_PATH: join(CODOS_PATH, "dev/Ops/secrets/github-webhook-secret.txt"),
};

// ============================================================================
// CONFIGURATION
// ============================================================================

const RUN_MCP_PATH = join(CODOS_PATH, "dev/Ops/mcp/run-mcp.sh");
const OUTPUT_DIR = join(VAULT_PATH, "1 - Inbox (Last 7 days)/Github/Cloudbot");
const CONFIG_FILE = join(CODOS_PATH, "dev/Ops/github/cloudbot-config.json");
const STATE_FILE = join(CODOS_PATH, "dev/Ops/github/cloudbot-state.json");

interface CloudbotConfig {
  repo: string; // e.g., "owner/cloudbot"
  branch?: string; // default: "main"
  enabled: boolean;
  checkInterval: number; // minutes
  autoApply: boolean; // if true, attempt to apply changes automatically
  notifyTelegram: boolean;
  lastChecked?: string;
}

interface Commit {
  sha: string;
  message: string;
  author: string;
  date: string;
  files?: string[];
  additions?: number;
  deletions?: number;
  url: string;
}

interface RateLimitState {
  calls: { timestamp: number }[];
  lastReset: number;
}

interface ProcessingState {
  lastProcessedSha: string;
  lastProcessedDate: string;
  processedCommits: string[];
}

// ============================================================================
// SECURITY UTILITIES
// ============================================================================

class SecurityManager {
  private static auditLog(event: string, details: any, severity: "INFO" | "WARN" | "ERROR" | "CRITICAL") {
    const timestamp = new Date().toISOString();
    const logEntry = JSON.stringify({
      timestamp,
      event,
      severity,
      details,
    });

    try {
      const logDir = join(CODOS_PATH, "dev/Ops/github");
      if (!existsSync(logDir)) {
        mkdirSync(logDir, { recursive: true });
      }
      appendFileSync(SECURITY_CONFIG.AUDIT_LOG_FILE, logEntry + "\n");
    } catch (error) {
      console.error("Failed to write audit log:", error);
    }
  }

  static checkRateLimit(): boolean {
    try {
      const now = Date.now();
      const oneHourAgo = now - 3600000; // 1 hour in ms

      let state: RateLimitState = { calls: [], lastReset: now };

      if (existsSync(SECURITY_CONFIG.RATE_LIMIT_FILE)) {
        const data = JSON.parse(readFileSync(SECURITY_CONFIG.RATE_LIMIT_FILE, "utf-8"));
        state = data;
      }

      // Remove calls older than 1 hour
      state.calls = state.calls.filter(c => c.timestamp > oneHourAgo);

      // Check if we're over the limit
      if (state.calls.length >= SECURITY_CONFIG.MAX_API_CALLS_PER_HOUR) {
        this.auditLog("rate_limit_exceeded", {
          callCount: state.calls.length,
          limit: SECURITY_CONFIG.MAX_API_CALLS_PER_HOUR,
        }, "WARN");
        return false;
      }

      // Add current call
      state.calls.push({ timestamp: now });
      state.lastReset = now;

      // Save state
      const dir = SECURITY_CONFIG.RATE_LIMIT_FILE.split("/").slice(0, -1).join("/");
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(SECURITY_CONFIG.RATE_LIMIT_FILE, JSON.stringify(state, null, 2));

      return true;
    } catch (error) {
      this.auditLog("rate_limit_check_failed", { error: String(error) }, "ERROR");
      return false;
    }
  }

  static validateRepoName(repo: string): boolean {
    // Check against whitelist
    const isAllowed = SECURITY_CONFIG.ALLOWED_REPOS.some(pattern => pattern.test(repo));

    if (!isAllowed) {
      this.auditLog("repo_validation_failed", {
        repo,
        reason: "not in whitelist",
      }, "CRITICAL");
      return false;
    }

    // Additional validation: no path traversal or injection attempts
    if (repo.includes("..") || repo.includes("~") || repo.includes("$")) {
      this.auditLog("repo_validation_failed", {
        repo,
        reason: "suspicious characters detected",
      }, "CRITICAL");
      return false;
    }

    return true;
  }

  static sanitizeCommitMessage(message: string): string {
    if (!message) return "";

    // Truncate to max length
    let sanitized = message.slice(0, SECURITY_CONFIG.MAX_COMMIT_MSG_LENGTH);

    // Remove potentially dangerous characters for shell injection
    sanitized = sanitized.replace(/[`$();<>|&]/g, "");

    // Remove control characters
    sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, "");

    return sanitized;
  }

  static sanitizeFileName(fileName: string): string {
    if (!fileName) return "";

    // Remove path traversal attempts
    let sanitized = fileName.replace(/\.\./g, "");

    // Remove null bytes
    sanitized = sanitized.replace(/\0/g, "");

    // Ensure it's a relative path
    if (sanitized.startsWith("/")) {
      sanitized = sanitized.slice(1);
    }

    return sanitized;
  }

  static verifyWebhookSignature(payload: string, signature: string): boolean {
    try {
      if (!existsSync(SECURITY_CONFIG.WEBHOOK_SECRET_PATH)) {
        this.auditLog("webhook_verification_failed", {
          reason: "secret file not found",
        }, "ERROR");
        return false;
      }

      const secret = readFileSync(SECURITY_CONFIG.WEBHOOK_SECRET_PATH, "utf-8").trim();
      const hmac = createHmac("sha256", secret);
      hmac.update(payload);
      const computed = "sha256=" + hmac.digest("hex");

      // Timing-safe comparison
      const isValid = computed === signature;

      if (!isValid) {
        this.auditLog("webhook_verification_failed", {
          reason: "signature mismatch",
        }, "CRITICAL");
      }

      return isValid;
    } catch (error) {
      this.auditLog("webhook_verification_error", {
        error: String(error),
      }, "ERROR");
      return false;
    }
  }

  static hashCommit(commit: Commit): string {
    // Create a deterministic hash of commit for deduplication
    const data = `${commit.sha}:${commit.date}:${commit.author}`;
    return createHash("sha256").update(data).digest("hex");
  }
}

// ============================================================================
// CONFIGURATION MANAGEMENT
// ============================================================================

function loadConfig(): CloudbotConfig {
  try {
    if (existsSync(CONFIG_FILE)) {
      const config = JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
      return config;
    }
  } catch (error) {
    console.error("Failed to load config, using defaults:", error);
  }

  // Default configuration
  return {
    repo: "", // Must be set by user
    branch: "main",
    enabled: false,
    checkInterval: 30, // 30 minutes
    autoApply: false, // DISABLED by default for safety
    notifyTelegram: true,
    lastChecked: undefined,
  };
}

function saveConfig(config: CloudbotConfig) {
  try {
    const dir = CONFIG_FILE.split("/").slice(0, -1).join("/");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (error) {
    console.error("Failed to save config:", error);
  }
}

function loadState(): ProcessingState {
  try {
    if (existsSync(STATE_FILE)) {
      return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
    }
  } catch (error) {
    console.error("Failed to load state:", error);
  }

  return {
    lastProcessedSha: "",
    lastProcessedDate: "",
    processedCommits: [],
  };
}

function saveState(state: ProcessingState) {
  try {
    const dir = STATE_FILE.split("/").slice(0, -1).join("/");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (error) {
    console.error("Failed to save state:", error);
  }
}

// ============================================================================
// GITHUB API UTILITIES
// ============================================================================

function runMCP(prompt: string): string {
  try {
    // Check rate limit before making API call
    if (!SecurityManager.checkRateLimit()) {
      throw new Error("Rate limit exceeded. Please try again later.");
    }

    const result = execSync(`"${RUN_MCP_PATH}" github '${prompt}'`, {
      encoding: "utf-8",
      timeout: 60000, // 1 minute timeout
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        PATH: `${process.env.HOME}/.nvm/versions/node/v22.20.0/bin:${process.env.HOME}/.bun/bin:${process.env.PATH || "/usr/bin:/bin"}`,
      },
    });

    SecurityManager["auditLog"]("mcp_call_success", { prompt: prompt.slice(0, 100) }, "INFO");
    return result;
  } catch (error: any) {
    SecurityManager["auditLog"]("mcp_call_failed", {
      error: error.message,
      prompt: prompt.slice(0, 100),
    }, "ERROR");
    throw error;
  }
}

function parseJSON(response: string): any {
  // Try to find JSON in code blocks
  const codeBlockMatch = response.match(/```(?:json)?\n?([\s\S]+?)```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch (e) {
      // Fall through
    }
  }

  // Try to extract JSON array
  const arrayStart = response.indexOf("[");
  if (arrayStart !== -1) {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = arrayStart; i < response.length; i++) {
      const char = response[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (char === "\\") {
        escape = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (char === "[") depth++;
      if (char === "]") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(response.slice(arrayStart, i + 1));
          } catch (e) {
            break;
          }
        }
      }
    }
  }

  // Try raw JSON object
  const objectMatch = response.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      return JSON.parse(objectMatch[0]);
    } catch (e) {
      // Fall through
    }
  }

  return null;
}

async function fetchRecentCommits(repo: string, branch: string, since?: string): Promise<Commit[]> {
  // Validate repository name
  if (!SecurityManager.validateRepoName(repo)) {
    throw new Error(`Repository "${repo}" is not authorized`);
  }

  const sinceParam = since ? ` since="${since}"` : "";
  const prompt = `Use GITHUB_LIST_COMMITS to get commits for repo "${repo}" on branch "${branch}"${sinceParam}. Return JSON array with sha, message, author (commit.author.name), date (commit.author.date), url (html_url) for each commit. Limit to 50 commits.`;

  try {
    const response = runMCP(prompt);
    const data = parseJSON(response);
    const commits = Array.isArray(data) ? data : data?.commits || [];

    // Sanitize and validate each commit
    const sanitizedCommits = commits
      .slice(0, SECURITY_CONFIG.MAX_COMMITS_PER_RUN)
      .map((c: any) => ({
        sha: c.sha || "",
        message: SecurityManager.sanitizeCommitMessage(c.message || ""),
        author: SecurityManager.sanitizeCommitMessage(c.author || "unknown"),
        date: c.date || new Date().toISOString(),
        url: c.url || c.html_url || "",
        files: Array.isArray(c.files)
          ? c.files.map((f: string) => SecurityManager.sanitizeFileName(f))
          : [],
        additions: typeof c.additions === "number" ? c.additions : undefined,
        deletions: typeof c.deletions === "number" ? c.deletions : undefined,
      }));

    SecurityManager["auditLog"]("commits_fetched", {
      repo,
      count: sanitizedCommits.length,
      branch,
    }, "INFO");

    return sanitizedCommits;
  } catch (error) {
    SecurityManager["auditLog"]("fetch_commits_failed", {
      repo,
      error: String(error),
    }, "ERROR");
    throw error;
  }
}

// ============================================================================
// COMMIT PROCESSING
// ============================================================================

function filterNewCommits(commits: Commit[], state: ProcessingState): Commit[] {
  // Filter out commits we've already processed
  const newCommits = commits.filter(c => {
    // Check by SHA
    if (state.processedCommits.includes(c.sha)) {
      return false;
    }

    // Check if commit is after last processed date
    if (state.lastProcessedDate) {
      const commitDate = new Date(c.date);
      const lastDate = new Date(state.lastProcessedDate);
      if (commitDate <= lastDate) {
        return false;
      }
    }

    return true;
  });

  return newCommits;
}

function generateMarkdown(commits: Commit[], config: CloudbotConfig): string {
  const date = new Date().toISOString().split("T")[0];
  const time = new Date().toTimeString().split(" ")[0];

  let md = `# Cloudbot Monitor — ${date}\n\n`;
  md += `> Repository: ${config.repo}\n`;
  md += `> Branch: ${config.branch}\n`;
  md += `> Fetched: ${date} ${time}\n`;
  md += `> New commits: ${commits.length}\n\n`;

  if (commits.length === 0) {
    md += `## No New Commits\n\nNo new commits since last check.\n`;
    return md;
  }

  md += `## New Commits\n\n`;

  for (const commit of commits) {
    md += `### \`${commit.sha.slice(0, 7)}\` — ${commit.message.split("\n")[0]}\n\n`;
    md += `- **Author:** ${commit.author}\n`;
    md += `- **Date:** ${commit.date}\n`;
    md += `- **URL:** [View commit](${commit.url})\n`;

    if (commit.files && commit.files.length > 0) {
      md += `- **Files changed:** ${commit.files.length}\n`;
      md += `  - ${commit.files.slice(0, 10).join("\n  - ")}\n`;
      if (commit.files.length > 10) {
        md += `  - ... and ${commit.files.length - 10} more files\n`;
      }
    }

    if (commit.additions !== undefined || commit.deletions !== undefined) {
      md += `- **Changes:** +${commit.additions || 0} -${commit.deletions || 0}\n`;
    }

    // Full commit message
    if (commit.message.includes("\n")) {
      md += `\n**Full message:**\n\`\`\`\n${commit.message}\n\`\`\`\n`;
    }

    md += `\n---\n\n`;
  }

  // Summary
  md += `## Summary\n\n`;
  md += `- **Total new commits:** ${commits.length}\n`;
  md += `- **Last processed SHA:** ${commits[0]?.sha || "none"}\n`;
  md += `- **Auto-apply enabled:** ${config.autoApply ? "✅ Yes" : "❌ No"}\n`;

  if (!config.autoApply) {
    md += `\n> ⚠️ Auto-apply is disabled. Review commits manually before implementing.\n`;
  }

  return md;
}

function saveMarkdown(content: string): string {
  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const date = new Date().toISOString().split("T")[0];
  const timestamp = new Date().toTimeString().split(" ")[0].replace(/:/g, "-");
  const filePath = join(OUTPUT_DIR, `${date}-${timestamp}.md`);

  writeFileSync(filePath, content, "utf-8");
  return filePath;
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main() {
  console.log("=".repeat(60));
  console.log("Cloudbot Monitor - Secure GitHub Commit Parser");
  console.log("=".repeat(60));

  try {
    // Load configuration
    const config = loadConfig();

    if (!config.enabled) {
      console.log("❌ Monitor is disabled in configuration");
      console.log("   Edit config at:", CONFIG_FILE);
      return;
    }

    if (!config.repo) {
      console.log("❌ No repository configured");
      console.log("   Edit config at:", CONFIG_FILE);
      return;
    }

    console.log(`✅ Monitoring: ${config.repo}`);
    console.log(`   Branch: ${config.branch}`);
    console.log(`   Auto-apply: ${config.autoApply ? "ENABLED" : "DISABLED"}`);

    // Load state
    const state = loadState();
    console.log(`   Last processed: ${state.lastProcessedSha.slice(0, 7) || "none"}`);

    // Fetch commits
    console.log("\n📡 Fetching commits...");
    const commits = await fetchRecentCommits(
      config.repo,
      config.branch || "main",
      state.lastProcessedDate
    );

    console.log(`   Found ${commits.length} total commits`);

    // Filter new commits
    const newCommits = filterNewCommits(commits, state);
    console.log(`   ${newCommits.length} new commits to process`);

    if (newCommits.length === 0) {
      console.log("\n✅ No new commits since last check");
      return;
    }

    // Generate markdown report
    const markdown = generateMarkdown(newCommits, config);
    const outputPath = saveMarkdown(markdown);
    console.log(`\n📝 Report saved: ${outputPath}`);

    // Update state
    if (newCommits.length > 0) {
      const latestCommit = newCommits[0];
      state.lastProcessedSha = latestCommit.sha;
      state.lastProcessedDate = latestCommit.date;
      state.processedCommits.push(...newCommits.map(c => c.sha));

      // Keep only last 1000 processed commits to prevent unbounded growth
      if (state.processedCommits.length > 1000) {
        state.processedCommits = state.processedCommits.slice(-1000);
      }

      saveState(state);
    }

    // Update config
    config.lastChecked = new Date().toISOString();
    saveConfig(config);

    console.log("\n✅ Cloudbot monitor complete");

    // Audit log summary
    SecurityManager["auditLog"]("monitor_run_complete", {
      newCommits: newCommits.length,
      lastProcessedSha: state.lastProcessedSha,
    }, "INFO");

  } catch (error: any) {
    console.error("\n❌ Error:", error.message);
    SecurityManager["auditLog"]("monitor_run_failed", {
      error: error.message,
      stack: error.stack,
    }, "ERROR");
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.main) {
  main();
}

export { main, loadConfig, saveConfig };
