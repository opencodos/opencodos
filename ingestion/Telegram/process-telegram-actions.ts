#!/usr/bin/env bun
/**
 * Process Telegram Daily Summary files
 * - Extracts person mentions with context
 * - Updates CRM profile files
 * - Extracts action items to todo files
 * - Proposes new contacts when people aren't in CRM
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'fs';
import { join, basename } from 'path';

// Paths
const VAULT_PATH = process.env.VAULT_PATH || '';
const TELEGRAM_PATH = join(VAULT_PATH, '1 - Inbox (Last 7 days)/Telegram');
const SUMMARY_PATH = join(TELEGRAM_PATH, 'Daily Summary');
const CRM_PATH = join(VAULT_PATH, '4 - CRM');
const PROFILES_PATH = join(CRM_PATH, 'Profiles');
const TODOS_PATH = join(VAULT_PATH, '3 - Todos');
const PENDING_UPDATES_PATH = join(CRM_PATH, 'Pending Updates.md');
const PROCESSED_FILE = join(TELEGRAM_PATH, '.processed-summaries.json');

// Types
interface TelegramMention {
  name: string;
  organization: string | null;
  context: string;
  keyPoints: string[];
  actionNeeded: string | null;
  priority: 'high' | 'medium' | 'low';
  date: string;
}

export interface Contact {
  name: string;
  filePath: string;
  aliases: string[];
}

interface ProcessedResult {
  updated: number;
  created: number;
  actions: string[];
  newContacts: TelegramMention[];
}

// Priority to suggested relationship tier for new contacts
const PRIORITY_TO_RELATIONSHIP: Record<string, string> = {
  'high': '3 - Close enough',      // High priority = actively engaged
  'medium': '2 - Warmish',         // Medium = known but not close
  'low': '1 - New connection'
};

// Skip these names (self-references) — configure via USER_SKIP_NAMES env var
const SKIP_NAMES = (process.env.USER_SKIP_NAMES || 'me,i')
  .split(',').map(n => n.trim().toLowerCase());

/**
 * Load list of already processed summary files
 */
function loadProcessedFiles(): Set<string> {
  if (!existsSync(PROCESSED_FILE)) {
    return new Set();
  }
  try {
    const data = JSON.parse(readFileSync(PROCESSED_FILE, 'utf-8'));
    return new Set(data.processed || []);
  } catch {
    return new Set();
  }
}

/**
 * Save list of processed files
 */
function saveProcessedFiles(processed: Set<string>): void {
  writeFileSync(PROCESSED_FILE, JSON.stringify({
    processed: Array.from(processed),
    lastUpdated: new Date().toISOString()
  }, null, 2));
}

/**
 * Load contacts from CRM profiles
 */
function loadContacts(): Contact[] {
  if (!existsSync(PROFILES_PATH)) {
    return [];
  }

  const contacts: Contact[] = [];
  const files = readdirSync(PROFILES_PATH).filter(f => f.endsWith('.md'));

  for (const file of files) {
    const name = file.replace('.md', '');
    const filePath = join(PROFILES_PATH, file);

    // Generate aliases from name
    const aliases: string[] = [name.toLowerCase()];
    const parts = name.split(' ');
    if (parts.length > 1) {
      aliases.push(parts[0].toLowerCase()); // First name
      aliases.push(parts[parts.length - 1].toLowerCase()); // Last name
    }

    contacts.push({ name, filePath, aliases });
  }

  return contacts;
}

/**
 * Parse priority DMs from Daily Summary
 * Format: ### Name | Org followed by bullets
 */
export function parseHighPrioritySection(content: string, date: string): TelegramMention[] {
  const mentions: TelegramMention[] = [];

  // Match ## Priority DMs section (new format) or ## High Priority Conversations (legacy)
  const highPriorityMatch = content.match(/## Priority DMs[^\n]*([\s\S]*?)(?=\n## |$)/i)
    || content.match(/## High Priority Conversations([\s\S]*?)(?=\n## |$)/i);
  if (!highPriorityMatch) return mentions;

  const section = highPriorityMatch[1];

  // Match ### Name | Org blocks
  const blockPattern = /### ([^|\n]+?)(?:\s*\|\s*([^\n]+))?\n([\s\S]*?)(?=\n### |$)/g;
  let match;

  while ((match = blockPattern.exec(section)) !== null) {
    const name = match[1].trim();
    const org = match[2]?.trim() || null;
    const blockContent = match[3];

    // Skip self-mentions
    if (SKIP_NAMES.includes(name.toLowerCase())) continue;

    // Parse bullet points
    const contextMatch = blockContent.match(/\*\*Context\*\*:\s*([^\n]+)/i);
    const keyPointsMatch = blockContent.match(/\*\*Key points\*\*:\s*([^\n]+)/i);
    const actionMatch = blockContent.match(/\*\*Action needed\*\*:\s*([^\n]+)/i);

    mentions.push({
      name,
      organization: org,
      context: contextMatch?.[1]?.trim() || '',
      keyPoints: keyPointsMatch?.[1]?.trim().split(/[;,]/).map(s => s.trim()).filter(Boolean) || [],
      actionNeeded: actionMatch?.[1]?.trim() || null,
      priority: 'high',
      date
    });
  }

  return mentions;
}

/**
 * Parse medium priority entries from Daily Summary
 * Format: - **Name**: description
 */
export function parseMediumPrioritySection(content: string, date: string): TelegramMention[] {
  const mentions: TelegramMention[] = [];

  // Match ## Medium Priority section
  const mediumMatch = content.match(/## Medium Priority([\s\S]*?)(?=\n## |$)/i);
  if (!mediumMatch) return mentions;

  const section = mediumMatch[1];

  // Match - **Name**: description
  const entryPattern = /- \*\*([^*]+)\*\*:\s*([^\n]+)/g;
  let match;

  while ((match = entryPattern.exec(section)) !== null) {
    const name = match[1].trim();
    const description = match[2].trim();

    // Skip self-mentions
    if (SKIP_NAMES.includes(name.toLowerCase())) continue;

    // Check if description contains action-related keywords
    const hasAction = /follow.?up|schedule|respond|reply|send|call|meet|contact/i.test(description);

    mentions.push({
      name,
      organization: null,
      context: description,
      keyPoints: [],
      actionNeeded: hasAction ? description : null,
      priority: 'medium',
      date
    });
  }

  return mentions;
}

/**
 * Parse a Daily Summary file and extract all mentions
 */
function parseDailySummary(content: string, date: string): TelegramMention[] {
  const highPriority = parseHighPrioritySection(content, date);
  const mediumPriority = parseMediumPrioritySection(content, date);
  return [...highPriority, ...mediumPriority];
}

/**
 * Find best matching contact using fuzzy matching
 */
export function findBestMatch(name: string, contacts: Contact[]): { contact: Contact | null; confidence: number } {
  const nameLower = name.toLowerCase();
  const nameParts = nameLower.split(/\s+/);

  let bestMatch: Contact | null = null;
  let bestConfidence = 0;

  for (const contact of contacts) {
    let confidence = 0;

    // Exact match on full name
    if (contact.name.toLowerCase() === nameLower) {
      return { contact, confidence: 1.0 };
    }

    // Check aliases
    for (const alias of contact.aliases) {
      if (alias === nameLower) {
        confidence = Math.max(confidence, 0.95);
      } else if (nameLower.includes(alias) || alias.includes(nameLower)) {
        confidence = Math.max(confidence, 0.8);
      }
    }

    // Check if first name matches
    const contactFirstName = contact.name.split(' ')[0].toLowerCase();
    if (nameParts[0] === contactFirstName) {
      confidence = Math.max(confidence, 0.7);
    }

    // Check if last name matches
    const contactParts = contact.name.toLowerCase().split(' ');
    const contactLastName = contactParts[contactParts.length - 1];
    if (nameParts.length > 1 && nameParts[nameParts.length - 1] === contactLastName) {
      confidence = Math.max(confidence, 0.75);
    }

    // Partial containment
    if (nameLower.includes(contactFirstName) && contactFirstName.length > 3) {
      confidence = Math.max(confidence, 0.6);
    }

    if (confidence > bestConfidence) {
      bestConfidence = confidence;
      bestMatch = contact;
    }
  }

  return { contact: bestMatch, confidence: bestConfidence };
}

/**
 * Update a profile file with new interaction log entry
 */
function updateProfileFile(contact: Contact, mention: TelegramMention): void {
  let content = readFileSync(contact.filePath, 'utf-8');

  // Build the log entry
  const logLines: string[] = [];
  if (mention.context) {
    logLines.push(`- [Telegram] ${mention.context}`);
  }
  for (const point of mention.keyPoints) {
    logLines.push(`- ${point}`);
  }
  if (mention.actionNeeded && mention.actionNeeded.toLowerCase() !== 'none') {
    logLines.push(`- **Action:** ${mention.actionNeeded}`);
  }

  if (logLines.length === 0) return;

  const logEntry = `### ${mention.date} - Telegram ${mention.priority} priority\n${logLines.join('\n')}\n`;

  // Check if there's already an entry for this date
  if (content.includes(`### ${mention.date} - Telegram`)) {
    // Already processed this date, skip
    return;
  }

  // Find or create Interaction Log section
  if (content.includes('## Interaction Log')) {
    // Insert after the header
    content = content.replace(
      '## Interaction Log\n',
      `## Interaction Log\n${logEntry}\n`
    );
  } else {
    // Add section at end
    content = content.trimEnd() + `\n\n## Interaction Log\n${logEntry}`;
  }

  // Update Last contact in Quick Facts if present
  const lastContactRegex = /- Last contact: .*/;
  if (lastContactRegex.test(content)) {
    content = content.replace(lastContactRegex, `- Last contact: ${mention.date}`);
  }

  writeFileSync(contact.filePath, content);
}

/**
 * Append new contact proposal to Pending Updates
 */
function proposeNewContact(mention: TelegramMention): void {
  const proposal = `
### Proposed: ${mention.name}
- **Organization**: ${mention.organization || 'Unknown'}
- **Suggested tier**: ${PRIORITY_TO_RELATIONSHIP[mention.priority]}
- **Context**: ${mention.context || 'Mentioned in Telegram'}
- **Source**: Telegram Daily Summary ${mention.date}
- **Action**: Review and create profile

`;

  let content = '';
  if (existsSync(PENDING_UPDATES_PATH)) {
    content = readFileSync(PENDING_UPDATES_PATH, 'utf-8');
  } else {
    content = '# Pending CRM Updates\n\nUpdates extracted from various sources. Review and apply to individual CRM entries.\n\n';
  }

  // Check if already proposed
  if (content.includes(`### Proposed: ${mention.name}`)) {
    return;
  }

  // Add to pending updates
  const sectionHeader = `## From: Telegram Summary (${mention.date})\n`;
  if (!content.includes(sectionHeader)) {
    content += `\n---\n\n${sectionHeader}`;
  }

  // Find the section and append
  const sectionIndex = content.indexOf(sectionHeader);
  const nextSectionIndex = content.indexOf('\n---\n', sectionIndex + sectionHeader.length);

  if (nextSectionIndex > -1) {
    content = content.slice(0, nextSectionIndex) + proposal + content.slice(nextSectionIndex);
  } else {
    content += proposal;
  }

  writeFileSync(PENDING_UPDATES_PATH, content);
}

/**
 * Append action items to today's todo file
 */
function appendToTodoFile(date: string, items: string[]): void {
  if (items.length === 0) return;

  const todoPath = join(TODOS_PATH, `${date}.md`);
  const section = `\n## From Telegram Summary\n${items.join('\n')}\n`;

  if (existsSync(todoPath)) {
    let content = readFileSync(todoPath, 'utf-8');

    // Check if section already exists
    if (content.includes('## From Telegram Summary')) {
      // Already has section, don't duplicate
      return;
    }

    content += section;
    writeFileSync(todoPath, content);
  } else {
    // Create new todo file with minimal structure
    const newContent = `# ${date}\n${section}`;
    writeFileSync(todoPath, newContent);
  }
}

/**
 * Main processing function
 */
function main(): void {
  console.log('Processing Telegram Daily Summary files...\n');

  // Check if summary directory exists
  if (!existsSync(SUMMARY_PATH)) {
    console.log('No Daily Summary directory found. Run daily_summary.py first.');
    return;
  }

  // Load processed files and contacts
  const processed = loadProcessedFiles();
  const contacts = loadContacts();
  console.log(`Loaded ${contacts.length} contacts from CRM`);

  // Get summary files to process
  const summaryFiles = readdirSync(SUMMARY_PATH)
    .filter(f => f.endsWith('.md'))
    .filter(f => !processed.has(f))
    .sort();

  if (summaryFiles.length === 0) {
    console.log('No new summary files to process.');
    return;
  }

  console.log(`Found ${summaryFiles.length} new summary files to process\n`);

  const results: ProcessedResult = {
    updated: 0,
    created: 0,
    actions: [],
    newContacts: []
  };

  for (const filename of summaryFiles) {
    const filepath = join(SUMMARY_PATH, filename);
    const date = filename.replace('.md', '');
    console.log(`Processing ${filename}...`);

    const content = readFileSync(filepath, 'utf-8');
    const mentions = parseDailySummary(content, date);

    console.log(`  Found ${mentions.length} person mentions`);

    for (const mention of mentions) {
      const { contact, confidence } = findBestMatch(mention.name, contacts);

      if (contact && confidence >= 0.6) {
        console.log(`  - ${mention.name} -> ${contact.name} (${(confidence * 100).toFixed(0)}%)`);
        updateProfileFile(contact, mention);
        results.updated++;
      } else {
        console.log(`  - ${mention.name} -> NEW CONTACT (confidence: ${(confidence * 100).toFixed(0)}%)`);
        proposeNewContact(mention);
        results.newContacts.push(mention);
      }

      // Collect action items
      if (mention.actionNeeded && mention.actionNeeded.toLowerCase() !== 'none') {
        results.actions.push(`- [ ] ${mention.actionNeeded} (${mention.name})`);
      }
    }

    // Mark as processed
    processed.add(filename);
  }

  // Save processed files
  saveProcessedFiles(processed);

  // Append actions to today's todo
  const today = new Date().toISOString().split('T')[0];
  appendToTodoFile(today, results.actions);

  // Summary
  console.log('\n--- Summary ---');
  console.log(`Profiles updated: ${results.updated}`);
  console.log(`New contacts proposed: ${results.newContacts.length}`);
  console.log(`Action items extracted: ${results.actions.length}`);

  if (results.actions.length > 0) {
    console.log('\nAction items added to todo:');
    results.actions.forEach(a => console.log(`  ${a}`));
  }

  if (results.newContacts.length > 0) {
    console.log('\nNew contacts proposed (check Pending Updates.md):');
    results.newContacts.forEach(c => console.log(`  - ${c.name} (${c.organization || 'Unknown org'})`));
  }
}

// Run
if (import.meta.main) {
  main();
}
