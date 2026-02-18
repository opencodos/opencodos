#!/usr/bin/env bun
/**
 * Error Aggregation Script
 *
 * Parses error data from multiple sources:
 * - ~/.claude/telemetry/ - API errors (timeouts, failures)
 * - ~/.claude/debug/ - System errors with stack traces
 * - Real-time error log - Tool execution errors
 * - Session data - For correlating prompts
 *
 * Generates markdown report in Vault/5 - Logs/
 */

import { readdirSync, readFileSync, existsSync, writeFileSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";

const CLAUDE_DIR = join(homedir(), ".claude");
const VAULT_PATH = process.env.VAULT_PATH || '';
const VAULT_LOGS = join(VAULT_PATH, "5 - Logs");
const REALTIME_LOG = join(VAULT_LOGS, "errors-realtime.jsonl");
const DAYS_TO_ANALYZE = 7;

interface ErrorEntry {
  timestamp: string;
  sessionId: string;
  type: "api" | "system" | "tool";
  error: string;
  tool?: string;
  prompt?: string;
  stackTrace?: string;
}

interface ErrorSummary {
  type: string;
  count: number;
  example: string;
}

function parseDate(dateStr: string): Date {
  return new Date(dateStr);
}

function isWithinDays(dateStr: string, days: number): boolean {
  const date = parseDate(dateStr);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return date >= cutoff;
}

// Parse real-time error log (JSONL)
function parseRealtimeLog(): ErrorEntry[] {
  if (!existsSync(REALTIME_LOG)) return [];

  const content = readFileSync(REALTIME_LOG, "utf-8");
  const entries: ErrorEntry[] = [];

  for (const line of content.split("\n").filter(Boolean)) {
    try {
      const data = JSON.parse(line);
      if (isWithinDays(data.timestamp, DAYS_TO_ANALYZE)) {
        entries.push({
          timestamp: data.timestamp,
          sessionId: data.sessionId || "unknown",
          type: "tool",
          tool: data.tool,
          error: data.error,
        });
      }
    } catch {
      // Skip malformed lines
    }
  }

  return entries;
}

// Parse debug logs for system errors
function parseDebugLogs(): ErrorEntry[] {
  const debugDir = join(CLAUDE_DIR, "debug");
  if (!existsSync(debugDir)) return [];

  const entries: ErrorEntry[] = [];
  const files = readdirSync(debugDir).filter(f => f.endsWith(".log"));

  for (const file of files.slice(-50)) { // Last 50 files
    try {
      const content = readFileSync(join(debugDir, file), "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/error|exception|failed|timeout/i.test(line)) {
          // Extract timestamp from filename or line
          const match = file.match(/(\d{4}-\d{2}-\d{2})/);
          const timestamp = match ? match[1] : new Date().toISOString().split("T")[0];

          if (isWithinDays(timestamp, DAYS_TO_ANALYZE)) {
            // Capture stack trace if present
            let stackTrace = "";
            for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
              if (lines[j].match(/^\s+at\s/)) {
                stackTrace += lines[j] + "\n";
              } else break;
            }

            entries.push({
              timestamp,
              sessionId: basename(file, ".log"),
              type: "system",
              error: line.slice(0, 300),
              stackTrace: stackTrace || undefined,
            });
          }
        }
      }
    } catch {
      // Skip unreadable files
    }
  }

  return entries;
}

// Parse session files to extract triggering prompts
function extractPromptForSession(sessionId: string): string | undefined {
  const projectsDir = join(CLAUDE_DIR, "projects");
  if (!existsSync(projectsDir)) return undefined;

  // Search in project subdirectories
  try {
    const projects = readdirSync(projectsDir);
    for (const project of projects) {
      const projectPath = join(projectsDir, project);
      const files = readdirSync(projectPath);

      for (const file of files) {
        if (file.includes(sessionId) && file.endsWith(".jsonl")) {
          const content = readFileSync(join(projectPath, file), "utf-8");
          const lines = content.split("\n").filter(Boolean);

          // Find last user message before error
          for (let i = lines.length - 1; i >= 0; i--) {
            try {
              const entry = JSON.parse(lines[i]);
              if (entry.type === "human" || entry.role === "user") {
                const text = entry.message?.content || entry.content;
                if (typeof text === "string") {
                  return text.slice(0, 200);
                }
              }
            } catch {
              continue;
            }
          }
        }
      }
    }
  } catch {
    // Silent fail
  }

  return undefined;
}

// Aggregate and categorize errors
function aggregateErrors(entries: ErrorEntry[]): Map<string, ErrorSummary> {
  const summary = new Map<string, ErrorSummary>();

  const categories: Array<{ pattern: RegExp; type: string }> = [
    { pattern: /timeout|timed out/i, type: "API Timeout" },
    { pattern: /rate limit|429/i, type: "Rate Limit" },
    { pattern: /not found|ENOENT|404/i, type: "Not Found" },
    { pattern: /permission|denied|EACCES/i, type: "Permission Denied" },
    { pattern: /connection|network|ECONNREFUSED/i, type: "Network Error" },
    { pattern: /parse|syntax|JSON/i, type: "Parse Error" },
    { pattern: /memory|heap|OOM/i, type: "Memory Error" },
  ];

  for (const entry of entries) {
    let type = "Other";
    for (const cat of categories) {
      if (cat.pattern.test(entry.error)) {
        type = cat.type;
        break;
      }
    }

    const existing = summary.get(type);
    if (existing) {
      existing.count++;
    } else {
      summary.set(type, {
        type,
        count: 1,
        example: entry.error.slice(0, 100),
      });
    }
  }

  return summary;
}

// Generate hourly distribution for pattern detection
function getHourlyDistribution(entries: ErrorEntry[]): Map<number, number> {
  const dist = new Map<number, number>();

  for (const entry of entries) {
    const hour = new Date(entry.timestamp).getUTCHours();
    dist.set(hour, (dist.get(hour) || 0) + 1);
  }

  return dist;
}

// Generate markdown report
function generateReport(entries: ErrorEntry[]): string {
  const today = new Date().toISOString().split("T")[0];
  const summary = aggregateErrors(entries);
  const hourlyDist = getHourlyDistribution(entries);

  // Get unique sessions
  const sessions = new Set(entries.map(e => e.sessionId));

  let report = `# Error Report — ${today}

**Period:** Last ${DAYS_TO_ANALYZE} days | **Total:** ${entries.length} | **Sessions:** ${sessions.size}

## By Type

| Type | Count | Example |
|------|-------|---------|
`;

  // Sort by count descending
  const sorted = Array.from(summary.values()).sort((a, b) => b.count - a.count);
  for (const s of sorted) {
    report += `| ${s.type} | ${s.count} | ${s.example.replace(/\|/g, "\\|")} |\n`;
  }

  report += `
## Timeline

| Time | Type | Tool | Error |
|------|------|------|-------|
`;

  // Last 20 errors
  const recent = entries.slice(-20).reverse();
  for (const e of recent) {
    const time = e.timestamp.split("T")[1]?.slice(0, 5) || e.timestamp;
    const tool = e.tool || "-";
    const error = e.error.slice(0, 60).replace(/\|/g, "\\|").replace(/\n/g, " ");
    report += `| ${time} | ${e.type} | ${tool} | ${error} |\n`;
  }

  report += `
## Patterns

`;

  // Find peak hours
  const peakHours = Array.from(hourlyDist.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  if (peakHours.length > 0) {
    const peakStr = peakHours.map(([h, c]) => `${h}:00 UTC (${c})`).join(", ");
    report += `- **Peak error hours:** ${peakStr}\n`;
  }

  // Most problematic tools
  const toolCounts = new Map<string, number>();
  for (const e of entries) {
    if (e.tool) {
      toolCounts.set(e.tool, (toolCounts.get(e.tool) || 0) + 1);
    }
  }
  const topTools = Array.from(toolCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  if (topTools.length > 0) {
    const toolStr = topTools.map(([t, c]) => `${t} (${c})`).join(", ");
    report += `- **Most errors from tools:** ${toolStr}\n`;
  }

  report += `
---
*Generated by Atlas Error Analysis*
`;

  return report;
}

async function main() {
  console.log("Aggregating errors from multiple sources...");

  const realtimeErrors = parseRealtimeLog();
  console.log(`  Real-time log: ${realtimeErrors.length} errors`);

  const debugErrors = parseDebugLogs();
  console.log(`  Debug logs: ${debugErrors.length} errors`);

  // Combine all errors
  const allErrors = [...realtimeErrors, ...debugErrors];

  // Sort by timestamp
  allErrors.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  // Try to extract prompts for recent errors
  for (const entry of allErrors.slice(-10)) {
    if (!entry.prompt && entry.sessionId !== "unknown") {
      entry.prompt = extractPromptForSession(entry.sessionId);
    }
  }

  // Generate report
  const report = generateReport(allErrors);

  // Write report
  const today = new Date().toISOString().split("T")[0];
  const reportPath = join(VAULT_LOGS, `errors-${today}.md`);
  writeFileSync(reportPath, report);

  console.log(`\nReport generated: ${reportPath}`);
  console.log(`Total errors analyzed: ${allErrors.length}`);

  // Also output to stdout for Claude to read
  console.log("\n" + report);
}

main();
