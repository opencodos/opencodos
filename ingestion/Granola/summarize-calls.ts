#!/usr/bin/env bun
/**
 * Granola Call Summarization Script
 *
 * Summarizes new call transcripts using Claude Code CLI (CC subscription)
 * and saves summaries to Vault/1 - Inbox/Granola/Summaries/
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';
import { logEvent, logError } from './logging';
import { getInboxDir, getUserName } from '../lib/paths';

// Configuration — resolve paths from ~/.codos/paths.json
const CALLS_PATH = getInboxDir('Granola');
const SUMMARIES_PATH = join(CALLS_PATH, 'Summaries');

interface SummaryResult {
  summarized: number;
  skipped: number;
  errors: string[];
}

/**
 * Get list of call directories that need summarization
 */
function getUnsummarizedCalls(): string[] {
  if (!existsSync(CALLS_PATH)) return [];

  const allDirs = readdirSync(CALLS_PATH, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== 'Summaries')
    .map(d => d.name);

  // Check which ones already have summaries
  const existingSummaries = new Set<string>();
  if (existsSync(SUMMARIES_PATH)) {
    readdirSync(SUMMARIES_PATH)
      .filter(f => f.endsWith('.md'))
      .forEach(f => existingSummaries.add(f.replace('.md', '')));
  }

  return allDirs.filter(dir => !existingSummaries.has(dir));
}

/**
 * Read transcript from a call directory
 */
function readTranscript(callDir: string): { title: string; transcript: string; metadata: any } | null {
  const transcriptPath = join(CALLS_PATH, callDir, 'transcript.md');
  const metadataPath = join(CALLS_PATH, callDir, 'metadata.json');

  if (!existsSync(transcriptPath)) return null;

  const transcript = readFileSync(transcriptPath, 'utf-8');
  const metadata = existsSync(metadataPath)
    ? JSON.parse(readFileSync(metadataPath, 'utf-8'))
    : { title: callDir };

  return {
    title: metadata.title || callDir,
    transcript,
    metadata
  };
}

/**
 * Build the summarization prompt
 */
function buildPrompt(title: string, transcript: string, metadata: any): string {
  return `You are summarizing a meeting transcript for ${getUserName()}'s personal AI assistant (Atlas). Create a concise, actionable summary with extracted next steps.

## Meeting Info
- Title: ${title}
- Date: ${metadata.date || 'Unknown'}
- Attendees: ${metadata.attendees?.join(', ') || 'Unknown'}

## Transcript
${transcript}

## Instructions
Create a summary with these sections:

### Part 1: Meeting Summary
1. **TL;DR** - 1-2 sentence overview. If call was short/interrupted, still capture what WAS communicated.
2. **Key Points** - Main topics discussed (bullet points)
3. **Action Items** - Any tasks, commitments, or follow-ups mentioned (format as checkboxes: - [ ] Task)
4. **Decisions Made** - CRITICAL: Capture any YES/NO decisions, even if implicit:
   - Did someone agree or decline to join/help/invest?
   - Did someone commit or refuse?
   - Even "I need more time" is a decision (decision: still pending)
   - For interrupted calls: What was the LAST substantive thing said before interruption?

   **IMPORTANT about interrupted/abrupt calls:** If a call ended abruptly (technical issues, interruption, someone had to go), do NOT create action items like "follow up" or "reschedule". Assume the user already handled this separately via Telegram/text. Only note what was actually communicated during the call itself.
5. **Notable Quotes** - 1-2 important quotes, especially any that indicate decisions or relationship changes

### Part 2: Atlas Next Steps (IMPORTANT)
Extract actionable intelligence for the user's system:

**CRM Updates**
List people mentioned and what should be updated about them in the user's CRM. Format as a table:
| Person | Update |
|--------|--------|
| Name | What changed: status, relationship, new info about them |

Only include people where there's meaningful new information (status changes, decisions, new context). Skip if nothing notable.

**Tasks to Add**
Extract tasks that the user committed to or needs to follow up on. Be specific with deadlines if mentioned:
- [ ] Task description (deadline if mentioned)

Include:
- Explicit commitments ("I will...", "I'll send you...")
- Requests received ("Can you...", "Please...")
- Follow-up triggers ("let me know", "reach out to...")
- Implicit next steps based on discussion

**Memory Updates**
New facts worth remembering about people, companies, or situations:
- Fact 1
- Fact 2

Keep it concise and actionable. Use markdown formatting.`;
}

/**
 * Run Claude CLI to summarize transcript (uses CC subscription like morning brief)
 *
 * IMPORTANT: When spawning claude from Node/Bun, you MUST:
 * 1. Close stdin (stdio: ['ignore', ...]) - otherwise claude hangs waiting for input
 * 2. Use --setting-sources '' - otherwise it loads CLAUDE.md and tries to read context files
 * 3. Use --permission-mode bypassPermissions - to run non-interactively
 */
async function runClaude(prompt: string, timeoutSec: number = 600): Promise<string> {
  const args = [
    '-p', prompt,
    '--model', 'sonnet',
    '--allowedTools', '',
    '--permission-mode', 'bypassPermissions',
    '--setting-sources', '',  // REQUIRED: Skip CLAUDE.md to avoid context loading delays
  ];

  // Unset ANTHROPIC_API_KEY to force CC subscription (not API credits)
  const env = { ...process.env } as Record<string, string>;
  delete env.ANTHROPIC_API_KEY;

  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, {
      env,
      cwd: '/tmp',
      stdio: ['ignore', 'pipe', 'pipe'],  // REQUIRED: Close stdin to prevent hanging
    });
    let output = '';
    let error = '';

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Claude timed out after ${timeoutSec}s`));
    }, timeoutSec * 1000);

    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      error += chunk.toString();
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(output.trim());
      } else {
        reject(new Error(error || `Claude exited with code ${code}`));
      }
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function summarizeWithRetry(
  title: string,
  transcript: string,
  metadata: any,
  maxAttempts: number = 3
): Promise<string> {
  const prompt = buildPrompt(title, transcript, metadata);
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (attempt > 1) {
        const baseDelay = 5000 * Math.pow(2, attempt - 2); // 5s, 10s, 20s
        const jitter = Math.floor(Math.random() * 1000);
        await sleep(baseDelay + jitter);
      }
      return await runClaude(prompt);
    } catch (err) {
      lastError = err;
      logEvent({
        level: 'warn',
        component: 'granola-summarize',
        stage: 'summarize',
        message: `Attempt ${attempt}/${maxAttempts} failed`,
        error: err instanceof Error ? err.message : String(err),
        data: { title },
      });
    }
  }
  throw lastError;
}

/**
 * Main summarization function
 */
export async function summarizeCalls(options?: {
  specific?: string[];  // Specific call dirs to summarize
  silent?: boolean;
  throwOnError?: boolean;
}): Promise<SummaryResult> {
  const silent = options?.silent || false;
  const throwOnError = options?.throwOnError || false;

  const result: SummaryResult = {
    summarized: 0,
    skipped: 0,
    errors: []
  };

  // Get calls to summarize
  const callsToSummarize = options?.specific || getUnsummarizedCalls();

  if (callsToSummarize.length === 0) {
    if (!silent) console.log('📝 No new calls to summarize');
    return result;
  }

  if (!silent) console.log(`📝 Summarizing ${callsToSummarize.length} calls...`);

  // Create summaries directory
  if (!existsSync(SUMMARIES_PATH)) {
    mkdirSync(SUMMARIES_PATH, { recursive: true });
  }

  for (const callDir of callsToSummarize) {
    const data = readTranscript(callDir);

    if (!data) {
      if (!silent) console.log(`  ⏭️  ${callDir}: No transcript`);
      result.skipped++;
      continue;
    }

    if (!silent) console.log(`  📄 ${data.title}`);

    try {
      const summary = await summarizeWithRetry(
        data.title,
        data.transcript,
        data.metadata
      );

      // Save summary
      const summaryContent = `# Summary: ${data.title}

**Date:** ${data.metadata.date || 'Unknown'}
**Attendees:** ${data.metadata.attendees?.join(', ') || 'Unknown'}

---

${summary}

---
*Auto-generated from Granola transcript via Claude Code*
`;

      writeFileSync(join(SUMMARIES_PATH, `${callDir}.md`), summaryContent);
      result.summarized++;

    } catch (err: any) {
      if (!silent) console.error(`  ❌ Error: ${err.message}`);
      result.errors.push(`${data.title}: ${err.message}`);
      logError('granola-summarize', 'Failed to summarize transcript', err, 'summarize', {
        title: data.title,
      });
    }
  }

  if (!silent) {
    console.log(`\n✅ Summarized ${result.summarized} calls`);
  }

  if (throwOnError && result.errors.length > 0) {
    throw new Error(`Summarization failed for ${result.errors.length} calls`);
  }

  return result;
}

// CLI execution
if (import.meta.main) {
  summarizeCalls()
    .then(result => {
      if (result.errors.length > 0) {
        console.error('\n⚠️ Errors:');
        result.errors.forEach(err => console.error(`  - ${err}`));
      }
      process.exit(result.errors.length > 0 ? 1 : 0);
    })
    .catch(err => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}
