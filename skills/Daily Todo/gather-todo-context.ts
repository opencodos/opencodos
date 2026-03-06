#!/usr/bin/env bun
/**
 * Todo Context Gatherer
 *
 * Gathers all context needed for daily todo generation:
 * - Unchecked items from last todo (carryover)
 * - Today's morning brief
 * - Calendar events (today + 7 days)
 * - Recent Granola call summaries
 * - Recent Telegram summaries
 * - Core Memory files (Brief Feedback, Fears, Principles)
 * - Velocity metrics
 *
 * Outputs formatted markdown to stdout for Claude Code to process.
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { updateMetrics, formatVelocityContext, type VelocityContext } from './velocity-tracker';

// Configuration - use env vars with defaults (portable)
const HOME = process.env.HOME || require('os').homedir();
const VAULT_PATH = process.env.VAULT_PATH || `${HOME}/Documents/Obsidian Vault`;
const TODOS_PATH = join(VAULT_PATH, '3 - Todos');
const BRIEFS_PATH = join(VAULT_PATH, '0 - Daily Briefs');
const INBOX_PATH = join(VAULT_PATH, '1 - Inbox (Last 7 days)');
const CORE_MEMORY_PATH = join(VAULT_PATH, 'Core Memory');

/**
 * Format date as YYYY-MM-DD in local timezone
 */
export function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Get today's date
 */
export function getToday(): string {
  return formatLocalDate(new Date());
}

/**
 * Read file if it exists
 */
export function readIfExists(path: string): string | null {
  if (existsSync(path)) {
    return readFileSync(path, 'utf-8');
  }
  return null;
}

/**
 * Find the most recent todo file (searches back up to 14 days)
 */
export function findLastTodoFile(): { path: string; date: string } | null {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 1; i <= 14; i++) {
    const checkDate = new Date(today);
    checkDate.setDate(today.getDate() - i);
    const dateStr = formatLocalDate(checkDate);
    const todoPath = join(TODOS_PATH, `${dateStr}.md`);

    if (existsSync(todoPath)) {
      return { path: todoPath, date: dateStr };
    }
  }

  return null;
}

/**
 * Extract unchecked items from a todo file
 */
export function extractUncheckedItems(content: string): string[] {
  const lines = content.split('\n');
  const unchecked: string[] = [];

  for (const line of lines) {
    // Match lines with unchecked boxes: - [ ] or - - [ ]
    const match = line.match(/^[\s-]*\[ \]\s*(.+)$/);
    if (match) {
      unchecked.push(match[1].trim());
    }
  }

  return unchecked;
}

/**
 * Read calendar data from inbox for today + next 7 days
 */
export function readCalendarData(): string | null {
  const calendarPath = join(INBOX_PATH, 'Calendar');
  if (!existsSync(calendarPath)) return null;

  const today = new Date();
  const calendarContent: string[] = [];

  // Read today + next 7 days
  for (let i = 0; i < 7; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    const dateStr = formatLocalDate(date);
    const filePath = join(calendarPath, `${dateStr}.md`);

    if (existsSync(filePath)) {
      const content = readFileSync(filePath, 'utf-8');
      // Only include if there are events (not "No events scheduled")
      if (!content.includes('No events scheduled')) {
        calendarContent.push(content);
      }
    }
  }

  if (calendarContent.length === 0) {
    return null;
  }

  return calendarContent.join('\n\n---\n\n');
}

/**
 * Read recent Granola call summaries (last 7 days)
 */
export function readRecentGranolaSummaries(): string | null {
  const summariesPath = join(INBOX_PATH, 'Granola/Summaries');
  if (!existsSync(summariesPath)) return null;

  try {
    const files = readdirSync(summariesPath)
      .filter(f => f.endsWith('.md'))
      .sort()
      .reverse()
      .slice(0, 10); // Last 10 summaries

    if (files.length === 0) return null;

    const summaries: string[] = [];
    for (const file of files) {
      const content = readFileSync(join(summariesPath, file), 'utf-8');
      // Extract just the key parts: TL;DR, Action Items, Notable Quotes
      const title = file.replace('.md', '').replace(/_/g, ' ');
      summaries.push(`### ${title}\n${content.slice(0, 1500)}`);
    }

    return summaries.join('\n\n');
  } catch {
    return null;
  }
}

/**
 * Read last 2 Telegram Daily Summaries
 */
export function readRecentTelegramSummaries(): string | null {
  const summaryDir = join(INBOX_PATH, 'Telegram/Daily Summary');
  if (!existsSync(summaryDir)) return null;

  try {
    const files = readdirSync(summaryDir)
      .filter(f => f.match(/^\d{4}-\d{2}-\d{2}\.md$/))
      .sort()
      .reverse()
      .slice(0, 2);

    if (files.length === 0) return null;

    return files.map(f => {
      const date = f.replace('.md', '');
      const content = readFileSync(join(summaryDir, f), 'utf-8');
      return `## Telegram Summary - ${date}\n${content}`;
    }).join('\n\n---\n\n');
  } catch {
    return null;
  }
}

/**
 * Read Core Memory files
 */
export function readCoreMemory(): {
  briefFeedback: string | null;
  myFears: string | null;
  principles: string | null;
} {
  return {
    briefFeedback: readIfExists(join(CORE_MEMORY_PATH, 'Brief Feedback.md')),
    myFears: readIfExists(join(CORE_MEMORY_PATH, 'My fears.md')),
    principles: readIfExists(join(CORE_MEMORY_PATH, 'Principles and Life Lessons.md'))
  };
}

/**
 * Get velocity context for adaptive task limits
 */
export function getVelocity(): VelocityContext | null {
  try {
    return updateMetrics();
  } catch {
    return null;
  }
}

/**
 * Gather all context and format as markdown
 */
export function gatherAllContext(options?: {
  includeCarryover?: boolean;
  verbose?: boolean;
}): string {
  const includeCarryover = options?.includeCarryover ?? true;
  const verbose = options?.verbose ?? false;
  const today = getToday();

  const contextParts: string[] = [];

  // Header
  contextParts.push(`# Todo Context for ${today}`);
  contextParts.push('');

  // 1. Core Memory - Brief Feedback rules go first
  const coreMemory = readCoreMemory();
  if (coreMemory.briefFeedback) {
    contextParts.push(`## IMPORTANT: Brief Quality Rules (follow these exactly)\n${coreMemory.briefFeedback}`);
    if (verbose) console.error('  - Brief Feedback: loaded');
  }

  if (coreMemory.myFears) {
    contextParts.push(`## My Fears (consider these when prioritizing)\n${coreMemory.myFears}`);
    if (verbose) console.error('  - My fears: loaded');
  }

  if (coreMemory.principles) {
    contextParts.push(`## Principles & Life Lessons (guide decision-making)\n${coreMemory.principles}`);
    if (verbose) console.error('  - Principles: loaded');
  }

  // 2. Recent Communications - CRITICAL for context-aware messages
  const granolaSummaries = readRecentGranolaSummaries();
  const telegramSummaries = readRecentTelegramSummaries();

  if (granolaSummaries || telegramSummaries) {
    contextParts.push(`## Recent Communications (CHECK BEFORE WRITING ANY MESSAGE)`);
    if (granolaSummaries) {
      contextParts.push(`### Recent Calls (Granola)\n${granolaSummaries}`);
      if (verbose) console.error('  - Granola summaries: loaded');
    }
    if (telegramSummaries) {
      contextParts.push(`### Recent Telegram Summaries\n${telegramSummaries}`);
      if (verbose) console.error('  - Telegram summaries: loaded');
    }
  }

  // 3. Carryover items from last todo
  if (includeCarryover) {
    const lastTodo = findLastTodoFile();
    if (lastTodo) {
      const lastTodoContent = readFileSync(lastTodo.path, 'utf-8');
      const uncheckedItems = extractUncheckedItems(lastTodoContent);

      if (uncheckedItems.length > 0) {
        contextParts.push(`## CRITICAL: Unchecked items from ${lastTodo.date} (MUST incorporate all open tasks)\n${uncheckedItems.map(i => `- ${i}`).join('\n')}`);
        if (verbose) console.error(`  - Carryover from ${lastTodo.date}: ${uncheckedItems.length} items`);
      }
    }
  }

  // 4. Calendar data
  const calendarData = readCalendarData();
  if (calendarData) {
    contextParts.push(`## Today's calendar\n${calendarData}`);
    if (verbose) console.error('  - Calendar data: loaded');
  }

  // 5. Today's morning brief
  const briefPath = join(BRIEFS_PATH, `${today}.md`);
  const briefContent = readIfExists(briefPath);
  if (briefContent) {
    contextParts.push(`## Today's morning brief (extract specific actions from Key Relationships)\n${briefContent}`);
    if (verbose) console.error('  - Morning brief: loaded');
  }

  // 6. Velocity context
  const velocityContext = getVelocity();
  if (velocityContext) {
    contextParts.push(formatVelocityContext(velocityContext));
    if (verbose) {
      console.error(`  - Velocity: ${velocityContext.last7DaysCompletion}% completion`);
      console.error(`  - Target tasks: ${velocityContext.targetTasks}`);
    }
  }

  // Footer with instructions
  contextParts.push('');
  contextParts.push('---');
  contextParts.push('');
  contextParts.push(`Generate today's todo list for ${today}. Remember: EVERY item must have [[double brackets]] with specific executable content. Messages must include actual text in recipient's language.`);

  return contextParts.join('\n\n');
}

// CLI execution
if (import.meta.main) {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose') || args.includes('-v');
  const noCarryover = args.includes('--no-carryover');

  if (verbose) {
    console.error('Gathering todo context...');
  }

  const context = gatherAllContext({
    includeCarryover: !noCarryover,
    verbose
  });

  // Output to stdout (for piping to Claude Code)
  console.log(context);

  if (verbose) {
    console.error('\nContext gathering complete.');
  }
}
