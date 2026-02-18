#!/usr/bin/env bun
/**
 * Weekly Review Generator
 *
 * Generates a weekly review by analyzing the past 7 days:
 * - Daily briefs (updates, relationships, risks)
 * - Daily todos (completion rate)
 * - Goals from Goals.md
 * - Granola meeting summaries
 *
 * Usage:
 *   bun run generate-review.ts              # Print instructions for using /review skill
 *   bun run generate-review.ts --context-only  # Output context to stdout
 *
 * For Claude Code integration, use run-review-cc.sh or the /review skill.
 */

import { existsSync } from 'fs';
import { join } from 'path';
import {
  gatherWeeklyData,
  formatContext,
  getWeekInfo,
  getReviewTargetDate,
  formatDateRange,
  getFullContext,
  REVIEW_SYSTEM_PROMPT,
} from './gather-review-context';

// Configuration - use env vars with defaults
const VAULT_PATH = process.env.VAULT_PATH || '';
const REVIEWS_PATH = join(VAULT_PATH, '0 - Weekly Reviews');

/**
 * Check if review already exists for the current week
 */
function checkExistingReview(): { exists: boolean; path: string } {
  const { year, week } = getWeekInfo(getReviewTargetDate());
  const weekNum = String(week).padStart(2, '0');
  const reviewPath = join(REVIEWS_PATH, `${year}-W${weekNum}.md`);
  return { exists: existsSync(reviewPath), path: reviewPath };
}

/**
 * Print stats about gathered data
 */
function printStats(): void {
  const data = gatherWeeklyData();
  const { year, week, weekStart, weekEnd } = getWeekInfo(getReviewTargetDate());
  const dateRange = formatDateRange(weekStart, weekEnd);

  const briefCount = data.dailyData.filter(d => d.brief).length;
  const todoCount = data.dailyData.filter(d => d.todo).length;
  const completionRate = data.todoStats.total > 0
    ? Math.round((data.todoStats.completed / data.todoStats.total) * 100)
    : 0;

  console.log(`Weekly Review - Week ${week} (${dateRange}, ${year})`);
  console.log('─'.repeat(50));
  console.log(`Daily briefs: ${briefCount}`);
  console.log(`Daily todos: ${todoCount}`);
  console.log(`Meeting summaries: ${data.meetingSummaries.length}`);
  console.log(`Tasks: ${data.todoStats.completed}/${data.todoStats.total} completed (${completionRate}%)`);
}

/**
 * Main function
 */
export async function runWeeklyReview(options?: {
  silent?: boolean;
  contextOnly?: boolean;
}): Promise<{ success: boolean; path?: string; error?: string; context?: string }> {
  const silent = options?.silent || false;
  const contextOnly = options?.contextOnly || false;

  // Context-only mode: output context to stdout and exit
  if (contextOnly) {
    const context = getFullContext();
    console.log(context);
    return { success: true, context };
  }

  // Check if review already exists
  const { exists, path } = checkExistingReview();
  if (exists) {
    if (!silent) console.log(`Review already exists: ${path}`);
    return { success: true, path };
  }

  // Print stats and instructions
  if (!silent) {
    printStats();
    console.log('─'.repeat(50));
    console.log('\nTo generate the weekly review, use one of these methods:\n');
    console.log('  1. Claude Code skill (recommended):');
    console.log('     /review\n');
    console.log('  2. Shell script:');
    console.log('     ./run-review-cc.sh\n');
    console.log('  3. Manual with context:');
    console.log('     bun run generate-review.ts --context-only > /tmp/review-context.md');
    console.log('     claude -p "Read /tmp/review-context.md and generate weekly review"');
  }

  return { success: true };
}

// CLI execution
if (import.meta.main) {
  const args = process.argv.slice(2);
  const contextOnly = args.includes('--context-only');

  runWeeklyReview({ contextOnly })
    .then(result => {
      if (!result.success) {
        console.error(`\nError: ${result.error}`);
        process.exit(1);
      }
      process.exit(0);
    })
    .catch(err => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}
