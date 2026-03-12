#!/usr/bin/env bun
/**
 * Memory Update Generator
 *
 * Processes person facts and updates CRM profiles.
 * Called by the /memory skill with extracted facts.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';

// Configuration
const VAULT_PATH = process.env.VAULT_PATH || '';
const CRM_PATH = join(VAULT_PATH, '4 - CRM');
const CONTACTS_FILE = join(CRM_PATH, 'contacts.yaml');
const PROFILES_PATH = join(CRM_PATH, 'Profiles');
const CORE_MEMORY_PATH = join(VAULT_PATH, 'Core Memory');
const CRM_DASHBOARD_FILE = join(CRM_PATH, 'CRM Dashboard.md');

// Interfaces
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
}

interface ContactsData {
  metadata: {
    last_updated: string;
    total_contacts: number;
    version: number;
  };
  contacts: Contact[];
}

interface PersonFact {
  name: string;
  fact: string;
}

interface ActionItem {
  name: string;     // Contact name
  action: string;   // The action/next step
}

interface MemoryInput {
  personFacts: PersonFact[];
  generalFacts: string[];
  completedActions?: string[];  // Names of contacts whose action items are completed
  setNextSteps?: ActionItem[];  // Action items to set for contacts
  source?: string;
}

interface MemoryResult {
  profilesUpdated: string[];
  profilesCreated: string[];
  generalFactsAdded: number;
  actionItemsRemoved: string[];
  actionItemsSet: string[];
}

// Fuzzy matching
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
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

function nameSimilarity(name1: string, name2: string): number {
  const s1 = name1.toLowerCase().trim();
  const s2 = name2.toLowerCase().trim();
  if (s1 === s2) return 1.0;
  if (s1.includes(s2) || s2.includes(s1)) return 0.9;
  const parts1 = s1.split(/\s+/);
  const parts2 = s2.split(/\s+/);
  if (parts1[0] === parts2[0] && parts1[0].length > 2) return 0.85;
  const maxLen = Math.max(s1.length, s2.length);
  if (maxLen === 0) return 1.0;
  return 1 - levenshteinDistance(s1, s2) / maxLen;
}

function findBestMatch(name: string, contacts: Contact[]): { contact: Contact | null; confidence: number } {
  let bestMatch: Contact | null = null;
  let bestScore = 0;
  for (const contact of contacts) {
    const score = nameSimilarity(name, contact.name);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = contact;
    }
  }
  return { contact: bestMatch, confidence: bestScore };
}

// Contacts YAML handling
function loadContacts(): ContactsData {
  if (!existsSync(CONTACTS_FILE)) {
    return {
      metadata: { last_updated: new Date().toISOString(), total_contacts: 0, version: 1 },
      contacts: []
    };
  }
  return yaml.load(readFileSync(CONTACTS_FILE, 'utf-8')) as ContactsData;
}

function saveContacts(data: ContactsData): void {
  if (existsSync(CONTACTS_FILE)) {
    copyFileSync(CONTACTS_FILE, CONTACTS_FILE.replace('.yaml', `.backup.${Date.now()}.yaml`));
  }
  data.metadata.last_updated = new Date().toISOString();
  data.metadata.total_contacts = data.contacts.length;
  writeFileSync(CONTACTS_FILE, yaml.dump(data, { lineWidth: -1, quotingType: '"' }));
}

function generateContactId(contacts: Contact[]): string {
  const maxId = contacts.reduce((max, c) => {
    const num = parseInt(c.id.replace('c_', ''), 10);
    return num > max ? num : max;
  }, 0);
  return `c_${String(maxId + 1).padStart(3, '0')}`;
}

// Profile handling
function ensureProfilesDir(): void {
  if (!existsSync(PROFILES_PATH)) mkdirSync(PROFILES_PATH, { recursive: true });
}

function getToday(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Normalize a string for dedup comparison (lowercase, trim, remove extra whitespace)
 */
function normalizeForDedup(str: string): string {
  return str.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Check if an entry already exists in the profile's Interaction Log
 */
function entryExistsInProfile(content: string, date: string, source: string, fact: string): boolean {
  const normalizedFact = normalizeForDedup(fact);
  const logPattern = new RegExp(`### ${date} - ${source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n([\\s\\S]*?)(?=\\n### |\\n## |$)`, 'g');
  let match;
  while ((match = logPattern.exec(content)) !== null) {
    const existingEntries = match[1].split('\n')
      .filter(line => line.startsWith('- '))
      .map(line => normalizeForDedup(line.replace(/^- /, '')));
    if (existingEntries.some(e => e === normalizedFact)) {
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

function updateProfileFile(name: string, facts: string[], source: string): boolean {
  ensureProfilesDir();
  const profilePath = join(PROFILES_PATH, `${name}.md`);
  const today = getToday();
  const isNew = !existsSync(profilePath);

  if (isNew) {
    const content = `# ${name}

## Quick Facts
- Company: Unknown
- Relationship: 2 - Warmish
- Last contact: ${today}

## Notes
${facts.map(f => `- ${f}`).join('\n')}

## Interaction Log
### ${today} - ${source}
${facts.map(f => `- ${f}`).join('\n')}
`;
    writeFileSync(profilePath, content);
  } else {
    let content = readFileSync(profilePath, 'utf-8');
    content = content.replace(/- Last contact: .+/, `- Last contact: ${today}`);

    // Filter out facts that already exist (deduplication)
    const newNotes = facts.filter(f => !noteExistsInProfile(content, f));
    const newLogEntries = facts.filter(f => !entryExistsInProfile(content, today, source, f));

    // Add to Notes (only new notes)
    if (newNotes.length > 0) {
      const notesMatch = content.match(/## Notes\n([\s\S]*?)(?=\n## |$)/);
      if (notesMatch) {
        const existingNotes = notesMatch[1].trim();
        const notesText = newNotes.map(f => `- ${f}`).join('\n');
        content = content.replace(`## Notes\n${notesMatch[1]}`, `## Notes\n${existingNotes}\n${notesText}\n`);
      }
    }

    // Add to Interaction Log (only new entries)
    if (newLogEntries.length > 0) {
      const logEntry = `\n### ${today} - ${source}\n${newLogEntries.map(f => `- ${f}`).join('\n')}\n`;
      if (content.includes('## Interaction Log')) {
        content = content.replace('## Interaction Log', `## Interaction Log${logEntry}`);
      } else {
        content += `\n## Interaction Log${logEntry}`;
      }
    }

    writeFileSync(profilePath, content);
  }

  return isNew;
}

// Action Items handling - writes to contacts.yaml (single source of truth)
// Dashboard is regenerated from contacts.yaml by Telegram agent

/**
 * Clear the next_step for a contact (mark action as completed)
 */
function removeActionItem(contactName: string): boolean {
  const data = loadContacts();
  const { contact, confidence } = findBestMatch(contactName, data.contacts);

  if (!contact || confidence < 0.7) return false;

  // Only clear if there was actually an action
  if (!contact.next_step || contact.next_step === 'null') return false;

  contact.next_step = null;
  saveContacts(data);
  return true;
}

/**
 * Set the next_step for a contact
 */
function setActionItem(contactName: string, action: string): boolean {
  const data = loadContacts();
  const { contact, confidence } = findBestMatch(contactName, data.contacts);

  if (!contact || confidence < 0.7) return false;

  contact.next_step = action;
  saveContacts(data);
  return true;
}

// General facts handling
function appendGeneralFacts(facts: string[]): void {
  const learningsFile = join(CORE_MEMORY_PATH, 'Learnings.md');
  const today = getToday();
  const formattedFacts = facts.map(f => `- [${today}] ${f}`).join('\n');

  if (existsSync(learningsFile)) {
    const content = readFileSync(learningsFile, 'utf-8');
    writeFileSync(learningsFile, content + '\n' + formattedFacts + '\n');
  } else {
    writeFileSync(learningsFile, `# Learnings\n\nGeneral learnings captured from conversations.\n\n${formattedFacts}\n`);
  }
}

/**
 * Process memory updates
 */
export function processMemoryUpdate(input: MemoryInput): MemoryResult {
  const result: MemoryResult = {
    profilesUpdated: [],
    profilesCreated: [],
    generalFactsAdded: 0,
    actionItemsRemoved: [],
    actionItemsSet: []
  };

  const data = loadContacts();
  const source = input.source || 'Conversation';
  let contactsModified = false;

  // Group facts by person
  const factsByPerson: Map<string, string[]> = new Map();
  for (const pf of input.personFacts) {
    const existing = factsByPerson.get(pf.name) || [];
    existing.push(pf.fact);
    factsByPerson.set(pf.name, existing);
  }

  // Process each person
  for (const [inputName, facts] of factsByPerson) {
    const { contact, confidence } = findBestMatch(inputName, data.contacts);

    if (confidence >= 0.85 && contact) {
      // High confidence match - use contact name
      const isNew = updateProfileFile(contact.name, facts, source);
      if (!contact.profile_path) {
        contact.profile_path = `Profiles/${contact.name}.md`;
        contactsModified = true;
      }
      contact.last_connection = getToday();
      contactsModified = true;
      result.profilesUpdated.push(contact.name);
    } else if (confidence >= 0.6 && contact) {
      // Medium confidence - still use matched name but note the lower confidence
      const isNew = updateProfileFile(contact.name, facts, source);
      if (!contact.profile_path) {
        contact.profile_path = `Profiles/${contact.name}.md`;
        contactsModified = true;
      }
      result.profilesUpdated.push(`${contact.name} (${Math.round(confidence * 100)}% match to "${inputName}")`);
    } else {
      // No match - create new contact and profile
      const newContact: Contact = {
        id: generateContactId(data.contacts),
        name: inputName,
        company: null,
        relationship: '2 - Warmish',
        hypothesis: 'TBD',
        last_connection: getToday(),
        last_messages: { me: null, them: null },
        next_step: null,
        telegram_id: null,
        email: null,
        interactions_365d: 0,
        sources: ['memory'],
        auto_created: true,
        profile_path: `Profiles/${inputName}.md`
      };
      data.contacts.push(newContact);
      contactsModified = true;

      updateProfileFile(inputName, facts, source);
      result.profilesCreated.push(inputName);
    }
  }

  // Save contacts if modified
  if (contactsModified) {
    saveContacts(data);
  }

  // Process general facts
  if (input.generalFacts.length > 0) {
    appendGeneralFacts(input.generalFacts);
    result.generalFactsAdded = input.generalFacts.length;
  }

  // Process completed action items (clears next_step)
  if (input.completedActions && input.completedActions.length > 0) {
    for (const contactName of input.completedActions) {
      if (removeActionItem(contactName)) {
        result.actionItemsRemoved.push(contactName);
      }
    }
  }

  // Process new action items (sets next_step)
  if (input.setNextSteps && input.setNextSteps.length > 0) {
    for (const item of input.setNextSteps) {
      if (setActionItem(item.name, item.action)) {
        result.actionItemsSet.push(`${item.name}: ${item.action}`);
      }
    }
  }

  return result;
}

// CLI usage
if (import.meta.main) {
  const inputFile = process.argv[2];
  if (!inputFile) {
    console.error('Usage: bun generate-memory.ts <input.json>');
    console.error('Input JSON format: { personFacts: [{name, fact}], generalFacts: [], source?: string }');
    process.exit(1);
  }

  const input: MemoryInput = JSON.parse(readFileSync(inputFile, 'utf-8'));
  const result = processMemoryUpdate(input);

  console.log('\nMemory Updated:');
  if (result.profilesUpdated.length > 0) {
    console.log('  Updated profiles:');
    result.profilesUpdated.forEach(p => console.log(`    - ${p}`));
  }
  if (result.profilesCreated.length > 0) {
    console.log('  Created profiles:');
    result.profilesCreated.forEach(p => console.log(`    - [NEW] ${p}`));
  }
  if (result.generalFactsAdded > 0) {
    console.log(`  General learnings: ${result.generalFactsAdded} added`);
  }
  if (result.actionItemsRemoved.length > 0) {
    console.log('  Action items completed:');
    result.actionItemsRemoved.forEach(p => console.log(`    - ✓ ${p}`));
  }
  if (result.actionItemsSet.length > 0) {
    console.log('  Action items set:');
    result.actionItemsSet.forEach(p => console.log(`    - → ${p}`));
  }
}
