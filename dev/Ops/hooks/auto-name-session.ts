#!/usr/bin/env bun
/**
 * Stop Hook: Auto-Name Sessions
 *
 * On first Claude response in a new session, generates a 3-5 word title
 * using Claude Code CLI (Haiku) and writes it to sessions-index.json → entry.summary.
 *
 * Uses CC subscription via `claude -p`, not the Anthropic API.
 * Runs async so it doesn't block Claude.
 */

import { readFileSync, writeFileSync, renameSync } from "fs";
import { dirname, join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

interface SessionEntry {
  sessionId: string;
  fullPath: string;
  fileMtime: number;
  firstPrompt: string;
  summary?: string;
  messageCount: number;
  created: string;
  modified: string;
  gitBranch: string;
  projectPath: string;
  isSidechain: boolean;
}

interface SessionsIndex {
  version: number;
  entries: SessionEntry[];
}

interface StopEvent {
  session_id: string;
  transcript_path: string;
  cwd: string;
  hook_event_name: string;
  stop_hook_active?: boolean;
}

async function generateTitle(prompt: string): Promise<string | null> {
  // Truncate long prompts
  const truncated = prompt.slice(0, 500);

  const claudePrompt = `Generate a concise 3-5 word title for this Claude Code session based on the first prompt. Return ONLY the title, no quotes, no punctuation at the end, no explanation.\n\nFirst prompt: ${truncated}`;

  // Use Claude Code CLI with Haiku — uses CC subscription, not API key
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY; // Force subscription usage

  const proc = Bun.spawn(["claude", "-p", claudePrompt, "--model", "haiku"], {
    env,
    stdout: "pipe",
    stderr: "pipe",
  });

  const output = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    console.error(`[AUTO-NAME] claude CLI failed (${exitCode}): ${stderr.slice(0, 200)}`);
    return null;
  }

  const title = output.trim();
  if (!title || title.length > 80) return null;
  return title;
}

async function main() {
  try {
    const stdin = await Bun.stdin.text();
    const event: StopEvent = JSON.parse(stdin);

    const { session_id, transcript_path } = event;
    if (!session_id || !transcript_path) return;

    // Resolve ~ in path
    const resolvedPath = transcript_path.replace(/^~/, process.env.HOME || "");

    // sessions-index.json lives in the same directory as the transcript
    const projectDir = dirname(resolvedPath);
    const indexPath = join(projectDir, "sessions-index.json");

    // Read the index
    let indexData: SessionsIndex;
    try {
      indexData = JSON.parse(readFileSync(indexPath, "utf-8"));
    } catch {
      // No index file — nothing to do
      return;
    }

    // Find our session entry
    const entry = indexData.entries.find((e) => e.sessionId === session_id);
    if (!entry) return;

    // Already named? Skip.
    if (entry.summary) return;

    // Get the first prompt
    const prompt = entry.firstPrompt;
    if (!prompt || prompt.trim().length === 0) return;

    // Generate title via Claude Code CLI (Haiku)
    const title = await generateTitle(prompt);
    if (!title) return;

    // Re-read index to minimize race window
    let freshIndex: SessionsIndex;
    try {
      freshIndex = JSON.parse(readFileSync(indexPath, "utf-8"));
    } catch {
      return;
    }

    const freshEntry = freshIndex.entries.find(
      (e) => e.sessionId === session_id
    );
    if (!freshEntry || freshEntry.summary) return;

    // Update
    freshEntry.summary = title;

    // Atomic write: write to temp file, then rename
    const tmpPath = join(tmpdir(), `sessions-index-${randomUUID()}.json`);
    writeFileSync(tmpPath, JSON.stringify(freshIndex, null, 2) + "\n");
    renameSync(tmpPath, indexPath);
  } catch (error) {
    // Silent fail — don't disrupt anything
    console.error(`[AUTO-NAME] Hook error: ${error}`);
  }
}

main();
