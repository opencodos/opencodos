#!/usr/bin/env bun
/**
 * Todo Velocity Tracker
 *
 * Tracks daily todo completion metrics:
 * - Created, completed, carried, dropped counts
 * - By bucket (Deep Work, Comms, Long Tail)
 * - Zombie tasks (carried 3+ days)
 * - 7-day rolling completion rates
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';

// Paths
const VAULT_PATH = process.env.VAULT_PATH || '';
const CODOS_PATH = process.env.CODOS_PATH || '';
const TODOS_PATH = join(VAULT_PATH, '3 - Todos');
const METRICS_PATH = join(CODOS_PATH, 'dev/Ops/atlas/todo-metrics.json');
const STATE_PATH = join(CODOS_PATH, 'dev/Ops/atlas');

// Types
export interface DailyMetrics {
  date: string;
  created: number;
  completed: number;
  carried: number;
  dropped: number;
  byBucket: {
    deepWork: { created: number; completed: number; carried: number };
    comms: { created: number; completed: number; carried: number };
    longTail: { created: number; completed: number; carried: number };
    fearWork: { created: number; completed: number; carried: number };
  };
  zombieTasks: string[];  // Tasks carried 3+ days
}

export interface TodoMetricsState {
  lastUpdated: string;
  dailyMetrics: DailyMetrics[];
  taskHistory: {
    [taskHash: string]: {
      text: string;
      firstSeen: string;
      lastSeen: string;
      daysCarried: number;
      bucket: string;
      completed: boolean;
    };
  };
}

export interface VelocityContext {
  last7DaysCompletion: number;
  byBucket: {
    deepWork: number;
    comms: number;
    longTail: number;
    fearWork: number;
  };
  zombieTasks: Array<{ text: string; days: number }>;
  recommendation: string;
  targetTasks: number;
}

/**
 * Create a hash for a task to track it across days
 */
function taskHash(text: string): string {
  // Normalize the text for hashing
  const normalized = text
    .toLowerCase()
    .replace(/\[\[.*?\]\]/g, '') // Remove double brackets
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);

  // Simple hash
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).slice(0, 8);
}

/**
 * Load metrics state
 */
export function loadMetrics(): TodoMetricsState {
  if (existsSync(METRICS_PATH)) {
    try {
      return JSON.parse(readFileSync(METRICS_PATH, 'utf-8'));
    } catch {
      // Corrupted file, start fresh
    }
  }
  return {
    lastUpdated: new Date().toISOString(),
    dailyMetrics: [],
    taskHistory: {}
  };
}

/**
 * Save metrics state
 */
export function saveMetrics(state: TodoMetricsState): void {
  // Keep only last 30 days of daily metrics
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  state.dailyMetrics = state.dailyMetrics.filter(m => m.date >= cutoffStr);

  // Clean up old task history (not seen in 14 days)
  const historyCutoff = new Date();
  historyCutoff.setDate(historyCutoff.getDate() - 14);
  const historyCutoffStr = historyCutoff.toISOString().split('T')[0];

  for (const [hash, task] of Object.entries(state.taskHistory)) {
    if (task.lastSeen < historyCutoffStr) {
      delete state.taskHistory[hash];
    }
  }

  state.lastUpdated = new Date().toISOString();

  if (!existsSync(STATE_PATH)) {
    mkdirSync(STATE_PATH, { recursive: true });
  }
  writeFileSync(METRICS_PATH, JSON.stringify(state, null, 2));
}

/**
 * Parse a todo file to extract tasks
 */
interface ParsedTask {
  text: string;
  completed: boolean;
  bucket: 'deepWork' | 'comms' | 'longTail' | 'fearWork' | 'other';
  hash: string;
}

export function parseTodoFile(content: string): ParsedTask[] {
  const tasks: ParsedTask[] = [];
  const lines = content.split('\n');

  let currentBucket: ParsedTask['bucket'] = 'other';

  for (const line of lines) {
    // Detect bucket headers
    if (line.match(/^##\s*(🎯|Deep Work|🧠)/i)) {
      currentBucket = 'deepWork';
    } else if (line.match(/^##\s*(📧|Comms|💬|Expected Comms)/i)) {
      currentBucket = 'comms';
    } else if (line.match(/^##\s*(📋|Long Tail|⏳)/i)) {
      currentBucket = 'longTail';
    } else if (line.match(/^##\s*(🛡️|Fear Work)/i)) {
      currentBucket = 'fearWork';
    } else if (line.match(/^##\s*\d+\./)) {
      // Numbered sections like "## 1. System Synthesis" - not a bucket
      currentBucket = 'other';
    }

    // Parse task lines
    const taskMatch = line.match(/^[\s-]*\[([ x])\]\s*(.+)$/i);
    if (taskMatch) {
      const completed = taskMatch[1].toLowerCase() === 'x';
      const text = taskMatch[2].trim();
      const hash = taskHash(text);

      tasks.push({
        text,
        completed,
        bucket: currentBucket,
        hash
      });
    }
  }

  return tasks;
}

/**
 * Compare two todo files to compute metrics
 */
export function computeDailyMetrics(
  previousTasks: ParsedTask[],
  currentTasks: ParsedTask[],
  date: string,
  state: TodoMetricsState
): DailyMetrics {
  const metrics: DailyMetrics = {
    date,
    created: 0,
    completed: 0,
    carried: 0,
    dropped: 0,
    byBucket: {
      deepWork: { created: 0, completed: 0, carried: 0 },
      comms: { created: 0, completed: 0, carried: 0 },
      longTail: { created: 0, completed: 0, carried: 0 },
      fearWork: { created: 0, completed: 0, carried: 0 }
    },
    zombieTasks: []
  };

  const previousHashes = new Set(previousTasks.map(t => t.hash));
  const currentHashes = new Set(currentTasks.map(t => t.hash));

  // Process current tasks
  for (const task of currentTasks) {
    const bucket = task.bucket === 'other' ? 'deepWork' : task.bucket;

    // Update task history
    if (state.taskHistory[task.hash]) {
      const history = state.taskHistory[task.hash];
      history.lastSeen = date;
      if (!previousHashes.has(task.hash)) {
        // Re-appeared after being absent
        history.daysCarried++;
      } else if (!task.completed) {
        history.daysCarried++;
      }
      if (task.completed) {
        history.completed = true;
      }
    } else {
      // New task
      state.taskHistory[task.hash] = {
        text: task.text,
        firstSeen: date,
        lastSeen: date,
        daysCarried: 0,
        bucket: task.bucket,
        completed: task.completed
      };
    }

    // Count metrics
    if (!previousHashes.has(task.hash)) {
      // New task
      metrics.created++;
      metrics.byBucket[bucket].created++;
    } else {
      // Carried from previous
      metrics.carried++;
      metrics.byBucket[bucket].carried++;
    }

    if (task.completed) {
      metrics.completed++;
      metrics.byBucket[bucket].completed++;
    }

    // Check for zombies (carried 3+ days)
    const history = state.taskHistory[task.hash];
    if (history && history.daysCarried >= 3 && !task.completed) {
      metrics.zombieTasks.push(task.text.slice(0, 80));
    }
  }

  // Count dropped tasks (in previous but not in current and not completed)
  for (const task of previousTasks) {
    if (!currentHashes.has(task.hash) && !task.completed) {
      metrics.dropped++;
    }
  }

  return metrics;
}

/**
 * Calculate velocity context for todo generation
 */
export function getVelocityContext(state: TodoMetricsState): VelocityContext {
  const last7 = state.dailyMetrics.slice(-7);

  // Calculate completion rates
  const totals = last7.reduce(
    (acc, m) => ({
      created: acc.created + m.created,
      completed: acc.completed + m.completed,
      deepWork: {
        created: acc.deepWork.created + m.byBucket.deepWork.created,
        completed: acc.deepWork.completed + m.byBucket.deepWork.completed
      },
      comms: {
        created: acc.comms.created + m.byBucket.comms.created,
        completed: acc.comms.completed + m.byBucket.comms.completed
      },
      longTail: {
        created: acc.longTail.created + m.byBucket.longTail.created,
        completed: acc.longTail.completed + m.byBucket.longTail.completed
      },
      fearWork: {
        created: acc.fearWork.created + m.byBucket.fearWork.created,
        completed: acc.fearWork.completed + m.byBucket.fearWork.completed
      }
    }),
    {
      created: 0,
      completed: 0,
      deepWork: { created: 0, completed: 0 },
      comms: { created: 0, completed: 0 },
      longTail: { created: 0, completed: 0 },
      fearWork: { created: 0, completed: 0 }
    }
  );

  const completionRate = totals.created > 0
    ? Math.round((totals.completed / totals.created) * 100)
    : 70; // Default target

  const byBucket = {
    deepWork: totals.deepWork.created > 0
      ? Math.round((totals.deepWork.completed / totals.deepWork.created) * 100)
      : 70,
    comms: totals.comms.created > 0
      ? Math.round((totals.comms.completed / totals.comms.created) * 100)
      : 70,
    longTail: totals.longTail.created > 0
      ? Math.round((totals.longTail.completed / totals.longTail.created) * 100)
      : 70,
    fearWork: totals.fearWork.created > 0
      ? Math.round((totals.fearWork.completed / totals.fearWork.created) * 100)
      : 70
  };

  // Find zombie tasks
  const zombieTasks: Array<{ text: string; days: number }> = [];
  for (const task of Object.values(state.taskHistory)) {
    if (task.daysCarried >= 3 && !task.completed) {
      zombieTasks.push({
        text: task.text.slice(0, 60),
        days: task.daysCarried
      });
    }
  }
  zombieTasks.sort((a, b) => b.days - a.days);

  // Generate recommendation
  let recommendation = '';
  let targetTasks = 10;

  if (completionRate < 50) {
    recommendation = 'Very low completion rate. Max 6 tasks today - focus on high-impact only.';
    targetTasks = 6;
  } else if (completionRate < 70) {
    recommendation = 'Below target completion. Max 8 tasks today.';
    targetTasks = 8;
  } else if (completionRate >= 90) {
    recommendation = 'Excellent velocity! Can add stretch goals if capacity allows.';
    targetTasks = 12;
  } else {
    recommendation = 'On target. Maintain current pace.';
    targetTasks = 10;
  }

  // Add bucket-specific recommendations
  if (byBucket.deepWork < 40) {
    recommendation += ' Deep Work completion is low - reduce scope or break into smaller tasks.';
  }
  if (zombieTasks.length > 0) {
    recommendation += ` ${zombieTasks.length} zombie task(s) need addressing.`;
  }

  return {
    last7DaysCompletion: completionRate,
    byBucket,
    zombieTasks: zombieTasks.slice(0, 5),
    recommendation,
    targetTasks
  };
}

/**
 * Format velocity context for inclusion in todo prompt
 */
export function formatVelocityContext(context: VelocityContext): string {
  const lines: string[] = ['## Velocity Context'];

  lines.push(`- Last 7 days: ${context.last7DaysCompletion}% completion (target: 70%)`);
  lines.push(`- Deep Work: ${context.byBucket.deepWork}%`);
  lines.push(`- Comms: ${context.byBucket.comms}%`);
  lines.push(`- Long Tail: ${context.byBucket.longTail}%`);
  lines.push(`- Fear Work: ${context.byBucket.fearWork}%`);

  if (context.zombieTasks.length > 0) {
    lines.push('');
    lines.push('### Zombie Tasks (carried 3+ days - address today)');
    for (const zombie of context.zombieTasks) {
      lines.push(`- "${zombie.text}" (${zombie.days} days)`);
    }
  }

  lines.push('');
  lines.push(`**Recommendation:** ${context.recommendation}`);
  lines.push(`**Target:** Max ${context.targetTasks} tasks today`);

  return lines.join('\n');
}

/**
 * Update metrics from today's todo file
 */
export function updateMetrics(): VelocityContext {
  const state = loadMetrics();
  const today = new Date().toISOString().split('T')[0];

  // Find today's and yesterday's todo files
  const todayPath = join(TODOS_PATH, `${today}.md`);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];
  const yesterdayPath = join(TODOS_PATH, `${yesterdayStr}.md`);

  let currentTasks: ParsedTask[] = [];
  let previousTasks: ParsedTask[] = [];

  if (existsSync(todayPath)) {
    currentTasks = parseTodoFile(readFileSync(todayPath, 'utf-8'));
  }

  if (existsSync(yesterdayPath)) {
    previousTasks = parseTodoFile(readFileSync(yesterdayPath, 'utf-8'));
  }

  // Only compute if we have today's file
  if (currentTasks.length > 0) {
    // Check if we already have metrics for today
    const existingIdx = state.dailyMetrics.findIndex(m => m.date === today);

    const metrics = computeDailyMetrics(previousTasks, currentTasks, today, state);

    if (existingIdx >= 0) {
      state.dailyMetrics[existingIdx] = metrics;
    } else {
      state.dailyMetrics.push(metrics);
    }

    saveMetrics(state);
  }

  return getVelocityContext(state);
}

// CLI for testing
if (import.meta.main) {
  console.log('Updating velocity metrics...\n');

  const context = updateMetrics();

  console.log(formatVelocityContext(context));

  console.log('\n---\n');
  console.log('Metrics saved to:', METRICS_PATH);
}
