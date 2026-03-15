#!/usr/bin/env bun
/**
 * Alert Detector
 *
 * Scans inbox sources for urgent items that need immediate attention.
 * Runs every 15 minutes via launchd agent and sends push notifications.
 *
 * Alert triggers:
 * - Crisis: urgent, срочно, проблема, critical, emergency
 * - Deadline: дедлайн, до конца дня, today, EOD, before
 * - Money: payment, invoice, оплата, transfer, overdue
 * - Blocking: waiting on you, blocking, need your
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import { execSync } from 'child_process';

// Paths
const VAULT_PATH = process.env.VAULT_PATH || '';
const CODOS_PATH = process.env.CODOS_PATH || '';
const INBOX_PATH = join(VAULT_PATH, '1 - Inbox (Last 7 days)');
const STATE_PATH = join(CODOS_PATH, 'dev/Ops/atlas');
const ALERTS_PATH = join(STATE_PATH, 'pending-alerts.json');

// Types
export interface Alert {
  id: string;
  type: 'crisis' | 'deadline' | 'money' | 'blocking';
  source: string;
  contact?: string;
  content: string;
  detectedAt: string;
  notifiedAt?: string;
  dismissed: boolean;
  matchedKeywords: string[];
}

export interface AlertsState {
  lastScan: string;
  alerts: Alert[];
}

// Alert trigger keywords
const ALERT_TRIGGERS = {
  crisis: {
    keywords: [
      'urgent', 'срочно', 'asap', 'emergency', 'critical', 'immediately',
      'проблема', 'problem', 'issue', 'broken', 'down', 'failed', 'error'
    ],
    priority: 1
  },
  deadline: {
    keywords: [
      'deadline', 'дедлайн', 'до конца дня', 'today', 'by EOD', 'end of day',
      'before', 'due', 'expires', 'last chance', 'final', 'remaining'
    ],
    priority: 2
  },
  money: {
    keywords: [
      'payment', 'invoice', 'оплата', 'transfer', 'wire', 'overdue', 'late payment',
      'счет', 'деньги', '$', 'pay', 'paid', 'unpaid', 'balance', 'owe'
    ],
    priority: 3
  },
  blocking: {
    keywords: [
      'waiting on you', 'blocking', 'need your', 'blocked by', 'depends on you',
      'waiting for your', 'жду', 'ждем', 'can you', 'could you', 'please respond'
    ],
    priority: 4
  }
};

/**
 * Generate a unique ID for an alert
 */
function alertId(source: string, content: string): string {
  const hash = content.slice(0, 50).replace(/\s+/g, '_').slice(0, 20);
  return `${source}_${hash}_${Date.now().toString(36)}`;
}

/**
 * Load alerts state
 */
export function loadAlerts(): AlertsState {
  if (existsSync(ALERTS_PATH)) {
    try {
      return JSON.parse(readFileSync(ALERTS_PATH, 'utf-8'));
    } catch {
      // Corrupted file, start fresh
    }
  }
  return {
    lastScan: new Date().toISOString(),
    alerts: []
  };
}

/**
 * Save alerts state
 */
export function saveAlerts(state: AlertsState): void {
  // Clean up old dismissed alerts (older than 24h)
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  state.alerts = state.alerts.filter(a => {
    if (a.dismissed) {
      return new Date(a.detectedAt).getTime() > cutoff;
    }
    return true;
  });

  state.lastScan = new Date().toISOString();
  writeFileSync(ALERTS_PATH, JSON.stringify(state, null, 2));
}

/**
 * Check if content matches any alert triggers
 */
function matchAlertTriggers(content: string): {
  type: Alert['type'];
  keywords: string[];
} | null {
  const lowerContent = content.toLowerCase();

  // Check each trigger type in priority order
  for (const [type, config] of Object.entries(ALERT_TRIGGERS)) {
    const matched = config.keywords.filter(kw =>
      lowerContent.includes(kw.toLowerCase())
    );
    if (matched.length > 0) {
      return { type: type as Alert['type'], keywords: matched };
    }
  }

  return null;
}

/**
 * Extract contact name from file path or content
 */
function extractContact(filePath: string, content: string): string | undefined {
  // Try to get from DM filename
  if (filePath.includes('/DMs/')) {
    return basename(filePath).replace('.md', '').replace(/_/g, ' ');
  }

  // Try to extract from content (e.g., "From: Name")
  const fromMatch = content.match(/^From:\s*(.+)$/m);
  if (fromMatch) return fromMatch[1].trim();

  return undefined;
}

/**
 * Scan inbox sources for alerts
 */
export function scanForAlerts(): Alert[] {
  const state = loadAlerts();
  const existingIds = new Set(state.alerts.map(a => a.content.slice(0, 100)));
  const newAlerts: Alert[] = [];

  // Scan Telegram DMs (highest priority)
  const dmsPath = join(INBOX_PATH, 'Telegram/DMs');
  if (existsSync(dmsPath)) {
    const cutoff = Date.now() - 60 * 60 * 1000; // Last hour only for DMs

    for (const file of readdirSync(dmsPath)) {
      const filePath = join(dmsPath, file);
      const stat = statSync(filePath);

      if (stat.mtimeMs < cutoff) continue;

      try {
        const content = readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').slice(-10); // Last 10 messages

        for (const line of lines) {
          const match = matchAlertTriggers(line);
          if (match && !existingIds.has(line.slice(0, 100))) {
            newAlerts.push({
              id: alertId('telegram', line),
              type: match.type,
              source: 'Telegram',
              contact: extractContact(filePath, content),
              content: line.slice(0, 200),
              detectedAt: new Date().toISOString(),
              dismissed: false,
              matchedKeywords: match.keywords
            });
          }
        }
      } catch {
        // Skip unreadable files
      }
    }
  }

  // Scan Gmail
  const gmailPath = join(INBOX_PATH, 'Gmail');
  if (existsSync(gmailPath)) {
    const cutoff = Date.now() - 2 * 60 * 60 * 1000; // Last 2 hours

    try {
      const files = readdirSync(gmailPath)
        .filter(f => f.endsWith('.md'))
        .slice(0, 20);

      for (const file of files) {
        const filePath = join(gmailPath, file);
        const stat = statSync(filePath);

        if (stat.mtimeMs < cutoff) continue;

        const content = readFileSync(filePath, 'utf-8');
        const match = matchAlertTriggers(content);

        if (match && !existingIds.has(content.slice(0, 100))) {
          newAlerts.push({
            id: alertId('gmail', content),
            type: match.type,
            source: 'Gmail',
            contact: extractContact(filePath, content),
            content: content.slice(0, 200),
            detectedAt: new Date().toISOString(),
            dismissed: false,
            matchedKeywords: match.keywords
          });
        }
      }
    } catch {
      // Skip
    }
  }

  // Scan Slack
  const slackPath = join(INBOX_PATH, 'Slack');
  if (existsSync(slackPath)) {
    const cutoff = Date.now() - 2 * 60 * 60 * 1000;

    try {
      const files = readdirSync(slackPath)
        .filter(f => f.endsWith('.md'))
        .slice(0, 20);

      for (const file of files) {
        const filePath = join(slackPath, file);
        const stat = statSync(filePath);

        if (stat.mtimeMs < cutoff) continue;

        const content = readFileSync(filePath, 'utf-8');
        const match = matchAlertTriggers(content);

        if (match && !existingIds.has(content.slice(0, 100))) {
          newAlerts.push({
            id: alertId('slack', content),
            type: match.type,
            source: 'Slack',
            contact: extractContact(filePath, content),
            content: content.slice(0, 200),
            detectedAt: new Date().toISOString(),
            dismissed: false,
            matchedKeywords: match.keywords
          });
        }
      }
    } catch {
      // Skip
    }
  }

  return newAlerts;
}

/**
 * Send macOS notification
 */
function sendNotification(alert: Alert): void {
  const title = `[${alert.type.toUpperCase()}] ${alert.source}`;
  const subtitle = alert.contact || 'Unknown';
  const message = alert.content.slice(0, 100);

  const script = `display notification "${message.replace(/"/g, '\\"')}" with title "${title}" subtitle "${subtitle}" sound name "Ping"`;

  try {
    execSync(`osascript -e '${script}'`);
  } catch (err) {
    console.error('Failed to send notification:', err);
  }
}

/**
 * Main alert scanning function
 */
export function runAlertScan(options?: { silent?: boolean }): {
  newAlerts: number;
  totalPending: number;
} {
  const silent = options?.silent || false;
  const state = loadAlerts();

  // Scan for new alerts
  const newAlerts = scanForAlerts();

  // Add new alerts and send notifications
  for (const alert of newAlerts) {
    state.alerts.push(alert);

    if (!silent) {
      console.log(`[${alert.type}] ${alert.source}: ${alert.content.slice(0, 60)}...`);
      sendNotification(alert);
      alert.notifiedAt = new Date().toISOString();
    }
  }

  // Save state
  saveAlerts(state);

  // Count pending (not dismissed)
  const pendingCount = state.alerts.filter(a => !a.dismissed).length;

  return {
    newAlerts: newAlerts.length,
    totalPending: pendingCount
  };
}

/**
 * Dismiss an alert by ID
 */
export function dismissAlert(alertId: string): boolean {
  const state = loadAlerts();
  const alert = state.alerts.find(a => a.id === alertId);

  if (alert) {
    alert.dismissed = true;
    saveAlerts(state);
    return true;
  }

  return false;
}

/**
 * Get pending alerts for display
 */
export function getPendingAlerts(): Alert[] {
  const state = loadAlerts();
  return state.alerts
    .filter(a => !a.dismissed)
    .sort((a, b) => {
      // Sort by type priority, then by detection time
      const priorityA = ALERT_TRIGGERS[a.type]?.priority || 999;
      const priorityB = ALERT_TRIGGERS[b.type]?.priority || 999;
      if (priorityA !== priorityB) return priorityA - priorityB;
      return new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime();
    });
}

// CLI execution
if (import.meta.main) {
  const args = process.argv.slice(2);
  const silent = args.includes('--silent');
  const listOnly = args.includes('--list');

  if (listOnly) {
    const pending = getPendingAlerts();
    console.log(`\n${pending.length} pending alerts:\n`);
    for (const alert of pending) {
      const time = new Date(alert.detectedAt).toLocaleTimeString();
      console.log(`[${alert.type.toUpperCase()}] ${alert.source} (${time})`);
      if (alert.contact) console.log(`  Contact: ${alert.contact}`);
      console.log(`  ${alert.content.slice(0, 80)}...`);
      console.log(`  Keywords: ${alert.matchedKeywords.join(', ')}`);
      console.log('');
    }
  } else {
    console.log('Scanning for alerts...\n');
    const result = runAlertScan({ silent });
    console.log(`\nFound ${result.newAlerts} new alert(s)`);
    console.log(`Total pending: ${result.totalPending}`);
  }
}
