#!/usr/bin/env bun
/**
 * PostToolUse Error Logging Hook
 *
 * Captures tool errors in real-time to JSONL file.
 * Runs after every tool execution to log failures.
 *
 * Usage: Added to ~/.claude/settings.json as PostToolUse hook
 */

import { appendFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";

// Derive log path from env or default location
const VAULT_ROOT = process.env.VAULT_PATH || join(homedir(), "Documents", "Vault");
const LOG_PATH = join(VAULT_ROOT, "5 - Logs", "errors-realtime.jsonl");

// Patterns that indicate an error in tool output
const ERROR_PATTERNS = [
  /error:/i,
  /failed:/i,
  /exception/i,
  /command failed/i,
  /permission denied/i,
  /not found/i,
  /timed out/i,
  /timeout/i,
  /ENOENT/,
  /EACCES/,
  /EPERM/,
  /cannot/i,
  /unable to/i,
  /fatal:/i,
];

interface ToolEvent {
  session_id?: string;
  tool: string;
  input?: Record<string, unknown>;
  result?: {
    success?: boolean;
    output?: string;
    error?: string;
    stderr?: string;
    exit_code?: number;
  };
}

interface ErrorLogEntry {
  timestamp: string;
  sessionId: string;
  tool: string;
  error: string;
  input?: Record<string, unknown>;
  exitCode?: number;
}

function isError(event: ToolEvent): boolean {
  const result = event.result;
  if (!result) return false;

  // Explicit error field
  if (result.error) return true;

  // Non-zero exit code
  if (result.exit_code !== undefined && result.exit_code !== 0) return true;

  // Success explicitly false
  if (result.success === false) return true;

  // Check output for error patterns
  const output = result.output || result.stderr || "";
  return ERROR_PATTERNS.some(pattern => pattern.test(output));
}

function extractError(event: ToolEvent): string {
  const result = event.result;
  if (!result) return "Unknown error";

  if (result.error) return result.error;
  if (result.stderr) return result.stderr.slice(0, 500);
  if (result.output) return result.output.slice(0, 500);
  return `Exit code: ${result.exit_code}`;
}

async function main() {
  try {
    const stdin = await Bun.stdin.text();
    const event: ToolEvent = JSON.parse(stdin);

    // Only log if there's an error
    if (!isError(event)) {
      return;
    }

    // Ensure log directory exists
    mkdirSync(dirname(LOG_PATH), { recursive: true });

    const entry: ErrorLogEntry = {
      timestamp: new Date().toISOString(),
      sessionId: event.session_id || process.env.CLAUDE_SESSION_ID || "unknown",
      tool: event.tool,
      error: extractError(event),
      input: event.input,
      exitCode: event.result?.exit_code,
    };

    // Append to JSONL file
    appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n");

  } catch (error) {
    // Silent fail - don't disrupt the session
    console.error(`[ERROR-LOG] Hook error: ${error}`);
  }
}

main();
