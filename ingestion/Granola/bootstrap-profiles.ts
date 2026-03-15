#!/usr/bin/env bun
/**
 * Bootstrap Profiles
 *
 * One-time script to create profile files for all existing contacts.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';

const VAULT_PATH = process.env.VAULT_PATH || '';
const CRM_PATH = join(VAULT_PATH, '4 - CRM');
const CONTACTS_FILE = join(CRM_PATH, 'contacts.yaml');
const PROFILES_PATH = join(CRM_PATH, 'Profiles');

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

function ensureProfilesDir(): void {
  if (!existsSync(PROFILES_PATH)) {
    mkdirSync(PROFILES_PATH, { recursive: true });
  }
}

function createProfileContent(contact: Contact): string {
  const lastContact = contact.last_connection || 'Unknown';
  const company = contact.company || 'Unknown';
  const relationship = contact.relationship || '2 - Warmish';

  // Build notes from available data
  const notes: string[] = [];

  if (contact.hypothesis && contact.hypothesis !== 'TBD') {
    notes.push(`Hypothesis: ${contact.hypothesis}`);
  }

  if (contact.email) {
    notes.push(`Email: ${contact.email}`);
  }

  if (contact.telegram_id) {
    notes.push(`Telegram ID: ${contact.telegram_id}`);
  }

  if (contact.interactions_365d > 0) {
    notes.push(`${contact.interactions_365d} interactions in last 365 days`);
  }

  if (contact.sources && contact.sources.length > 0) {
    notes.push(`Sources: ${contact.sources.join(', ')}`);
  }

  // Build interaction log from last messages if available
  let interactionLog = '';
  if (contact.last_messages?.me || contact.last_messages?.them) {
    const date = contact.last_connection || 'Recent';
    interactionLog = `### ${date} - Last message exchange`;
    if (contact.last_messages.them) {
      interactionLog += `\n- Them: "${contact.last_messages.them.slice(0, 200)}${contact.last_messages.them.length > 200 ? '...' : ''}"`;
    }
    if (contact.last_messages.me) {
      interactionLog += `\n- Me: "${contact.last_messages.me.slice(0, 200)}${contact.last_messages.me.length > 200 ? '...' : ''}"`;
    }
  }

  // Build next step section
  let nextStepSection = '';
  if (contact.next_step) {
    nextStepSection = `\n## Next Step\n- ${contact.next_step}\n`;
  }

  return `# ${contact.name}

## Quick Facts
- Company: ${company}
- Relationship: ${relationship}
- Last contact: ${lastContact}

## Notes
${notes.length > 0 ? notes.map(n => `- ${n}`).join('\n') : '- (No notes yet)'}
${nextStepSection}
## Interaction Log
${interactionLog || '(No interactions logged yet)'}
`;
}

async function bootstrapProfiles(): Promise<void> {
  ensureProfilesDir();

  // Load contacts
  const content = readFileSync(CONTACTS_FILE, 'utf-8');
  const data = yaml.load(content) as ContactsData;

  let created = 0;
  let skipped = 0;
  let updated = 0;

  for (const contact of data.contacts) {
    const profilePath = join(PROFILES_PATH, `${contact.name}.md`);
    const relativePath = `Profiles/${contact.name}.md`;

    if (existsSync(profilePath)) {
      // Profile already exists, just ensure profile_path is set
      if (!contact.profile_path) {
        contact.profile_path = relativePath;
        updated++;
      }
      skipped++;
      console.log(`  ⏭️  ${contact.name} (profile exists)`);
    } else {
      // Create new profile
      const profileContent = createProfileContent(contact);
      writeFileSync(profilePath, profileContent);
      contact.profile_path = relativePath;
      created++;
      console.log(`  ✅ ${contact.name}`);
    }
  }

  // Save updated contacts.yaml with profile_path fields
  data.metadata.last_updated = new Date().toISOString();
  const yamlContent = yaml.dump(data, { lineWidth: -1, quotingType: '"' });
  writeFileSync(CONTACTS_FILE, yamlContent);

  console.log(`\n📊 Summary:`);
  console.log(`   Created: ${created} profiles`);
  console.log(`   Skipped: ${skipped} (already existed)`);
  console.log(`   Updated: ${updated} contacts.yaml entries with profile_path`);
}

bootstrapProfiles().catch(console.error);
