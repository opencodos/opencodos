#!/usr/bin/env bun
/**
 * Leverage Scorer
 *
 * Scores items for strategic leverage based on configurable rules.
 * Used by morning brief to prioritize what surfaces in Priority Actions
 * and Strategic Leverage sections.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';

// Paths
const VAULT_PATH = process.env.VAULT_PATH || '';
const CODOS_PATH = process.env.CODOS_PATH || '';
const RULES_PATH = join(CODOS_PATH, 'dev/Ops/atlas/leverage-rules.yaml');
const CRM_PATH = join(VAULT_PATH, '4 - CRM/contacts.yaml');

// Types
export interface LeverageRule {
  id: string;
  name: string;
  description?: string;
  score: number;
  triggers?: {
    message_age_hours?: number;
    meeting_within_hours?: number;
    has_deal_context?: boolean;
  };
  keywords?: string[];
}

export interface LeverageConfig {
  version: string;
  thresholds: {
    surface_minimum: number;
    priority_minimum: number;
    max_leverage_items: number;
    max_priority_items: number;
  };
  rules: LeverageRule[];
  contact_multipliers: { [relationship: string]: number };
  project_weights: { [project: string]: number };
}

export interface ScoredItem {
  id: string;
  source: string;
  content: string;
  contact?: string;
  project?: string;
  timestamp?: Date;
  baseScore: number;
  adjustedScore: number;
  matchedRules: string[];
  isPriority: boolean;
}

export interface Contact {
  id: string;
  name: string;
  relationship: string;
  projects?: string[];
  hypothesis?: string;
  last_connection?: string;
  interactions_365d?: number;
}

/**
 * Load leverage rules from YAML config
 */
export function loadLeverageRules(): LeverageConfig {
  if (!existsSync(RULES_PATH)) {
    throw new Error(`Leverage rules not found at ${RULES_PATH}`);
  }
  return parseYaml(readFileSync(RULES_PATH, 'utf-8'));
}

/**
 * Load contacts from CRM for relationship scoring
 */
export function loadContacts(): Map<string, Contact> {
  const contacts = new Map<string, Contact>();

  if (existsSync(CRM_PATH)) {
    try {
      const data = parseYaml(readFileSync(CRM_PATH, 'utf-8'));
      for (const contact of data.contacts || []) {
        // Index by name (lowercase for matching)
        contacts.set(contact.name.toLowerCase(), contact);
        // Also index by telegram_id if available
        if (contact.telegram_id) {
          contacts.set(`tg:${contact.telegram_id}`, contact);
        }
      }
    } catch {
      console.error('Failed to load contacts for leverage scoring');
    }
  }

  return contacts;
}

/**
 * Check if content matches any keywords (case-insensitive)
 */
function matchesKeywords(content: string, keywords: string[]): boolean {
  const lowerContent = content.toLowerCase();
  return keywords.some(kw => lowerContent.includes(kw.toLowerCase()));
}

/**
 * Calculate message age in hours
 */
function getMessageAgeHours(timestamp?: Date): number {
  if (!timestamp) return 0;
  const now = new Date();
  return (now.getTime() - timestamp.getTime()) / (1000 * 60 * 60);
}

/**
 * Check if there's a meeting within N hours
 */
function hasMeetingWithinHours(
  calendarEvents: Array<{ start: Date; title: string; attendees?: string[] }>,
  hours: number,
  contactName?: string
): boolean {
  const now = new Date();
  const cutoff = new Date(now.getTime() + hours * 60 * 60 * 1000);

  return calendarEvents.some(event => {
    const eventStart = new Date(event.start);
    if (eventStart < now || eventStart > cutoff) return false;

    // If contactName specified, check if they're in attendees or title
    if (contactName) {
      const lowerName = contactName.toLowerCase();
      const titleMatch = event.title.toLowerCase().includes(lowerName);
      const attendeeMatch = event.attendees?.some(a =>
        a.toLowerCase().includes(lowerName)
      );
      return titleMatch || attendeeMatch;
    }

    return true;
  });
}

/**
 * Score a single item against leverage rules
 */
export function scoreItem(
  item: {
    id: string;
    source: string;
    content: string;
    contact?: string;
    project?: string;
    timestamp?: Date;
    hasDealContext?: boolean;
  },
  config: LeverageConfig,
  contacts: Map<string, Contact>,
  calendarEvents: Array<{ start: Date; title: string; attendees?: string[] }> = []
): ScoredItem {
  let baseScore = 0;
  const matchedRules: string[] = [];

  // Check each rule
  for (const rule of config.rules) {
    let matches = false;

    // Check keyword matches
    if (rule.keywords && matchesKeywords(item.content, rule.keywords)) {
      matches = true;
    }

    // Check trigger conditions
    if (rule.triggers) {
      // Message age trigger
      if (rule.triggers.message_age_hours) {
        const age = getMessageAgeHours(item.timestamp);
        if (age >= rule.triggers.message_age_hours) {
          matches = true;
        }
      }

      // Meeting proximity trigger
      if (rule.triggers.meeting_within_hours) {
        if (hasMeetingWithinHours(
          calendarEvents,
          rule.triggers.meeting_within_hours,
          item.contact
        )) {
          matches = true;
        }
      }

      // Deal context trigger
      if (rule.triggers.has_deal_context && item.hasDealContext) {
        matches = true;
      }
    }

    if (matches) {
      baseScore = Math.max(baseScore, rule.score);
      matchedRules.push(rule.id);
    }
  }

  // Apply contact multiplier
  let adjustedScore = baseScore;
  if (item.contact) {
    const contact = contacts.get(item.contact.toLowerCase());
    if (contact?.relationship) {
      const multiplier = config.contact_multipliers[contact.relationship] || 1.0;
      adjustedScore = baseScore * multiplier;
    }
  }

  // Apply project weight
  if (item.project) {
    const weight = config.project_weights[item.project] || 1.0;
    adjustedScore = adjustedScore * weight;
  }

  return {
    id: item.id,
    source: item.source,
    content: item.content,
    contact: item.contact,
    project: item.project,
    timestamp: item.timestamp,
    baseScore,
    adjustedScore,
    matchedRules,
    isPriority: adjustedScore >= config.thresholds.priority_minimum
  };
}

/**
 * Score and rank multiple items
 */
export function scoreAndRankItems(
  items: Array<{
    id: string;
    source: string;
    content: string;
    contact?: string;
    project?: string;
    timestamp?: Date;
    hasDealContext?: boolean;
  }>,
  calendarEvents: Array<{ start: Date; title: string; attendees?: string[] }> = []
): {
  priorityActions: ScoredItem[];
  strategicLeverage: ScoredItem[];
  all: ScoredItem[];
} {
  const config = loadLeverageRules();
  const contacts = loadContacts();

  // Score all items
  const scored = items.map(item => scoreItem(item, config, contacts, calendarEvents));

  // Sort by adjusted score (highest first)
  scored.sort((a, b) => b.adjustedScore - a.adjustedScore);

  // Filter and limit
  const priorityActions = scored
    .filter(item => item.adjustedScore >= config.thresholds.priority_minimum)
    .slice(0, config.thresholds.max_priority_items);

  const strategicLeverage = scored
    .filter(item =>
      item.adjustedScore >= config.thresholds.surface_minimum &&
      !priorityActions.some(p => p.id === item.id)
    )
    .slice(0, config.thresholds.max_leverage_items);

  return {
    priorityActions,
    strategicLeverage,
    all: scored
  };
}

/**
 * Format scored items for brief output
 */
export function formatLeverageSection(items: ScoredItem[]): string {
  if (items.length === 0) {
    return 'No high-leverage items detected.';
  }

  const lines: string[] = [];

  for (const item of items) {
    const scoreStr = `[${item.adjustedScore.toFixed(1)}]`;
    const rulesStr = item.matchedRules.length > 0
      ? ` (${item.matchedRules.join(', ')})`
      : '';

    lines.push(`${scoreStr} **${item.contact || item.source}**${rulesStr}`);
    lines.push(`- Problem: ${item.content.slice(0, 150)}...`);
    lines.push(`- Impact: [To be generated by LLM]`);
    lines.push(`- Action: [To be generated by LLM]`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Get rule descriptions for including in prompts
 */
export function getRuleDescriptions(): string {
  const config = loadLeverageRules();

  const lines: string[] = ['## Leverage Scoring Rules'];
  lines.push(`Priority threshold: ${config.thresholds.priority_minimum}+`);
  lines.push(`Surface threshold: ${config.thresholds.surface_minimum}+`);
  lines.push('');

  for (const rule of config.rules) {
    lines.push(`- **${rule.name}** (${rule.score}): ${rule.description || 'No description'}`);
  }

  return lines.join('\n');
}

// CLI for testing
if (import.meta.main) {
  console.log('Testing leverage scorer...\n');

  const testItems = [
    {
      id: '1',
      source: 'Telegram',
      content: 'Hey, this is urgent - need your response ASAP on the contract',
      contact: 'Cofounder',
      project: 'ProjectX'
    },
    {
      id: '2',
      source: 'Telegram',
      content: 'Just checking in, how are things?',
      contact: 'Friend'
    },
    {
      id: '3',
      source: 'Gmail',
      content: 'Invoice attached for $5000 - payment due Friday',
      contact: 'Client',
      hasDealContext: true
    }
  ];

  const results = scoreAndRankItems(testItems);

  console.log('Priority Actions:');
  console.log(formatLeverageSection(results.priorityActions));

  console.log('\nStrategic Leverage:');
  console.log(formatLeverageSection(results.strategicLeverage));

  console.log('\nAll scores:');
  for (const item of results.all) {
    console.log(`  ${item.contact || item.source}: ${item.adjustedScore.toFixed(1)} [${item.matchedRules.join(', ')}]`);
  }
}
