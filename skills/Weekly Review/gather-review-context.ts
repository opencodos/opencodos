#!/usr/bin/env bun
/**
 * Weekly Review Context Gatherer
 *
 * Gathers and formats all context needed for weekly review:
 * - Daily briefs (updates, relationships, risks)
 * - Daily todos (completion rate)
 * - Goals from Goals.md
 * - Granola meeting summaries
 *
 * Outputs formatted markdown to stdout for piping to Claude.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';

// Configuration - use env vars with defaults (portable)
const HOME = process.env.HOME || require('os').homedir();
const VAULT_PATH = process.env.VAULT_PATH || `${HOME}/Documents/Obsidian Vault`;
const BRIEFS_PATH = join(VAULT_PATH, '0 - Daily Briefs');
const TODOS_PATH = join(VAULT_PATH, '3 - Todos');
const CORE_MEMORY_PATH = join(VAULT_PATH, 'Core Memory');
const INBOX_PATH = join(VAULT_PATH, '1 - Inbox (Last 7 days)');

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
 * Get the date to use for weekly review calculation.
 * - On Sunday: review current week (Mon-Sun just ending)
 * - On Mon-Sat: review previous week (so we review the completed week)
 */
export function getReviewTargetDate(): Date {
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat

  if (dayOfWeek === 0) {
    // Sunday - review this week
    return today;
  } else {
    // Mon-Sat - review last week (go back to last Sunday)
    const daysBack = dayOfWeek; // Go back to last Sunday
    const lastSunday = new Date(today);
    lastSunday.setDate(today.getDate() - daysBack);
    return lastSunday;
  }
}

/**
 * Get ISO week number/year and week bounds (Mon-Sun) for a date
 */
export function getWeekInfo(date: Date): { year: number; week: number; weekStart: Date; weekEnd: Date } {
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);

  // ISO week is based on Thursday
  const day = (target.getDay() + 6) % 7; // Mon=0..Sun=6
  const thursday = new Date(target);
  thursday.setDate(target.getDate() - day + 3);

  const isoYear = thursday.getFullYear();
  const jan4 = new Date(isoYear, 0, 4);
  const jan4Day = (jan4.getDay() + 6) % 7;
  const week1Monday = new Date(jan4);
  week1Monday.setDate(jan4.getDate() - jan4Day);
  week1Monday.setHours(0, 0, 0, 0);

  const weekStart = new Date(target);
  weekStart.setDate(target.getDate() - day);
  weekStart.setHours(0, 0, 0, 0);

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);

  const week = Math.floor((weekStart.getTime() - week1Monday.getTime()) / 604800000) + 1;

  return { year: isoYear, week, weekStart, weekEnd };
}

/**
 * Get dates for the past 7 days (including today)
 */
export function getWeekDates(): string[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const dates: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    dates.push(formatLocalDate(date));
  }

  return dates;
}

/**
 * Format date range for display
 */
export function formatDateRange(weekStart: Date, weekEnd: Date): string {
  const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const start = weekStart.toLocaleDateString('en-US', options);
  const end = weekEnd.toLocaleDateString('en-US', options);
  return `${start} - ${end}`;
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

export interface DailyData {
  date: string;
  brief: string | null;
  todo: string | null;
}

export interface TodoStats {
  total: number;
  completed: number;
  uncompleted: string[];
}

export interface WeeklyData {
  dailyData: DailyData[];
  aboutMe: string | null;
  goals: string | null;
  briefFeedback: string | null;
  meetingSummaries: string[];
  todoStats: TodoStats;
}

/**
 * Gather data for the week
 */
export function gatherWeeklyData(): WeeklyData {
  const dates = getWeekDates();
  const dailyData: DailyData[] = [];

  // Gather daily briefs and todos
  for (const date of dates) {
    dailyData.push({
      date,
      brief: readIfExists(join(BRIEFS_PATH, `${date}.md`)),
      todo: readIfExists(join(TODOS_PATH, `${date}.md`)),
    });
  }

  // About Me (background/preferences) and Goals (separate file)
  const aboutMe = readIfExists(join(CORE_MEMORY_PATH, 'About me.md'));
  const goals = readIfExists(join(CORE_MEMORY_PATH, 'Goals.md'));

  // Brief Feedback (quality rules)
  const briefFeedback = readIfExists(join(CORE_MEMORY_PATH, 'Brief Feedback.md'));

  // Granola meeting summaries from the past 7 days
  const meetingSummaries: string[] = [];
  const summariesPath = join(INBOX_PATH, 'Granola/Summaries');

  if (existsSync(summariesPath)) {
    // Past 7 days window
    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(now.getDate() - 7);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    try {
      const files = readdirSync(summariesPath)
        .filter(f => f.endsWith('.md'))
        .sort()
        .reverse();

      for (const file of files) {
        const filePath = join(summariesPath, file);
        const stat = statSync(filePath);
        const fileDate = new Date(stat.mtime);

        if (fileDate >= sevenDaysAgo && fileDate <= now) {
          const content = readFileSync(filePath, 'utf-8');
          meetingSummaries.push(`### ${basename(file, '.md')}\n${content.slice(0, 2000)}`);
        }

        // Limit to 10 summaries
        if (meetingSummaries.length >= 10) break;
      }
    } catch {
      // Skip if can't read
    }
  }

  // Calculate todo stats
  const todoStats: TodoStats = { total: 0, completed: 0, uncompleted: [] };

  for (const day of dailyData) {
    if (day.todo) {
      const lines = day.todo.split('\n');
      for (const line of lines) {
        // Match checked items: [x]
        if (line.match(/^\s*-\s*\[x\]/i)) {
          todoStats.total++;
          todoStats.completed++;
        }
        // Match unchecked items: [ ]
        else if (line.match(/^\s*-\s*\[ \]/)) {
          todoStats.total++;
          const item = line.replace(/^\s*-\s*\[ \]\s*/, '').trim();
          if (item) {
            todoStats.uncompleted.push(item);
          }
        }
      }
    }
  }

  return { dailyData, aboutMe, goals, briefFeedback, meetingSummaries, todoStats };
}

/**
 * Format context as markdown for Claude to process
 */
export function formatContext(data: WeeklyData): string {
  const parts: string[] = [];

  // Goals (from Goals.md)
  if (data.goals) {
    parts.push(`## Goals\n${data.goals}`);
  }

  // About Me (background/preferences)
  if (data.aboutMe) {
    parts.push(`## About Me\n${data.aboutMe}`);
  }

  // Brief Feedback (quality rules)
  if (data.briefFeedback) {
    parts.push(`## Quality Rules (follow these)\n${data.briefFeedback}`);
  }

  // Daily briefs
  const briefsWithContent = data.dailyData.filter(d => d.brief);
  if (briefsWithContent.length > 0) {
    parts.push(`## Daily Briefs (${briefsWithContent.length} days)`);
    for (const day of briefsWithContent) {
      parts.push(`### ${day.date}\n${day.brief!.slice(0, 3000)}`);
    }
  }

  // Daily todos
  const todosWithContent = data.dailyData.filter(d => d.todo);
  if (todosWithContent.length > 0) {
    parts.push(`## Daily Todos (${todosWithContent.length} days)`);
    for (const day of todosWithContent) {
      parts.push(`### ${day.date}\n${day.todo!.slice(0, 2000)}`);
    }
  }

  // Meeting summaries
  if (data.meetingSummaries.length > 0) {
    parts.push(`## Key Meetings This Week\n${data.meetingSummaries.join('\n\n')}`);
  }

  // Todo stats
  parts.push(`## Task Completion Stats
- Total tasks: ${data.todoStats.total}
- Completed: ${data.todoStats.completed}
- Completion rate: ${data.todoStats.total > 0 ? Math.round((data.todoStats.completed / data.todoStats.total) * 100) : 0}%

### Uncompleted Tasks
${data.todoStats.uncompleted.slice(0, 20).map(t => `- ${t}`).join('\n') || '(none)'}`);

  return parts.join('\n\n');
}

/**
 * The weekly review system prompt - exported for use by other modules
 */
export const REVIEW_SYSTEM_PROMPT = `You are generating a Weekly Review for the user. This is a reflection document, NOT a todo list.

## Output Format (follow exactly)

# Weekly Review — Week {WEEK_NUM} ({DATE_RANGE}, {YEAR})

## a) Good Last Week
- [Specific wins with measurable outcomes]
- [Progress made on key goals]
- [Positive relationship developments]

## b) Bad Last Week
- [Hard truths - missed commitments, dropped balls]
- [Things that didn't work as planned]
- [Time wasted or poor decisions]

## c) Key Learnings
- **[Learning title]** - [How to apply going forward]
- Focus on actionable insights, not abstract realizations

## d) Open Questions
- [Strategic questions without obvious answers]
- [Decisions that need more data]
- NOT action items - these are genuine uncertainties to sit with

## e) Progress Towards Goals

### Short-term Goals
| Goal | Status | Evidence |
|------|--------|----------|
| [Goal from About me.md] | [On track / Behind / Blocked / Done] | [Specific evidence] |

### 2026 Goals
| Goal | This Week | Gap to Target |
|------|-----------|---------------|
| [Goal from About me.md] | [What happened] | [How far from target] |

## Metrics
- Tasks: X/Y completed (Z%)
- Key meetings: [list with outcomes]
- Revenue progress: [if applicable]

---
Generated by Atlas

## Rules

1. **Be brutally honest** in section b). No sugar-coating failures.
2. **Be specific** - use names, numbers, quotes from the data.
3. **Learnings must be actionable** - "I learned X, so I will Y"
4. **Open questions are NOT todos** - they're genuine strategic uncertainties.
5. **Goal progress must cite evidence** - don't guess, use data from briefs/todos.
6. **Max 5 items per section** - prioritize the most significant.
7. **Celebrate real wins** - but only things that actually moved the needle.`;

/**
 * Get full context with metadata header
 */
export function getFullContext(): string {
  const { year, week, weekStart, weekEnd } = getWeekInfo(getReviewTargetDate());
  const dateRange = formatDateRange(weekStart, weekEnd);
  const data = gatherWeeklyData();
  const context = formatContext(data);

  const header = `# Weekly Review Context

**Week:** ${week} (${dateRange}, ${year})
**Generated:** ${new Date().toISOString()}

---

`;

  return header + context;
}

// CLI execution - output context to stdout
if (import.meta.main) {
  const context = getFullContext();
  console.log(context);
}
