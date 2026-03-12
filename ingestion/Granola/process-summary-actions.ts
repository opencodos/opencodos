#!/usr/bin/env bun
/**
 * Process Summary Actions
 *
 * Extracts CRM updates and tasks from Granola summaries
 * and applies them directly to contacts.yaml and per-person profile files.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, copyFileSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';
import { getVaultRoot } from '../lib/paths';
import { atomicWriteFileSync } from '../lib/fs';

// Configuration — resolve paths from ~/.codos/paths.json
const VAULT_ROOT = getVaultRoot();
const SUMMARIES_PATH = join(VAULT_ROOT, '1 - Inbox (Last 7 days)/Granola/Summaries');
const TODOS_PATH = join(VAULT_ROOT, '3 - Todos');
const CRM_PATH = join(VAULT_ROOT, '4 - CRM');
const CONTACTS_FILE = join(CRM_PATH, 'contacts.yaml');
const PROFILES_PATH = join(CRM_PATH, 'Profiles');
const PROCESSED_FILE = join(SUMMARIES_PATH, '.processed.json');

// Fuzzy matching thresholds
const HIGH_CONFIDENCE_THRESHOLD = 0.95;
const LOW_CONFIDENCE_THRESHOLD = 0.6;
const AMBIGUITY_DELTA = 0.05;

interface ProcessedState {
  processedFiles: string[];
  lastRun: string;
}

interface ExtractedActions {
  tasks: string[];
  crmUpdates: { person: string; update: string }[];
  memoryUpdates: string[];
  callTitle: string;
  callDate: string;
  attendees: string[];
}

interface Contact {
  id: string;
  name: string;
  company: string | null;
  relationship: string;
  hypothesis: string;
  last_connection: string | null;
  last_messages: { me: string | null; them: string | null };
  next_step: string | null;
  telegram_id: number | null;
  email: string | null;
  interactions_365d: number;
  sources: string[];
  auto_created: boolean;
  profile_path?: string;
  type: string[];  // ["personal"] | ["client"] | ["investor"] or combinations
  deal_stage: string | null;  // first_contact | call | negotiation | closed_won | closed_lost | null
  deal_value: number | null;  // USD amount
}

interface ContactsData {
  metadata: {
    last_updated: string;
    total_contacts: number;
    version: number;
  };
  contacts: Contact[];
}

/**
 * Get today's date in YYYY-MM-DD format
 */
function getToday(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Load processed state
 */
function loadProcessedState(): ProcessedState {
  if (existsSync(PROCESSED_FILE)) {
    try {
      return JSON.parse(readFileSync(PROCESSED_FILE, 'utf-8'));
    } catch {
      return { processedFiles: [], lastRun: '' };
    }
  }
  return { processedFiles: [], lastRun: '' };
}

/**
 * Save processed state
 */
function saveProcessedState(state: ProcessedState): void {
  atomicWriteFileSync(PROCESSED_FILE, JSON.stringify(state, null, 2));
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Check if a name is valid (not markdown-formatted or contains special chars)
 */
function isValidContactName(name: string): boolean {
  // Skip names wrapped in markdown or containing special characters
  if (name.startsWith('*') || name.startsWith('|') || name.startsWith('[')) {
    return false;
  }
  // Skip names that are all special characters
  if (!/[a-zA-Zа-яА-Я]/.test(name)) {
    return false;
  }
  return true;
}

/**
 * Calculate similarity score between two names (0-1)
 */
function nameSimilarity(name1: string, name2: string): number {
  const s1 = name1.toLowerCase().trim();
  const s2 = name2.toLowerCase().trim();

  // Exact match
  if (s1 === s2) return 1.0;

  const parts1 = s1.split(/\s+/);
  const parts2 = s2.split(/\s+/);

  // Levenshtein-based similarity
  const maxLen = Math.max(s1.length, s2.length);
  if (maxLen === 0) return 1.0;
  const distance = levenshteinDistance(s1, s2);
  let score = 1 - distance / maxLen;

  // Check if one name is contained in the other (e.g., "Marcus" matches "Alex Chen")
  if (s1.includes(s2) || s2.includes(s1)) {
    score = Math.max(score, 0.9);
  }

  // Check first name match (if both have first names)
  if (parts1[0] === parts2[0] && parts1[0].length > 2) {
    score = Math.max(score, 0.85);
  }

  // Penalize mismatched last names when both are multi-word names
  if (parts1.length >= 2 && parts2.length >= 2) {
    const last1 = parts1[parts1.length - 1];
    const last2 = parts2[parts2.length - 1];
    if (last1 !== last2) {
      score = Math.min(score, 0.79);
    }
  }

  return score;
}

/**
 * Find best matching contact for a name
 */
function findBestMatch(
  name: string,
  contacts: Contact[]
): { contact: Contact | null; confidence: number; second: Contact | null; secondConfidence: number } {
  let bestMatch: Contact | null = null;
  let secondMatch: Contact | null = null;
  let bestScore = 0;
  let secondScore = 0;

  for (const contact of contacts) {
    const score = nameSimilarity(name, contact.name);
    if (score > bestScore) {
      secondScore = bestScore;
      secondMatch = bestMatch;
      bestScore = score;
      bestMatch = contact;
    } else if (score > secondScore) {
      secondScore = score;
      secondMatch = contact;
    }
  }

  return { contact: bestMatch, confidence: bestScore, second: secondMatch, secondConfidence: secondScore };
}

/**
 * Load contacts from YAML file
 */
function loadContacts(): ContactsData {
  if (!existsSync(CONTACTS_FILE)) {
    return {
      metadata: {
        last_updated: new Date().toISOString(),
        total_contacts: 0,
        version: 1
      },
      contacts: []
    };
  }

  const content = readFileSync(CONTACTS_FILE, 'utf-8');
  return yaml.load(content) as ContactsData;
}

/**
 * Save contacts to YAML file (with backup)
 */
function saveContacts(data: ContactsData): void {
  // Create backup
  if (existsSync(CONTACTS_FILE)) {
    const backupPath = CONTACTS_FILE.replace('.yaml', `.backup.${Date.now()}.yaml`);
    copyFileSync(CONTACTS_FILE, backupPath);
  }

  // Update metadata
  data.metadata.last_updated = new Date().toISOString();
  data.metadata.total_contacts = data.contacts.length;

  const yamlContent = yaml.dump(data, { lineWidth: -1, quotingType: '"' });
  writeFileSync(CONTACTS_FILE, yamlContent);
}

/**
 * Generate next contact ID
 */
function generateContactId(contacts: Contact[]): string {
  const maxId = contacts.reduce((max, c) => {
    const num = parseInt(c.id.replace('c_', ''), 10);
    return num > max ? num : max;
  }, 0);
  return `c_${String(maxId + 1).padStart(3, '0')}`;
}

/**
 * Ensure Profiles directory exists
 */
function ensureProfilesDir(): void {
  if (!existsSync(PROFILES_PATH)) {
    mkdirSync(PROFILES_PATH, { recursive: true });
  }
}

/**
 * Get profile path for a contact name
 */
function getProfilePath(name: string): string {
  return join(PROFILES_PATH, `${name}.md`);
}

/**
 * Normalize a string for dedup comparison (lowercase, trim, remove extra whitespace)
 */
function normalizeForDedup(str: string): string {
  return str.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Check if an entry already exists in the profile (for deduplication)
 */
function entryExistsInProfile(content: string, date: string, title: string, update: string): boolean {
  // Check for exact match in Interaction Log section
  const normalizedUpdate = normalizeForDedup(update);
  const logPattern = new RegExp(`### ${date} - ${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n([\\s\\S]*?)(?=\\n### |\\n## |$)`, 'g');
  let match;
  while ((match = logPattern.exec(content)) !== null) {
    const existingEntries = match[1].split('\n')
      .filter(line => line.startsWith('- '))
      .map(line => normalizeForDedup(line.replace(/^- /, '')));
    if (existingEntries.some(e => e === normalizedUpdate)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a note already exists in the Notes section
 */
function noteExistsInProfile(content: string, note: string): boolean {
  const notesMatch = content.match(/## Notes\n([\s\S]*?)(?=\n## |$)/);
  if (!notesMatch) return false;
  const existingNotes = notesMatch[1].split('\n')
    .filter(line => line.startsWith('- '))
    .map(line => normalizeForDedup(line.replace(/^- /, '')));
  return existingNotes.some(n => n === normalizeForDedup(note));
}

/**
 * Create or update a profile file for a person
 */
function updateProfileFile(
  name: string,
  updates: string[],
  callTitle: string,
  callDate: string,
  company?: string
): void {
  ensureProfilesDir();
  const profilePath = getProfilePath(name);
  const today = callDate || getToday();

  if (existsSync(profilePath)) {
    // Append to existing profile
    let content = readFileSync(profilePath, 'utf-8');

    // Update "Last contact" in Quick Facts
    content = content.replace(
      /- Last contact: .+/,
      `- Last contact: ${today}`
    );

    // Filter out updates that already exist (deduplication)
    const newNotes = updates.filter(u => !noteExistsInProfile(content, u));
    const newLogEntries = updates.filter(u => !entryExistsInProfile(content, today, callTitle, u));

    // Add to Notes section (only new notes)
    if (newNotes.length > 0) {
      const notesMatch = content.match(/## Notes\n([\s\S]*?)(?=\n## |$)/);
      if (notesMatch) {
        const existingNotes = notesMatch[1].trim();
        const notesText = newNotes.map(u => `- ${u}`).join('\n');
        content = content.replace(
          `## Notes\n${notesMatch[1]}`,
          `## Notes\n${existingNotes}\n${notesText}\n`
        );
      }
    }

    // Add to Interaction Log (only new entries)
    if (newLogEntries.length > 0) {
      const logEntry = `\n### ${today} - ${callTitle}\n${newLogEntries.map(u => `- ${u}`).join('\n')}\n`;
      if (content.includes('## Interaction Log')) {
        content = content.replace('## Interaction Log', `## Interaction Log${logEntry}`);
      } else {
        content += `\n## Interaction Log${logEntry}`;
      }
    }

    writeFileSync(profilePath, content);
  } else {
    // Create new profile
    const content = `# ${name}

## Quick Facts
- Company: ${company || 'Unknown'}
- Relationship: 2 - Warmish
- Last contact: ${today}

## Notes
${updates.map(u => `- ${u}`).join('\n')}

## Interaction Log
### ${today} - ${callTitle}
${updates.map(u => `- ${u}`).join('\n')}
`;
    writeFileSync(profilePath, content);
  }
}

/**
 * Apply CRM updates directly to contacts.yaml and profile files
 */
function applyCrmUpdatesToYaml(
  actions: ExtractedActions,
  silent: boolean = false
): { applied: number; pending: number; created: number } {
  const result = { applied: 0, pending: 0, created: 0 };

  if (actions.crmUpdates.length === 0) return result;

  const data = loadContacts();
  const pendingUpdates: { person: string; update: string; confidence: number }[] = [];

  const isAttendeeMatch = (name: string): boolean => {
    if (!actions.attendees || actions.attendees.length === 0) return false;
    return actions.attendees.some(attendee =>
      nameSimilarity(name, attendee) >= 0.9 || normalizeForDedup(name) === normalizeForDedup(attendee)
    );
  };

  for (const update of actions.crmUpdates) {
    const { contact, confidence, second, secondConfidence } = findBestMatch(update.person, data.contacts);

    const isAmbiguous =
      contact &&
      confidence >= HIGH_CONFIDENCE_THRESHOLD &&
      second &&
      (confidence - secondConfidence) <= AMBIGUITY_DELTA;

    if (isAmbiguous) {
      pendingUpdates.push({
        person: update.person,
        update: `${update.update} (Ambiguous match: ${contact?.name} vs ${second?.name})`,
        confidence
      });
      result.pending++;
      if (!silent) {
        console.log(`     ⏳ Pending: ${update.person} ambiguous between ${contact?.name} and ${second?.name}`);
      }
    } else if (confidence >= HIGH_CONFIDENCE_THRESHOLD && contact) {
      // High confidence - apply directly
      updateProfileFile(
        contact.name,
        [update.update],
        actions.callTitle,
        actions.callDate,
        contact.company || undefined
      );

      // Add profile_path if not set
      if (!contact.profile_path) {
        contact.profile_path = `Profiles/${contact.name}.md`;
      }

      // Update last_connection
      contact.last_connection = actions.callDate || getToday();

      // Clear stale next_step - let crm_update.py regenerate from fresh context
      contact.next_step = null;

      result.applied++;
      if (!silent) {
        console.log(`     ✅ Applied to ${contact.name} (${(confidence * 100).toFixed(0)}% match)`);
      }
    } else if (confidence >= LOW_CONFIDENCE_THRESHOLD && contact) {
      // Medium confidence - add to pending
      pendingUpdates.push({ person: update.person, update: update.update, confidence });
      result.pending++;
      if (!silent) {
        console.log(`     ⏳ Pending: ${update.person} → ${contact.name}? (${(confidence * 100).toFixed(0)}% match)`);
      }
    } else {
      // No match - only create if attendee is explicitly on the call
      if (isAttendeeMatch(update.person)) {
        const newContact: Contact = {
          id: generateContactId(data.contacts),
          name: update.person,
          company: extractCompanyFromUpdate(update.update),
          relationship: '2 - Warmish',
          hypothesis: 'TBD',
          last_connection: actions.callDate || getToday(),
          last_messages: { me: null, them: null },
          next_step: null,
          telegram_id: null,
          email: null,
          interactions_365d: 0,
          sources: ['granola'],
          auto_created: true,
          profile_path: `Profiles/${update.person}.md`,
          type: ["personal"],
          deal_stage: null,
          deal_value: null
        };

        data.contacts.push(newContact);

        // Create profile file
        updateProfileFile(
          update.person,
          [update.update],
          actions.callTitle,
          actions.callDate,
          newContact.company || undefined
        );

        result.created++;
        if (!silent) {
          console.log(`     🆕 Created new contact (attendee): ${update.person}`);
        }
      } else {
        pendingUpdates.push({
          person: update.person,
          update: `${update.update} (No match; not in attendees)`,
          confidence: 0
        });
        result.pending++;
        if (!silent) {
          console.log(`     ⏳ Pending: ${update.person} (no match, not attendee)`);
        }
      }
    }
  }

  // Save updated contacts
  if (result.applied > 0 || result.created > 0) {
    saveContacts(data);
  }

  // Write pending updates to file (low confidence matches)
  if (pendingUpdates.length > 0) {
    appendPendingUpdates(pendingUpdates, actions.callTitle, actions.callDate);
  }

  return result;
}

/**
 * Extract company name from update text (simple heuristic)
 */
function extractCompanyFromUpdate(update: string): string | null {
  // Look for patterns like "works at X", "at X", "from X"
  const patterns = [
    /works at ([A-Z][A-Za-z0-9\s]+?)(?:;|,|\.|$)/,
    /at ([A-Z][A-Za-z0-9\s]+?)(?:;|,|\.|$)/,
    /from ([A-Z][A-Za-z0-9\s]+?)(?:;|,|\.|$)/,
    /joined ([A-Z][A-Za-z0-9\s]+?)(?:;|,|\.|$)/
  ];

  for (const pattern of patterns) {
    const match = update.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }

  return null;
}

/**
 * Extract person mentions from full summary text (not just CRM tables)
 */
function extractPersonMentions(
  content: string,
  contacts: Contact[]
): { name: string; context: string; section: string }[] {
  const mentions: { name: string; context: string; section: string }[] = [];

  // Build patterns for first names (>2 chars, valid names only)
  const namePatterns: { pattern: RegExp; contact: Contact }[] = [];
  for (const contact of contacts) {
    // Skip malformed contact names (markdown-wrapped, etc.)
    if (!isValidContactName(contact.name)) continue;

    const firstName = contact.name.split(' ')[0];
    if (firstName.length > 2 && isValidContactName(firstName)) {
      namePatterns.push({
        pattern: new RegExp(`\\b${escapeRegex(firstName)}\\b`, 'gi'),
        contact
      });
    }
  }

  // Split content into sections
  const sections = content.split(/^## /m);

  for (const section of sections) {
    const sectionName = section.split('\n')[0].trim();
    const sectionContent = section.slice(sectionName.length);

    // Skip Atlas Next Steps section (handled separately by CRM table parser)
    if (sectionName === 'Atlas Next Steps') continue;

    for (const { pattern, contact } of namePatterns) {
      // Find lines containing this person's name
      const lines = sectionContent.split('\n');
      for (const line of lines) {
        if (pattern.test(line) && line.trim().length > 10) {
          // Skip if this is the owner (self-reference)
          const ownerNames = (process.env.OWNER_NAMES || 'the user').toLowerCase().split(',');
          if (ownerNames.some(n => contact.name.toLowerCase().includes(n.trim()))) continue;

          mentions.push({
            name: contact.name,
            context: line.replace(/^[-*]\s*/, '').trim(),
            section: sectionName || 'Summary'
          });
        }
      }
    }
  }

  // Deduplicate by name+context
  return [...new Map(mentions.map(m => [`${m.name}:${m.context}`, m])).values()];
}

/**
 * Parse attendees string into array of names (excluding the owner)
 */
function parseAttendees(attendeeStr: string): string[] {
  const ownerNames = (process.env.OWNER_NAMES || 'the user').toLowerCase().split(',');
  return attendeeStr
    .split(/,\s*/)
    .map(a => a.replace(/\s*\([^)]+\)\s*/g, '').trim())
    .filter(a => a.length > 0 && !ownerNames.some(n => a.toLowerCase().includes(n.trim())));
}

/**
 * Append low-confidence updates to Pending Updates.md
 */
function appendPendingUpdates(
  updates: { person: string; update: string; confidence: number }[],
  callTitle: string,
  callDate: string
): void {
  const pendingFile = join(CRM_PATH, 'Pending Updates.md');

  const updateSection = `
## From: ${callTitle} (${callDate})
*Requires manual review - low confidence matches*

${updates.map(u => `### ${u.person} (${(u.confidence * 100).toFixed(0)}% match)\n- ${u.update}`).join('\n\n')}

---
`;

  if (existsSync(pendingFile)) {
    let content = readFileSync(pendingFile, 'utf-8');
    if (content.includes(`From: ${callTitle}`)) {
      return; // Already added
    }
    content = content + updateSection;
    writeFileSync(pendingFile, content);
  } else {
    const newContent = `# Pending CRM Updates

Updates extracted from call summaries that need manual review (low confidence matches).

${updateSection}`;
    writeFileSync(pendingFile, newContent);
  }
}

/**
 * Apply memory updates to per-person profile files
 */
function applyMemoryUpdates(
  actions: ExtractedActions,
  silent: boolean = false
): number {
  if (actions.memoryUpdates.length === 0) return 0;

  const data = loadContacts();
  let updatedCount = 0;

  // Group updates by person (parse "Person Name does X" patterns)
  const personUpdates: Map<string, string[]> = new Map();

  for (const update of actions.memoryUpdates) {
    // Try to extract person name from update
    // Common patterns: "Marcus works at...", "Marcus's wife...", "Name does..."
    const personMatch = update.match(/^-?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:works|is|has|was|will|'s|does|can|should)/);

    if (personMatch) {
      const personName = personMatch[1];
      const existing = personUpdates.get(personName) || [];
      existing.push(update.replace(/^-?\s*/, ''));
      personUpdates.set(personName, existing);
    }
  }

  // Apply updates to profile files
  for (const [personName, updates] of personUpdates) {
    const { contact, confidence } = findBestMatch(personName, data.contacts);

    if (confidence >= LOW_CONFIDENCE_THRESHOLD && contact) {
      updateProfileFile(
        contact.name,
        updates,
        actions.callTitle,
        actions.callDate
      );

      updatedCount++;
      if (!silent) {
        console.log(`     📝 Updated profile: ${contact.name} (${updates.length} facts)`);
      }
    } else {
      if (!silent) {
        console.log(`     ⏭️  Skipped memory update for unmatched person: ${personName}`);
      }
    }
  }

  return updatedCount;
}

/**
 * Extract actions from a summary markdown file
 */
function extractActionsFromSummary(content: string, filename: string): ExtractedActions {
  const actions: ExtractedActions = {
    tasks: [],
    crmUpdates: [],
    memoryUpdates: [],
    callTitle: '',
    callDate: '',
    attendees: []
  };

  // Extract title
  const titleMatch = content.match(/^# Summary: (.+)$/m);
  if (titleMatch) {
    actions.callTitle = titleMatch[1];
  }

  // Extract date
  const dateMatch = content.match(/\*\*Date:\*\* (.+)$/m);
  if (dateMatch) {
    actions.callDate = dateMatch[1].split('T')[0];
  }

  // Extract attendees
  const attendeesMatch = content.match(/\*\*Attendees:\*\* (.+)$/m);
  if (attendeesMatch) {
    actions.attendees = parseAttendees(attendeesMatch[1]);
  }

  // Extract Tasks to Add section
  const tasksMatch = content.match(/### Tasks to Add\n([\s\S]*?)(?=\n###|\n---|\n\*Auto|$)/);
  if (tasksMatch) {
    const tasksSection = tasksMatch[1];
    const taskLines = tasksSection.match(/- \[ \] .+/g) || [];
    actions.tasks = taskLines.map(t => t.trim());
  }

  // Extract CRM Updates table
  const crmMatch = content.match(/### CRM Updates\n([\s\S]*?)(?=\n###|\n---|\n\*Auto|$)/);
  if (crmMatch) {
    const crmSection = crmMatch[1];
    // Parse table rows (skip header and separator)
    const rows = crmSection.split('\n').filter(line =>
      line.startsWith('|') &&
      !line.includes('Person') &&
      !line.includes('---')
    );

    for (const row of rows) {
      const cells = row.split('|').map(s => s.trim()).filter(Boolean);
      if (cells.length >= 2) {
        actions.crmUpdates.push({
          person: cells[0],
          update: cells[1]
        });
      }
    }
  }

  // Extract Memory Updates
  const memoryMatch = content.match(/### Memory Updates\n([\s\S]*?)(?=\n###|\n---|\n\*Auto|$)/);
  if (memoryMatch) {
    const memorySection = memoryMatch[1];
    const memoryLines = memorySection.match(/- .+/g) || [];
    actions.memoryUpdates = memoryLines.map(m => m.trim());
  }

  return actions;
}

/**
 * Append tasks to today's todo file
 */
function appendTasksToTodo(actions: ExtractedActions): boolean {
  if (actions.tasks.length === 0) return false;

  const today = getToday();
  const todoFile = join(TODOS_PATH, `${today}.md`);

  const callSection = `
## From Call: ${actions.callTitle}
${actions.tasks.join('\n')}
`;

  if (existsSync(todoFile)) {
    let content = readFileSync(todoFile, 'utf-8');

    // Check if this call's tasks are already added
    if (content.includes(`From Call: ${actions.callTitle}`)) {
      return false; // Already added
    }

    // Find a good insertion point - before "## Completed" or at end
    const completedIndex = content.indexOf('## Completed');
    if (completedIndex > -1) {
      content = content.slice(0, completedIndex) + callSection + '\n' + content.slice(completedIndex);
    } else {
      content = content + '\n' + callSection;
    }

    writeFileSync(todoFile, content);
  } else {
    // Create new todo file
    const newContent = `# ${today}\n${callSection}`;
    writeFileSync(todoFile, newContent);
  }

  return true;
}

/**
 * Append CRM updates to pending file
 */
function appendCrmUpdates(actions: ExtractedActions): boolean {
  if (actions.crmUpdates.length === 0) return false;

  const pendingFile = join(CRM_PATH, 'Pending Updates.md');

  const updateSection = `
## From: ${actions.callTitle} (${actions.callDate})

${actions.crmUpdates.map(u => `### ${u.person}\n- ${u.update}`).join('\n\n')}

---
`;

  if (existsSync(pendingFile)) {
    let content = readFileSync(pendingFile, 'utf-8');

    // Check if already added
    if (content.includes(`From: ${actions.callTitle}`)) {
      return false;
    }

    content = content + updateSection;
    writeFileSync(pendingFile, content);
  } else {
    const newContent = `# Pending CRM Updates

Updates extracted from call summaries. Review and apply to individual CRM entries.

${updateSection}`;
    writeFileSync(pendingFile, newContent);
  }

  return true;
}

/**
 * Process new summaries
 */
export async function processSummaryActions(options?: {
  silent?: boolean;
  force?: boolean;
}): Promise<{
  processed: number;
  tasks: number;
  crmUpdates: { applied: number; pending: number; created: number };
  profilesUpdated: number;
}> {
  const silent = options?.silent || false;
  const force = options?.force || false;

  const result = {
    processed: 0,
    tasks: 0,
    crmUpdates: { applied: 0, pending: 0, created: 0 },
    profilesUpdated: 0
  };

  if (!existsSync(SUMMARIES_PATH)) {
    if (!silent) console.log('📁 No summaries folder found');
    return result;
  }

  const state = loadProcessedState();
  const summaryFiles = readdirSync(SUMMARIES_PATH)
    .filter(f => f.endsWith('.md') && !f.startsWith('.'));

  const toProcess = force
    ? summaryFiles
    : summaryFiles.filter(f => !state.processedFiles.includes(f));

  if (toProcess.length === 0) {
    if (!silent) console.log('✅ No new summaries to process');
    return result;
  }

  if (!silent) console.log(`📋 Processing ${toProcess.length} summaries...`);

  for (const filename of toProcess) {
    const filepath = join(SUMMARIES_PATH, filename);
    const content = readFileSync(filepath, 'utf-8');
    const actions = extractActionsFromSummary(content, filename);

    if (!silent) console.log(`  📄 ${actions.callTitle || filename}`);

    // NEW: Always extract person mentions from full text
    const data = loadContacts();
    const mentions = extractPersonMentions(content, data.contacts);

    for (const mention of mentions) {
      updateProfileFile(
        mention.name,
        [`[${mention.section}] ${mention.context}`],
        actions.callTitle,
        actions.callDate
      );
      if (!silent) {
        const preview = mention.context.length > 50 ? mention.context.slice(0, 50) + '...' : mention.context;
        console.log(`     📍 ${mention.name}: "${preview}"`);
      }
      result.profilesUpdated++;
    }

    // NEW: Extract attendees and add call to their profile
    const attendeesMatch = content.match(/\*\*Attendees:\*\* (.+)/);
    if (attendeesMatch) {
      for (const attendee of parseAttendees(attendeesMatch[1])) {
        const { contact, confidence } = findBestMatch(attendee, data.contacts);
        if (contact && confidence >= LOW_CONFIDENCE_THRESHOLD) {
          updateProfileFile(
            contact.name,
            [`Attended call: ${actions.callTitle}`],
            actions.callTitle,
            actions.callDate
          );
          if (!silent) console.log(`     👤 ${contact.name}: Attended call`);
          result.profilesUpdated++;
        }
      }
    }

    // EXISTING: Process CRM table and memory if "Atlas Next Steps" present
    if (content.includes('## Atlas Next Steps') || content.includes('### Tasks to Add')) {
      // Append tasks to todo
      if (appendTasksToTodo(actions)) {
        result.tasks += actions.tasks.length;
        if (!silent) console.log(`     ✅ Added ${actions.tasks.length} tasks to todo`);
      }

      // Apply CRM updates directly to contacts.yaml and profiles
      const crmResult = applyCrmUpdatesToYaml(actions, silent);
      result.crmUpdates.applied += crmResult.applied;
      result.crmUpdates.pending += crmResult.pending;
      result.crmUpdates.created += crmResult.created;

      // Apply memory updates to profile files
      const memoryCount = applyMemoryUpdates(actions, silent);
      result.profilesUpdated += memoryCount;
    }

    state.processedFiles.push(filename);
    result.processed++;
  }

  state.lastRun = new Date().toISOString();
  saveProcessedState(state);

  if (!silent) {
    console.log(`\n✅ Processed ${result.processed} summaries`);
    console.log(`   Tasks added: ${result.tasks}`);
    console.log(`   CRM: ${result.crmUpdates.applied} applied, ${result.crmUpdates.created} created, ${result.crmUpdates.pending} pending`);
    console.log(`   Profiles updated: ${result.profilesUpdated}`);
  }

  return result;
}

// CLI execution
if (import.meta.main) {
  const force = process.argv.includes('--force');

  processSummaryActions({ force })
    .then(result => {
      process.exit(0);
    })
    .catch(err => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}
