#!/usr/bin/env bun
/**
 * One-time backfill: Generate summaries for all unnamed sessions.
 *
 * Batches sessions (50 per call) into `claude -p --model haiku` calls
 * to minimize overhead. Uses CC subscription.
 *
 * Usage: bun run backfill-session-names.ts [--dry-run]
 */

import { readFileSync, writeFileSync, renameSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir, homedir } from "os";
import { randomUUID } from "crypto";

const PROJECTS_DIR = join(homedir(), ".claude", "projects");
const BATCH_SIZE = 50;
const DRY_RUN = process.argv.includes("--dry-run");

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

interface UnnamedSession {
  indexPath: string;
  sessionId: string;
  firstPrompt: string;
}

function collectUnnamed(): UnnamedSession[] {
  const unnamed: UnnamedSession[] = [];
  const dirs = readdirSync(PROJECTS_DIR, { withFileTypes: true });

  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const indexPath = join(PROJECTS_DIR, dir.name, "sessions-index.json");
    try {
      const data: SessionsIndex = JSON.parse(readFileSync(indexPath, "utf-8"));
      for (const entry of data.entries) {
        if (!entry.summary && entry.firstPrompt?.trim()) {
          unnamed.push({
            indexPath,
            sessionId: entry.sessionId,
            firstPrompt: entry.firstPrompt,
          });
        }
      }
    } catch {
      // Skip unreadable index files
    }
  }

  return unnamed;
}

async function generateTitlesBatch(
  sessions: UnnamedSession[]
): Promise<Map<string, string>> {
  const results = new Map<string, string>();

  // Build numbered list of prompts
  const lines = sessions.map(
    (s, i) => `${i + 1}. [${s.sessionId}]: ${s.firstPrompt.slice(0, 200)}`
  );

  const prompt = `Generate a concise 3-5 word title for each Claude Code session below.
Return ONLY a JSON object mapping session ID to title. No markdown fences, no explanation.

Sessions:
${lines.join("\n")}`;

  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;

  const proc = Bun.spawn(["claude", "-p", prompt, "--model", "haiku"], {
    env,
    stdout: "pipe",
    stderr: "pipe",
  });

  const output = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    console.error(`[BACKFILL] claude CLI failed (${exitCode}): ${stderr.slice(0, 200)}`);
    return results;
  }

  // Parse JSON from output (handle possible markdown fences)
  let cleaned = output.trim();
  cleaned = cleaned.replace(/^```json?\n?/, "").replace(/\n?```$/, "");

  try {
    const parsed = JSON.parse(cleaned);
    for (const [id, title] of Object.entries(parsed)) {
      if (typeof title === "string" && title.length > 0 && title.length <= 80) {
        results.set(id, title);
      }
    }
  } catch (e) {
    console.error(`[BACKFILL] Failed to parse response: ${(e as Error).message}`);
    console.error(`[BACKFILL] Raw output: ${cleaned.slice(0, 300)}`);
  }

  return results;
}

function writeSummaries(titles: Map<string, string>, sessions: UnnamedSession[]) {
  // Group by index file
  const byIndex = new Map<string, Map<string, string>>();
  for (const session of sessions) {
    const title = titles.get(session.sessionId);
    if (!title) continue;
    if (!byIndex.has(session.indexPath)) {
      byIndex.set(session.indexPath, new Map());
    }
    byIndex.get(session.indexPath)!.set(session.sessionId, title);
  }

  for (const [indexPath, sessionTitles] of byIndex) {
    try {
      const data: SessionsIndex = JSON.parse(readFileSync(indexPath, "utf-8"));
      let updated = 0;

      for (const entry of data.entries) {
        const title = sessionTitles.get(entry.sessionId);
        if (title && !entry.summary) {
          entry.summary = title;
          updated++;
        }
      }

      if (updated > 0) {
        const tmpPath = join(tmpdir(), `sessions-index-${randomUUID()}.json`);
        writeFileSync(tmpPath, JSON.stringify(data, null, 2) + "\n");
        renameSync(tmpPath, indexPath);
        console.log(`  Updated ${updated} entries in ${indexPath.split("/").slice(-2).join("/")}`);
      }
    } catch (e) {
      console.error(`[BACKFILL] Failed to update ${indexPath}: ${(e as Error).message}`);
    }
  }
}

async function main() {
  console.log("[BACKFILL] Collecting unnamed sessions...");
  const unnamed = collectUnnamed();
  console.log(`[BACKFILL] Found ${unnamed.length} unnamed sessions`);

  if (unnamed.length === 0) {
    console.log("[BACKFILL] Nothing to do!");
    return;
  }

  if (DRY_RUN) {
    console.log("[BACKFILL] DRY RUN — showing first 10:");
    for (const s of unnamed.slice(0, 10)) {
      console.log(`  ${s.sessionId.slice(0, 8)}... → "${s.firstPrompt.slice(0, 60)}"`);
    }
    return;
  }

  const batches = Math.ceil(unnamed.length / BATCH_SIZE);
  console.log(`[BACKFILL] Processing in ${batches} batches of ${BATCH_SIZE}...`);

  let totalNamed = 0;
  for (let i = 0; i < batches; i++) {
    const batch = unnamed.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
    console.log(`\n[BACKFILL] Batch ${i + 1}/${batches} (${batch.length} sessions)...`);

    const titles = await generateTitlesBatch(batch);
    console.log(`  Generated ${titles.size} titles`);

    if (titles.size > 0) {
      writeSummaries(titles, batch);
      totalNamed += titles.size;
    }
  }

  console.log(`\n[BACKFILL] Done! Named ${totalNamed} out of ${unnamed.length} sessions.`);
}

main();
