#!/usr/bin/env bun
/**
 * Gather Brief Context
 *
 * Extracts and exports all context gathering functions from the morning brief.
 * Can be run standalone to output formatted markdown context to stdout.
 *
 * Usage:
 *   bun run gather-brief-context.ts          # Output context to stdout
 *   VAULT_PATH=/custom/path bun run ...      # Use custom vault path
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import { createHash } from 'crypto';
import { parse as parseYaml } from 'yaml';

// Configuration - use env vars with defaults (portable)
const HOME = process.env.HOME || require('os').homedir();
const VAULT_PATH = process.env.VAULT_PATH || `${HOME}/Documents/Obsidian Vault`;
const CODOS_PATH = process.env.CODOS_PATH || `${HOME}/Projects/codos`;

// Derived paths
const INBOX_PATH = join(VAULT_PATH, '1 - Inbox (Last 7 days)');
const BRIEFS_PATH = join(VAULT_PATH, '0 - Daily Briefs');
const CORE_MEMORY_PATH = join(VAULT_PATH, 'Core Memory');
const TODOS_PATH = join(VAULT_PATH, '3 - Todos');
const WEEKLY_REVIEWS_PATH = join(VAULT_PATH, '0 - Weekly Reviews');
const CRM_PATH = join(VAULT_PATH, '4 - CRM');
const STATE_PATH = join(CODOS_PATH, 'dev/Ops/atlas');
const BRIEFED_ITEMS_PATH = join(STATE_PATH, 'briefed-items.json');

// ============================================================================
// Types
// ============================================================================

export interface ContactMapping {
  contactToProjects: { [name: string]: string[] };
  personalContacts: string[];
  projectList: string[];
}

export interface BriefedItemsState {
  lastUpdated: string;
  items: { [hash: string]: { date: string; source: string; title: string } };
}

export interface SourceData {
  source: string;
  items: Array<{
    title: string;
    content: string;
    date?: string;
    hash?: string;
  }>;
}

export interface FullMessage {
  contactName: string;
  telegramHandle?: string;
  contactId?: string;
  relationship?: string;
  lastMessageTime?: string;
  messages: Array<{
    sender: 'them' | 'me';
    text: string;
    timestamp?: string;
  }>;
  entityContext?: string;
  projects?: string[];
}

export interface CalendarEvent {
  start: Date;
  end?: Date;
  title: string;
  attendees?: string[];
  location?: string;
}

export interface CRMActionItem {
  contact: string;
  nextStep: string;
  lastContact: string;
  daysSinceContact: number;
  isStale: boolean;
  isRelevant: boolean;
}

export interface LeadSubmission {
  name: string;
  teamSize: string;
  lookingFor: string;
  tried: string;
  source: string;
  email: string;
  telegram?: string;
  submittedAt: string;
  date: string;
}

export interface BriefContext {
  aboutMe: string | null;
  goals: string | null;
  briefFeedback: string | null;
  myFears: string | null;
  principles: string | null;
  inbox: SourceData[];
  weeklyReview: string | null;
  recentTodos: SourceData;
  briefedItems: BriefedItemsState;
  contactMapping: ContactMapping;
  crisisSignals: string | null;
  fullMessages: FullMessage[];
  calendarEvents: CalendarEvent[];
  contacts: Map<string, any>;
  relationshipHealth: string;
  crmActionItems: CRMActionItem[];
  leads: LeadSubmission[];
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate a hash for content to track if it's been briefed
 */
export function contentHash(content: string): string {
  return createHash('md5').update(content).digest('hex').slice(0, 12);
}

/**
 * Load briefed items state
 */
export function loadBriefedItems(): BriefedItemsState {
  if (existsSync(BRIEFED_ITEMS_PATH)) {
    try {
      return JSON.parse(readFileSync(BRIEFED_ITEMS_PATH, 'utf-8'));
    } catch {
      // Corrupted file, start fresh
    }
  }
  return { lastUpdated: new Date().toISOString(), items: {} };
}

/**
 * Save briefed items state (keeps last 14 days)
 */
export function saveBriefedItems(state: BriefedItemsState): void {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 14);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  for (const [hash, item] of Object.entries(state.items)) {
    if (item.date < cutoffStr) {
      delete state.items[hash];
    }
  }

  state.lastUpdated = new Date().toISOString();

  if (!existsSync(STATE_PATH)) {
    mkdirSync(STATE_PATH, { recursive: true });
  }
  writeFileSync(BRIEFED_ITEMS_PATH, JSON.stringify(state, null, 2));
}

/**
 * Get recent files modified within N days
 */
export function getRecentFiles(dir: string, days: number = 7): string[] {
  if (!existsSync(dir)) return [];

  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const files: string[] = [];

  function scan(currentDir: string) {
    try {
      const entries = readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(currentDir, entry.name);
        if (entry.isDirectory()) {
          scan(fullPath);
        } else if (entry.name.endsWith('.md') || entry.name.endsWith('.json')) {
          const stat = statSync(fullPath);
          if (stat.mtimeMs > cutoff) {
            files.push(fullPath);
          }
        }
      }
    } catch {
      // Skip inaccessible directories
    }
  }

  scan(dir);
  return files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
}

/**
 * Read and summarize content from a source directory
 */
export function gatherSourceData(
  sourcePath: string,
  sourceName: string,
  limit: number = 10,
  briefedItems?: BriefedItemsState,
  days: number = 1,
  fullMode: boolean = false
): SourceData {
  const effectiveLimit = fullMode ? Infinity : limit;
  const effectiveDays = fullMode ? 7 : days;
  const contentLimit = fullMode ? Infinity : 3000;
  const items: SourceData['items'] = [];
  const files = getRecentFiles(sourcePath, effectiveDays).slice(0, fullMode ? Infinity : limit * 2);

  for (const file of files) {
    if (items.length >= effectiveLimit) break;

    try {
      const content = readFileSync(file, 'utf-8');
      const stat = statSync(file);
      const hash = contentHash(content);

      if (briefedItems?.items[hash]) {
        continue;
      }

      items.push({
        title: basename(file).replace(/\.(md|json)$/, ''),
        content: contentLimit === Infinity ? content : content.slice(0, contentLimit),
        date: stat.mtime.toISOString().split('T')[0],
        hash
      });
    } catch {
      // Skip unreadable files
    }
  }

  return { source: sourceName, items };
}

/**
 * Read a single file if it exists
 */
export function readIfExists(path: string): string | null {
  if (existsSync(path)) {
    return readFileSync(path, 'utf-8');
  }
  return null;
}

/**
 * Get the latest weekly review file
 */
export function getLatestWeeklyReview(): string | null {
  if (!existsSync(WEEKLY_REVIEWS_PATH)) return null;

  const files = readdirSync(WEEKLY_REVIEWS_PATH)
    .filter(f => f.match(/^\d{4}-W\d{2}\.md$/))
    .sort()
    .reverse();

  if (files.length === 0) return null;

  const latestFile = join(WEEKLY_REVIEWS_PATH, files[0]);
  return readFileSync(latestFile, 'utf-8');
}

// ============================================================================
// Contact & CRM Functions
// ============================================================================

/**
 * Load contact->project mapping from CRM
 */
export function loadContactMapping(): ContactMapping {
  const mapping: ContactMapping = {
    contactToProjects: {},
    personalContacts: [],
    projectList: (process.env.PROJECT_LIST || 'Project A,Project B,Project C').split(',')
  };

  const projectsFile = readIfExists(join(CORE_MEMORY_PATH, 'Projects.md'));
  if (projectsFile) {
    const projectMatches = projectsFile.match(/^- (\w+)/gm);
    if (projectMatches) {
      mapping.projectList = projectMatches.map(m => m.replace('- ', ''));
    }
  }

  const contactsFile = join(CRM_PATH, 'contacts.yaml');
  if (existsSync(contactsFile)) {
    try {
      const data = parseYaml(readFileSync(contactsFile, 'utf-8'));
      for (const contact of data.contacts || []) {
        const name = contact.name;
        if (!name) continue;

        if (contact.projects && contact.projects.length > 0) {
          mapping.contactToProjects[name] = contact.projects;
        }

        if (contact.category === 'personal') {
          mapping.personalContacts.push(name);
        }
      }
    } catch (err) {
      console.error('Failed to parse contacts.yaml:', err);
    }
  }

  return mapping;
}

/**
 * Load contacts from CRM for entity context
 */
export function loadContacts(): Map<string, any> {
  const contacts = new Map();
  const contactsFile = join(CRM_PATH, 'contacts.yaml');

  if (existsSync(contactsFile)) {
    try {
      const data = parseYaml(readFileSync(contactsFile, 'utf-8'));
      for (const contact of data.contacts || []) {
        contacts.set(contact.name?.toLowerCase(), contact);
        if (contact.telegram_id) {
          contacts.set(`tg:${contact.telegram_id}`, contact);
        }
      }
    } catch {
      // Skip
    }
  }

  return contacts;
}

// ============================================================================
// CRM Action Items Functions
// ============================================================================

/**
 * Parse CRM Action Items from contacts.yaml (single source of truth)
 *
 * Reads next_step field directly from contacts.yaml instead of parsing
 * the Dashboard markdown table. This prevents race conditions between
 * /memory writes and Telegram agent Dashboard regeneration.
 */
export function parseCRMActionItems(): CRMActionItem[] {
  const contactsFile = join(CRM_PATH, 'contacts.yaml');
  if (!existsSync(contactsFile)) return [];

  let data: any;
  try {
    data = parseYaml(readFileSync(contactsFile, 'utf-8'));
  } catch {
    return [];
  }

  const contacts = data?.contacts || [];
  const actionItems: CRMActionItem[] = [];

  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  // Get tomorrow for relevance check
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  for (const contact of contacts) {
    const nextStep = contact.next_step;

    // Skip if no next_step or it's null/None/empty
    if (!nextStep || nextStep === 'null' || nextStep === 'None' ||
        nextStep.toLowerCase().includes('none -') || nextStep.trim() === '') {
      continue;
    }

    const contactName = contact.name || 'Unknown';
    const lastContact = contact.last_connection || 'unknown';

    // Parse last contact date
    let lastContactDate: Date;
    if (lastContact && lastContact !== 'unknown') {
      lastContactDate = new Date(lastContact);
    } else {
      lastContactDate = new Date(0); // Very old if no date
    }

    const daysSinceContact = Math.floor((today.getTime() - lastContactDate.getTime()) / (1000 * 60 * 60 * 24));
    const isStale = daysSinceContact > 7;

    // Check if relevant (mentions today, tomorrow, specific dates, or time-sensitive keywords)
    const nextStepLower = nextStep.toLowerCase();
    const isRelevant =
      nextStep.includes(todayStr) ||
      nextStep.includes(tomorrowStr) ||
      nextStepLower.includes('today') ||
      nextStepLower.includes('tomorrow') ||
      nextStepLower.includes('call') ||
      nextStepLower.includes('meeting') ||
      nextStepLower.includes('deadline') ||
      nextStepLower.includes('urgent') ||
      // Check for date patterns like "Feb 2" or "February 2"
      /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{1,2}\b/i.test(nextStep);

    actionItems.push({
      contact: contactName,
      nextStep,
      lastContact,
      daysSinceContact,
      isStale,
      isRelevant
    });
  }

  // Filter to only relevant or stale items, sort by relevance then staleness
  return actionItems
    .filter(item => item.isRelevant || item.isStale)
    .sort((a, b) => {
      // Relevant items first
      if (a.isRelevant && !b.isRelevant) return -1;
      if (!a.isRelevant && b.isRelevant) return 1;
      // Then by staleness (more stale first)
      return b.daysSinceContact - a.daysSinceContact;
    });
}

/**
 * Format CRM Action Items for the brief
 */
export function formatCRMActionItems(items: CRMActionItem[]): string {
  if (items.length === 0) return 'No pending action items.';

  const lines: string[] = ['| Contact | Action | Days Since |', '|---------|--------|------------|'];

  for (const item of items) {
    const staleMarker = item.isStale ? ' ⚠️' : '';
    const relevantMarker = item.isRelevant ? ' 🎯' : '';
    lines.push(`| ${item.contact}${relevantMarker}${staleMarker} | ${item.nextStep.slice(0, 60)}${item.nextStep.length > 60 ? '...' : ''} | ${item.daysSinceContact}d |`);
  }

  return lines.join('\n');
}

// ============================================================================
// Message Parsing Functions
// ============================================================================

/**
 * Parse full messages from Telegram DMs for Messages to Respond section
 */
export function parseFullMessages(telegramPath: string, contacts: Map<string, any>, fullMode: boolean = false): FullMessage[] {
  const dmsPath = join(telegramPath, 'DMs');
  if (!existsSync(dmsPath)) return [];

  const messages: FullMessage[] = [];
  const files = getRecentFiles(dmsPath, 7);
  const fileLimit = fullMode ? Infinity : 20;

  for (const file of files.slice(0, fileLimit)) {
    try {
      const content = readFileSync(file, 'utf-8');
      const contactName = basename(file).replace('.md', '').replace(/_/g, ' ');

      const contact = contacts.get(contactName.toLowerCase());

      const lines = content.split('\n');
      const parsedMessages: FullMessage['messages'] = [];
      let currentDate: string | undefined;
      let lastMessageTime: string | undefined;
      let currentSender: 'them' | 'me' | null = null;
      let currentText: string[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        const dateMatch = line.match(/^##\s+(\d{4}-\d{2}-\d{2})/);
        if (dateMatch) {
          currentDate = dateMatch[1];
          continue;
        }

        const headerMatch = line.match(/^###\s+(\d{1,2}:\d{2})\s*-\s*(.+?)\s*\((@\w+)\)/);

        if (headerMatch) {
          if (currentSender && currentText.length > 0) {
            parsedMessages.push({
              sender: currentSender,
              text: currentText.join(' ').trim(),
              timestamp: lastMessageTime
            });
          }

          const time = headerMatch[1];
          lastMessageTime = currentDate ? `${time} on ${currentDate}` : time;
          const senderName = headerMatch[2].toLowerCase();
          const ownerNames = (process.env.OWNER_NAMES || 'the user').toLowerCase().split(',');
          currentSender = ownerNames.some(n => senderName.includes(n.trim()))
            ? 'me'
            : 'them';
          currentText = [];
        } else if (currentSender && line.trim() && !line.startsWith('#') && !line.startsWith('---')) {
          currentText.push(line.trim());
        }
      }

      if (currentSender && currentText.length > 0) {
        parsedMessages.push({
          sender: currentSender,
          text: currentText.join(' ').trim(),
          timestamp: lastMessageTime
        });
      }

      if (parsedMessages.length > 0) {
        const msgLimit = fullMode ? 20 : 5;
        const recentMessages = parsedMessages.slice(0, msgLimit).reverse();
        const handleMatch = content.match(/@(\w+)/);
        const mostRecentTime = parsedMessages[0]?.timestamp;

        messages.push({
          contactName,
          telegramHandle: handleMatch ? `@${handleMatch[1]}` : undefined,
          contactId: contact?.id,
          relationship: contact?.relationship,
          lastMessageTime: mostRecentTime,
          messages: recentMessages,
          entityContext: contact ? `${contact.relationship || 'Unknown'}, ${contact.company || 'No company'}` : undefined,
          projects: contact?.projects
        });
      }
    } catch {
      // Skip unparseable files
    }
  }

  messages.sort((a, b) => {
    const timeA = a.lastMessageTime || '00:00';
    const timeB = b.lastMessageTime || '00:00';

    const dateMatchA = timeA.match(/on (\d{4}-\d{2}-\d{2})/);
    const dateMatchB = timeB.match(/on (\d{4}-\d{2}-\d{2})/);
    const dateA = dateMatchA ? dateMatchA[1] : '9999-99-99';
    const dateB = dateMatchB ? dateMatchB[1] : '9999-99-99';

    if (dateA !== dateB) {
      return dateB.localeCompare(dateA);
    }
    return timeB.localeCompare(timeA);
  });

  return messages;
}

// ============================================================================
// Calendar Functions
// ============================================================================

/**
 * Parse calendar events for today and upcoming days
 */
export function parseCalendarEvents(calendarPath: string, days: number = 3): CalendarEvent[] {
  if (!existsSync(calendarPath)) return [];

  const events: CalendarEvent[] = [];
  const today = new Date();

  for (let i = 0; i < days; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    const dateStr = date.toISOString().split('T')[0];
    const filePath = join(calendarPath, `${dateStr}.md`);

    if (existsSync(filePath)) {
      const content = readFileSync(filePath, 'utf-8');
      if (content.includes('No events scheduled')) continue;

      const eventMatches = content.matchAll(/##\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})?\s*[-–]?\s*(.+)/g);
      for (const match of eventMatches) {
        const [, startTime, endTime, title] = match;
        const start = new Date(`${dateStr}T${startTime}:00`);
        events.push({
          start,
          end: endTime ? new Date(`${dateStr}T${endTime}:00`) : undefined,
          title: title.trim(),
          attendees: []
        });
      }

      const simpleMatches = content.matchAll(/[-*]\s*(\d{1,2}:\d{2})\s*[-–]\s*(.+)/g);
      for (const match of simpleMatches) {
        const [, time, title] = match;
        events.push({
          start: new Date(`${dateStr}T${time}:00`),
          title: title.trim()
        });
      }
    }
  }

  return events.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/**
 * Match calendar event attendees to CRM contacts and Leads
 * Returns enriched events with matched contact data
 */
export function matchCalendarToContacts(
  events: CalendarEvent[],
  contacts: Map<string, any>,
  leads: LeadSubmission[]
): Array<CalendarEvent & { matchedContact?: any; matchedLead?: LeadSubmission; matchConfidence: 'high' | 'medium' | 'low' }> {
  return events.map(event => {
    const title = event.title.toLowerCase();
    let matchedContact: any = undefined;
    let matchedLead: LeadSubmission | undefined = undefined;
    let matchConfidence: 'high' | 'medium' | 'low' = 'low';

    // Try matching by attendee email first (highest confidence)
    for (const attendee of event.attendees || []) {
      const emailKey = attendee.toLowerCase();
      for (const [key, contact] of contacts.entries()) {
        if (contact.email && contact.email.toLowerCase() === emailKey) {
          matchedContact = contact;
          matchConfidence = 'high';
          break;
        }
      }
      if (matchedContact) break;
    }

    // Try matching by name in event title (medium confidence)
    if (!matchedContact) {
      for (const [key, contact] of contacts.entries()) {
        if (!key.startsWith('tg:') && contact.name) {
          const nameParts = contact.name.toLowerCase().split(' ');
          const lastName = nameParts[nameParts.length - 1];
          const firstName = nameParts[0];
          // Match if both first and last name appear in title, or full name appears
          if ((title.includes(firstName) && title.includes(lastName)) ||
              title.includes(contact.name.toLowerCase())) {
            matchedContact = contact;
            matchConfidence = 'medium';
            break;
          }
        }
      }
    }

    // Try matching against Leads database (for discovery calls)
    if (!matchedContact) {
      for (const lead of leads) {
        const leadName = lead.name.toLowerCase();
        const leadParts = leadName.split(' ');
        const leadLast = leadParts[leadParts.length - 1];
        const leadFirst = leadParts[0];
        if ((title.includes(leadFirst) && title.includes(leadLast)) ||
            title.includes(leadName)) {
          matchedLead = lead;
          matchConfidence = matchConfidence === 'low' ? 'medium' : matchConfidence;
          break;
        }
      }
    }

    return { ...event, matchedContact, matchedLead, matchConfidence };
  });
}

/**
 * Get the last N available Telegram Daily Summaries
 */
export function getRecentTelegramSummaries(count: number = 2): Array<{ date: string; content: string }> {
  const summaryDir = join(INBOX_PATH, 'Telegram/Daily Summary');
  if (!existsSync(summaryDir)) return [];

  const files = readdirSync(summaryDir)
    .filter(f => f.match(/^\d{4}-\d{2}-\d{2}\.md$/))
    .sort()
    .reverse()
    .slice(0, count);

  return files.map(f => ({
    date: f.replace('.md', ''),
    content: readFileSync(join(summaryDir, f), 'utf-8')
  }));
}

// ============================================================================
// Lead Parsing Functions
// ============================================================================

/**
 * Parse leads from Leads bot file
 * Returns leads from the last 7 days for matching with calendar events
 */
export function parseLeadsFromBot(telegramPath: string): LeadSubmission[] {
  const leadsFile = join(telegramPath, process.env.LEADS_BOT_FILE || 'Leads Bot.md');
  if (!existsSync(leadsFile)) return [];

  const content = readFileSync(leadsFile, 'utf-8');
  const leads: LeadSubmission[] = [];

  // Parse date sections (## 2026-02-05)
  const dateSections = content.split(/^## (\d{4}-\d{2}-\d{2})$/m);

  // Skip first element (before first date) and process pairs
  for (let i = 1; i < dateSections.length; i += 2) {
    const date = dateSections[i];
    const sectionContent = dateSections[i + 1] || '';

    // Check if date is within last 7 days
    const sectionDate = new Date(date);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    if (sectionDate < cutoff) continue;

    // Parse individual lead blocks within this date
    // Format: ### HH:MM - Leads Bot (@leadsbot)
    // New Codos lead
    // > Submitted: ...
    // > Name: ...
    const leadBlocks = sectionContent.split(/^### \d{1,2}:\d{2}/m);

    for (const block of leadBlocks) {
      if (!block.includes('New Codos lead')) continue;

      const lead: Partial<LeadSubmission> = { date };

      // Parse submitted timestamp
      const submittedMatch = block.match(/>\s*Submitted:\s*(.+)/);
      if (submittedMatch) lead.submittedAt = submittedMatch[1].trim();

      // Parse name
      const nameMatch = block.match(/>\s*Name:\s*(.+)/);
      if (nameMatch) lead.name = nameMatch[1].trim();

      // Parse team size
      const sizeMatch = block.match(/>\s*Team size:\s*(.+)/);
      if (sizeMatch) lead.teamSize = sizeMatch[1].trim();

      // Parse looking for (can be multiline)
      const lookingForMatch = block.match(/>\s*Looking for:\s*([\s\S]*?)(?=>\s*Tried:|$)/);
      if (lookingForMatch) {
        lead.lookingFor = lookingForMatch[1]
          .split('\n')
          .map(l => l.replace(/^>\s*/, '').trim())
          .filter(l => l)
          .join(' ');
      }

      // Parse tried (can be multiline)
      const triedMatch = block.match(/>\s*Tried:\s*([\s\S]*?)(?=>\s*Source:|$)/);
      if (triedMatch) {
        lead.tried = triedMatch[1]
          .split('\n')
          .map(l => l.replace(/^>\s*/, '').trim())
          .filter(l => l)
          .join(' ');
      }

      // Parse source
      const sourceMatch = block.match(/>\s*Source:\s*(.+)/);
      if (sourceMatch) lead.source = sourceMatch[1].trim();

      // Parse email
      const emailMatch = block.match(/>\s*Email:\s*(.+)/);
      if (emailMatch) lead.email = emailMatch[1].trim();

      // Parse telegram
      const telegramMatch = block.match(/>\s*Telegram:\s*(.+)/);
      if (telegramMatch) lead.telegram = telegramMatch[1].trim();

      // Only add if we have at least name
      if (lead.name && lead.name !== 'test' && lead.name !== 'Aa' && lead.name.length > 1) {
        leads.push(lead as LeadSubmission);
      }
    }
  }

  return leads;
}

/**
 * Format leads for the brief context
 * Groups by date and provides full context for call prep
 */
export function formatLeadsForBrief(leads: LeadSubmission[]): string {
  if (leads.length === 0) return 'No recent leads.';

  const lines: string[] = [];

  // Group by date
  const byDate = new Map<string, LeadSubmission[]>();
  for (const lead of leads) {
    const existing = byDate.get(lead.date) || [];
    existing.push(lead);
    byDate.set(lead.date, existing);
  }

  // Sort dates descending
  const sortedDates = Array.from(byDate.keys()).sort().reverse();

  for (const date of sortedDates) {
    lines.push(`### ${date}`);
    const dateLeads = byDate.get(date) || [];

    for (const lead of dateLeads) {
      lines.push(`\n**${lead.name}** (${lead.teamSize} employees)`);
      lines.push(`- **Looking for:** ${lead.lookingFor || 'Not specified'}`);
      lines.push(`- **Already tried:** ${lead.tried || 'Not specified'}`);
      lines.push(`- **Email:** ${lead.email || 'N/A'}`);
      if (lead.telegram) lines.push(`- **Telegram:** ${lead.telegram}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ============================================================================
// Health Calculator (inline to avoid import issues)
// ============================================================================

/**
 * Get at-risk contacts for brief
 */
function getAtRiskContacts(): Array<{
  name: string;
  score: number;
  trend: string;
  risk: string;
  relationship: string;
}> {
  const contactsPath = join(CRM_PATH, 'contacts.yaml');
  if (!existsSync(contactsPath)) {
    return [];
  }

  try {
    const data = parseYaml(readFileSync(contactsPath, 'utf-8'));
    const atRisk: Array<{
      name: string;
      score: number;
      trend: string;
      risk: string;
      relationship: string;
    }> = [];

    for (const contact of data.contacts || []) {
      if (contact.category === 'personal') continue;
      if (contact.health_score !== undefined && contact.health_score < 70) {
        atRisk.push({
          name: contact.name,
          score: contact.health_score,
          trend: contact.health_trend || 'stable',
          risk: 'Low engagement',
          relationship: contact.relationship || 'Unknown'
        });
      }
    }

    return atRisk.sort((a, b) => a.score - b.score).slice(0, 10);
  } catch {
    return [];
  }
}

/**
 * Format relationship health section for brief
 */
export function formatHealthSection(): string {
  const atRisk = getAtRiskContacts();

  if (atRisk.length === 0) {
    return 'All key relationships healthy.';
  }

  const lines: string[] = ['### Relationship Health'];
  lines.push('| Contact | Health | Trend | Risk |');
  lines.push('|---------|--------|-------|------|');

  for (const contact of atRisk.slice(0, 5)) {
    const trendIcon = contact.trend === 'declining' ? '⬇️' :
                      contact.trend === 'improving' ? '⬆️' : '➡️';
    lines.push(`| ${contact.name} | ${contact.score} | ${trendIcon} | ${contact.risk} |`);
  }

  if (atRisk.length > 5) {
    lines.push('');
    lines.push(`*+${atRisk.length - 5} more at-risk contacts*`);
  }

  return lines.join('\n');
}

/**
 * Update all health scores (calls the health-calculator module)
 */
export function updateAllHealthScores(): void {
  try {
    // Dynamic import to avoid circular dependency issues
    const healthCalcPath = join(VAULT_PATH, '4 - CRM/lib/health-calculator.ts');
    if (existsSync(healthCalcPath)) {
      // Use Bun's native import
      const { updateAllHealthScores: updateScores } = require(healthCalcPath);
      updateScores();
    }
  } catch (err) {
    // Non-fatal, continue without health update
    console.error('Health score update skipped:', err);
  }
}

// ============================================================================
// Main Context Gathering
// ============================================================================

/**
 * Gather all context for the brief
 */
export function gatherContext(fullMode: boolean = false): BriefContext {
  const briefedItems = loadBriefedItems();
  const contactMapping = loadContactMapping();
  const contacts = loadContacts();

  // Core Memory
  const aboutMe = readIfExists(join(CORE_MEMORY_PATH, 'About me.md'));
  const goals = readIfExists(join(CORE_MEMORY_PATH, 'Goals.md'));
  const briefFeedback = readIfExists(join(CORE_MEMORY_PATH, 'Brief Feedback.md'));
  const myFears = readIfExists(join(CORE_MEMORY_PATH, 'My fears.md'));
  const principles = readIfExists(join(CORE_MEMORY_PATH, 'Principles and Life Lessons.md'));

  // Inbox sources
  const inbox: SourceData[] = [];

  // Telegram - summaries only (Messages Needing Response is now in Daily Summary)
  const telegramPath = join(INBOX_PATH, 'Telegram');
  const fullMessages: FullMessage[] = [];

  // Also get daily summaries for context
  const telegramSummaries = getRecentTelegramSummaries(fullMode ? 7 : 3);
  let crisisSignals: string | null = null;

  if (telegramSummaries.length > 0) {
    const latestSummary = telegramSummaries[0].content;
    const crisisMatch = latestSummary.match(/## CRISIS SIGNALS[\s\S]*?(?=\n## |$)/);
    if (crisisMatch) {
      crisisSignals = crisisMatch[0];
    }

    inbox.push({
      source: 'Telegram (Daily Summaries)',
      items: telegramSummaries.map(s => ({
        title: `Summary ${s.date}`,
        content: s.content,
        date: s.date
      }))
    });
  }

  // Other inbox sources
  const otherSources = ['Gmail', 'Slack', 'Linear', 'Notion', 'GitHub'];
  for (const source of otherSources) {
    const sourcePath = join(INBOX_PATH, source);
    if (existsSync(sourcePath)) {
      const data = gatherSourceData(sourcePath, source, 10, briefedItems, 1, fullMode);
      if (data.items.length > 0) inbox.push(data);
    }
  }

  // Granola summaries (high value)
  const granolaSummaries = join(INBOX_PATH, 'Granola/Summaries');
  if (existsSync(granolaSummaries)) {
    const summaryData = gatherSourceData(granolaSummaries, 'Meeting Summaries', 10, briefedItems, 1, fullMode);
    if (summaryData.items.length > 0) inbox.push(summaryData);
  }

  // Calendar events
  const calendarPath = join(INBOX_PATH, 'Calendar');
  const calendarEvents = parseCalendarEvents(calendarPath, fullMode ? 7 : 3);

  // Also add raw calendar content
  if (existsSync(calendarPath)) {
    const calendarItems: SourceData['items'] = [];
    const today = new Date();

    for (let i = 0; i < 7; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);
      const dateStr = date.toISOString().split('T')[0];
      const filePath = join(calendarPath, `${dateStr}.md`);

      if (existsSync(filePath)) {
        const content = readFileSync(filePath, 'utf-8');
        if (!content.includes('No events scheduled')) {
          calendarItems.push({
            title: dateStr,
            content: content,
            date: dateStr
          });
        }
      }
    }

    if (calendarItems.length > 0) {
      inbox.push({ source: 'Calendar (next 7 days)', items: calendarItems });
    }
  }

  // Weekly review
  const weeklyReview = getLatestWeeklyReview();

  // Recent todos
  const recentTodos = gatherSourceData(TODOS_PATH, 'Recent Todos', fullMode ? Infinity : 3, undefined, fullMode ? 7 : 3, fullMode);

  // Update and get relationship health
  try {
    updateAllHealthScores();
  } catch {
    // Non-fatal, continue without health update
  }
  const relationshipHealth = formatHealthSection();

  // CRM Action Items
  const crmActionItems = parseCRMActionItems();

  // Parse leads from bot for call prep
  const leads = parseLeadsFromBot(telegramPath);

  return {
    aboutMe,
    goals,
    briefFeedback,
    myFears,
    principles,
    inbox,
    weeklyReview,
    recentTodos,
    briefedItems,
    contactMapping,
    crisisSignals,
    fullMessages,
    calendarEvents,
    contacts,
    relationshipHealth,
    crmActionItems,
    leads
  };
}

// ============================================================================
// Formatting Functions
// ============================================================================

/**
 * Format full messages for the brief
 */
export function formatFullMessages(messages: FullMessage[], fullMode: boolean = false): string {
  if (messages.length === 0) return 'No pending messages.';

  const lines: string[] = [];
  const convLimit = fullMode ? Infinity : 10;
  const msgLimit = fullMode ? 20 : 5;

  for (const msg of messages.slice(0, convLimit)) {
    lines.push(`### ${msg.contactName}${msg.telegramHandle ? ` (${msg.telegramHandle})` : ''}`);
    if (msg.lastMessageTime) {
      lines.push(`*Last message: ${msg.lastMessageTime}*`);
    }
    if (msg.entityContext) {
      lines.push(`*Entity: ${msg.contactId || 'unknown'} | ${msg.entityContext}*`);
    }
    lines.push('');

    for (const m of msg.messages.slice(-msgLimit)) {
      const sender = m.sender === 'me' ? 'You' : msg.contactName.split(' ')[0];
      lines.push(`**${sender}:** ${m.text}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Format calendar for the brief with prep column
 */
export function formatCalendarWithPrep(events: CalendarEvent[]): string {
  if (events.length === 0) return 'No events scheduled.';

  const lines: string[] = ['| Time | Event | Prep |', '|------|-------|------|'];

  const today = new Date().toISOString().split('T')[0];

  for (const event of events) {
    const eventDate = event.start.toISOString().split('T')[0];
    const isToday = eventDate === today;
    const time = event.start.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const datePrefix = isToday ? '' : `(${eventDate.slice(5)}) `;

    lines.push(`| ${datePrefix}${time} | ${event.title} | [Prep needed] |`);
  }

  return lines.join('\n');
}

/**
 * Load and format Gmail emails, filtering for actionable items only
 */
export function loadActionableEmails(gmailPath: string): string {
  if (!existsSync(gmailPath)) return 'No email data available.';

  // Get today's and yesterday's email files
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  let content = '';
  for (const dateStr of [today, yesterday]) {
    const filePath = join(gmailPath, `${dateStr}.md`);
    if (existsSync(filePath)) {
      content += readFileSync(filePath, 'utf-8') + '\n';
    }
  }

  if (!content.trim()) return 'No recent emails.';
  return content;
}

/**
 * Get leverage rule descriptions
 */
export function getLeverageRuleDescriptions(): string {
  const rulesPath = join(CODOS_PATH, 'dev/Ops/atlas/leverage-rules.yaml');
  if (!existsSync(rulesPath)) {
    return '## Leverage Scoring Rules\nNo rules configured.';
  }

  try {
    const config = parseYaml(readFileSync(rulesPath, 'utf-8'));
    const lines: string[] = ['## Leverage Scoring Rules'];
    lines.push(`Priority threshold: ${config.thresholds?.priority_minimum || 9}+`);
    lines.push(`Surface threshold: ${config.thresholds?.surface_minimum || 7}+`);
    lines.push('');

    for (const rule of config.rules || []) {
      lines.push(`- **${rule.name}** (${rule.score}): ${rule.description || 'No description'}`);
    }

    return lines.join('\n');
  } catch {
    return '## Leverage Scoring Rules\nFailed to load rules.';
  }
}

/**
 * Format all context into a markdown string suitable for Claude
 */
export function formatContext(context: BriefContext, fullMode: boolean = false): string {
  const parts: string[] = [];

  // Crisis signals first
  if (context.crisisSignals) {
    parts.push(`## CRISIS SIGNALS (MUST ADDRESS)\n${context.crisisSignals}`);
  }

  // Brief feedback rules
  if (context.briefFeedback) {
    parts.push(`## IMPORTANT: Brief Quality Rules\n${context.briefFeedback}`);
  }

  // Leverage scoring rules
  parts.push(getLeverageRuleDescriptions());

  // Contact mapping
  const { contactMapping } = context;
  const mappingLines: string[] = ['## Contact->Project Mapping'];
  mappingLines.push(`Projects: ${contactMapping.projectList.join(', ')}`);
  mappingLines.push(`\nContact associations:`);
  for (const [name, projects] of Object.entries(contactMapping.contactToProjects)) {
    mappingLines.push(`- ${name} -> ${projects.join(', ')}`);
  }
  mappingLines.push(`\nPersonal contacts: ${contactMapping.personalContacts.join(', ')}`);
  parts.push(mappingLines.join('\n'));

  if (context.goals) {
    parts.push(`## Goals\n${context.goals}`);
  }

  if (context.aboutMe) {
    parts.push(`## About Me\n${context.aboutMe}`);
  }

  if (context.myFears) {
    parts.push(`## My Fears\n${context.myFears}`);
  }

  if (context.principles) {
    parts.push(`## Principles\n${context.principles}`);
  }

  // Full messages for Messages to Respond section
  parts.push(`## Full Messages (use for "Messages to Respond" section)\n${formatFullMessages(context.fullMessages, fullMode)}`);

  // Calendar with prep + CRM matching
  const enrichedEvents = matchCalendarToContacts(context.calendarEvents, context.contacts, context.leads);
  const calendarLines: string[] = ['| Time | Event | Match | Prep |', '|------|-------|-------|------|'];
  const today = new Date().toISOString().split('T')[0];

  for (const event of enrichedEvents) {
    const eventDate = event.start.toISOString().split('T')[0];
    const isToday = eventDate === today;
    const time = event.start.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const datePrefix = isToday ? '' : `(${eventDate.slice(5)}) `;
    const matchInfo = event.matchedContact
      ? `${event.matchedContact.name} (${event.matchConfidence})`
      : event.matchedLead
        ? `Lead: ${event.matchedLead.name} (${event.matchConfidence})`
        : 'No match';
    calendarLines.push(`| ${datePrefix}${time} | ${event.title} | ${matchInfo} | [Prep needed] |`);
  }
  parts.push(`## Today's Schedule\n${calendarLines.join('\n')}`);

  // Gmail - actionable emails
  const gmailPath = join(INBOX_PATH, 'Gmail');
  const emailContent = loadActionableEmails(gmailPath);
  if (emailContent !== 'No email data available.' && emailContent !== 'No recent emails.') {
    parts.push(`## Email Inbox (actionable only)\n${emailContent}`);
  }

  // Relationship health
  parts.push(`## Relationship Health (include in Context Loaded section)\n${context.relationshipHealth}`);

  // CRM Action Items
  if (context.crmActionItems.length > 0) {
    parts.push(`## CRM Follow-ups (surface in Priority Actions)\n🎯 = relevant today/tomorrow, ⚠️ = stale (>7 days)\n\n${formatCRMActionItems(context.crmActionItems)}`);
  }

  // Leads from bot - CRITICAL for call prep
  if (context.leads.length > 0) {
    parts.push(`## LEADS DATABASE (use for call prep - match names with calendar events)\n\nThese are form submissions from prospects. When generating call prep, find the matching lead by name and use their data to fill the profile table (Org, Size, Request, Tried, Maturity, Play).\n\n${formatLeadsForBrief(context.leads)}`);
  }

  // Inbox sources
  for (const source of context.inbox) {
    parts.push(`## ${source.source}`);
    for (const item of source.items) {
      const itemContent = fullMode ? item.content : item.content.slice(0, 1500);
      parts.push(`### ${item.title} (${item.date || 'recent'})\n${itemContent}\n`);
    }
  }

  if (context.weeklyReview) {
    parts.push(`## Latest Weekly Review\n${context.weeklyReview}`);
  }

  if (context.recentTodos.items.length > 0) {
    parts.push(`## Recent Todos`);
    for (const item of context.recentTodos.items) {
      const todoContent = fullMode ? item.content : item.content.slice(0, 2000);
      parts.push(`### ${item.title}\n${todoContent}\n`);
    }
  }

  return parts.join('\n\n');
}

// ============================================================================
// CLI Entry Point
// ============================================================================

if (import.meta.main) {
  // Parse CLI flags
  const fullMode = process.argv.includes('--full');

  // Output context to stdout
  const context = gatherContext(fullMode);
  const formatted = formatContext(context, fullMode);

  // Add header with date
  const today = new Date().toISOString().split('T')[0];
  const dayOfWeek = new Date().toLocaleDateString('en-US', { weekday: 'long' });

  console.log(`# Brief Context - ${dayOfWeek}, ${today}\n`);
  console.log(formatted);

  // Log stats to stderr so they don't interfere with piped output
  const newItemCount = context.inbox.reduce((sum, src) => sum + src.items.length, 0);
  console.error(`\n[Stats] Mode: ${fullMode ? 'full' : 'truncated'}, Messages: ${context.fullMessages.length}, Calendar: ${context.calendarEvents.length}, Inbox items: ${newItemCount}`);
}
