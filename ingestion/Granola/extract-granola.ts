#!/usr/bin/env bun
/**
 * Granola Call Extraction Script
 *
 * Extracts meeting transcripts and AI notes from Granola API
 * to Vault/1 - Inbox/Calls/ directory with searchable index.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { getInboxDir } from '../lib/paths';

// Configuration
const OUTPUT_BASE = process.env.GRANOLA_OUTPUT_PATH || getInboxDir('Granola');
const SUPABASE_PATH = join(process.env.HOME!, 'Library/Application Support/Granola/supabase.json');

// Types
interface TranscriptSegment {
  id: string;
  document_id: string;
  text: string;
  source: 'microphone' | 'system';
  start_timestamp: string;
  end_timestamp: string;
  is_final: boolean;
}

interface CalendarEvent {
  summary?: string;
  start?: { dateTime?: string };
  end?: { dateTime?: string };
  creator?: { email?: string };
  attendees?: Array<{ email?: string; displayName?: string }>;
}

interface DocumentPanel {
  id: string;
  title: string;
  content: any;
  meeting_id: string;
}

interface Document {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  notes?: any;
  notes_plain?: string;
  notes_markdown?: string;
  google_calendar_event?: CalendarEvent;
  transcribe?: boolean;
  summary?: string;
  overview?: string;
  chapters?: any;
}

interface ExtractionResult {
  newCalls: number;
  updatedCalls: number;
  skippedInProgress: number;
  errors: string[];
  totalCalls: number;
}

interface StoredMetadata {
  id: string;
  title: string;
  date: string;
  attendees: string[];
  calendar_event?: string;
  transcript_segments: number;
  synced_at: string;
  document_updated_at: string;
}

interface IndexEntry {
  date: string;
  title: string;
  attendees: string;
  path: string;
}

/**
 * Get access token from Granola's supabase.json
 */
function getAccessToken(): string | null {
  if (!existsSync(SUPABASE_PATH)) {
    return null;
  }

  try {
    const supabase = JSON.parse(readFileSync(SUPABASE_PATH, 'utf-8'));
    const tokens = JSON.parse(supabase.workos_tokens);

    // Check if token is expired
    const expiresAt = tokens.obtained_at + tokens.expires_in * 1000;
    if (Date.now() > expiresAt) {
      return null; // Token expired, need to refresh via app
    }

    return tokens.access_token;
  } catch {
    return null;
  }
}

/**
 * Fetch documents from Granola API
 */
async function fetchDocuments(token: string, limit: number = 50): Promise<Document[]> {
  const response = await fetch('https://api.granola.ai/v2/get-documents', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'x-client-type': 'electron'
    },
    body: JSON.stringify({ limit }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch documents: ${response.status}`);
  }

  const data = (await response.json()) as { docs?: Document[] };
  return data.docs || [];
}

/**
 * Fetch transcript for a document
 */
async function fetchTranscript(token: string, documentId: string): Promise<TranscriptSegment[]> {
  const response = await fetch('https://api.granola.ai/v1/get-document-transcript', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'x-client-type': 'electron'
    },
    body: JSON.stringify({ document_id: documentId }),
    signal: AbortSignal.timeout(30_000),
  });

  if (response.status === 404) {
    return []; // No transcript
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch transcript: ${response.status}`);
  }

  return await response.json() as TranscriptSegment[];
}

/**
 * Fetch document panels (AI-generated notes sections)
 */
async function fetchPanels(token: string, documentId: string): Promise<DocumentPanel[]> {
  const response = await fetch('https://api.granola.ai/v1/get-document-panels', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'x-client-type': 'electron'
    },
    body: JSON.stringify({ document_id: documentId }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    return [];
  }

  const data = (await response.json()) as { panels?: DocumentPanel[] };
  return data.panels || [];
}

/**
 * Create filesystem-safe filename
 */
function safeFilename(name: string): string {
  if (!name) return 'untitled';
  return name
    .replace(/[^a-zA-Z0-9\s-_а-яА-ЯёЁ]/g, '')
    .replace(/\s+/g, '-')
    .toLowerCase()
    .slice(0, 80);
}

/**
 * Format ISO date string to YYYY-MM-DD
 */
function formatDate(isoStr: string): string {
  if (!isoStr) return 'unknown-date';
  try {
    return new Date(isoStr).toISOString().split('T')[0];
  } catch {
    return isoStr.slice(0, 10);
  }
}

/**
 * Convert transcript segments to formatted text
 */
function formatTranscript(segments: TranscriptSegment[]): string {
  if (!segments || segments.length === 0) return '';

  // Sort by timestamp
  segments.sort((a, b) =>
    new Date(a.start_timestamp).getTime() - new Date(b.start_timestamp).getTime()
  );

  const lines: string[] = [];
  for (const seg of segments) {
    const speaker = seg.source === 'microphone' ? 'You' : 'Other';
    const time = new Date(seg.start_timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    lines.push(`[${time}] **${speaker}**: ${seg.text}`);
  }

  return lines.join('\n\n');
}

/**
 * Parse TipTap JSON to markdown
 */
function parseTipTap(node: any): string {
  if (!node || typeof node !== 'object') return '';

  const type = node.type || '';
  const content = node.content || [];

  const children = content.map((c: any) => parseTipTap(c)).filter(Boolean);

  switch (type) {
    case 'text':
      let text = node.text || '';
      for (const mark of (node.marks || [])) {
        if (mark.type === 'bold') text = `**${text}**`;
        if (mark.type === 'italic') text = `*${text}*`;
        if (mark.type === 'code') text = `\`${text}\``;
      }
      return text;
    case 'paragraph':
      return children.join('');
    case 'heading':
      const level = node.attrs?.level || 1;
      return '#'.repeat(level) + ' ' + children.join('');
    case 'bulletList':
      return content.map((item: any) => {
        if (item.type === 'listItem') {
          const itemContent = (item.content || []).map((c: any) => parseTipTap(c)).join(' ');
          return `- ${itemContent}`;
        }
        return '';
      }).filter(Boolean).join('\n');
    case 'orderedList':
      return content.map((item: any, i: number) => {
        if (item.type === 'listItem') {
          const itemContent = (item.content || []).map((c: any) => parseTipTap(c)).join(' ');
          return `${i + 1}. ${itemContent}`;
        }
        return '';
      }).filter(Boolean).join('\n');
    case 'codeBlock':
      return '```\n' + children.join('') + '\n```';
    case 'blockquote':
      return '> ' + children.join('');
    case 'doc':
      return children.join('\n\n');
    default:
      return children.join('');
  }
}

/**
 * Format document notes to markdown
 */
function formatNotes(doc: Document, panels: DocumentPanel[]): string {
  const parts: string[] = [];

  // Summary/Overview
  if (doc.summary) {
    parts.push('## Summary\n');
    parts.push(doc.summary);
    parts.push('');
  }

  if (doc.overview) {
    parts.push('## Overview\n');
    parts.push(doc.overview);
    parts.push('');
  }

  // Manual notes
  const manualNotes = doc.notes_markdown || doc.notes_plain || (doc.notes ? parseTipTap(doc.notes) : '');
  if (manualNotes && manualNotes.trim()) {
    parts.push('## Notes\n');
    parts.push(manualNotes);
    parts.push('');
  }

  // AI Panels
  if (panels.length > 0) {
    parts.push('## AI Analysis\n');
    for (const panel of panels) {
      const panelContent = parseTipTap(panel.content);
      if (panelContent && panelContent.trim()) {
        parts.push(`### ${panel.title}\n`);
        parts.push(panelContent);
        parts.push('');
      }
    }
  }

  return parts.join('\n');
}

/**
 * Generate index markdown
 */
function generateIndexMarkdown(entries: IndexEntry[]): string {
  const now = new Date().toISOString().slice(0, 16).replace('T', ' ');

  let md = `# Granola Calls Index\n\n`;
  md += `Last updated: ${now}\n\n`;
  md += `| Date | Title | Attendees | Link |\n`;
  md += `|------|-------|-----------|------|\n`;

  for (const entry of entries) {
    md += `| ${entry.date} | ${entry.title} | ${entry.attendees} | [📁](${entry.path}) |\n`;
  }

  md += `\nTotal calls: ${entries.length}\n`;
  return md;
}

/**
 * Check if a call is still in progress (transcription not complete)
 */
function isCallInProgress(doc: Document, transcript: TranscriptSegment[]): boolean {
  // Check 1: Call is less than 1 hour old
  const ageMs = Date.now() - new Date(doc.created_at).getTime();
  const isRecent = ageMs < 60 * 60 * 1000; // 1 hour

  if (!isRecent) return false;

  // Check 2: Not all segments are marked as final
  if (transcript.length === 0) return true; // No transcript yet
  const allFinal = transcript.every(seg => seg.is_final);

  return !allFinal;
}

/**
 * Check if existing folder needs re-sync based on updated_at
 */
function needsResync(callDir: string, doc: Document): boolean {
  const metadataPath = join(callDir, 'metadata.json');
  if (!existsSync(metadataPath)) return true;

  try {
    const stored: StoredMetadata = JSON.parse(readFileSync(metadataPath, 'utf-8'));

    // If we have document_updated_at stored, compare with current
    if (stored.document_updated_at) {
      const storedUpdate = new Date(stored.document_updated_at).getTime();
      const currentUpdate = new Date(doc.updated_at).getTime();
      return currentUpdate > storedUpdate;
    }

    // Legacy metadata without document_updated_at - check synced_at vs updated_at
    if (stored.synced_at) {
      const syncedAt = new Date(stored.synced_at).getTime();
      const updatedAt = new Date(doc.updated_at).getTime();
      return updatedAt > syncedAt;
    }

    // No sync tracking - assume needs update if document has been modified
    return true;
  } catch {
    return true;
  }
}

/**
 * Parse existing INDEX.md
 */
function parseExistingIndex(content: string): IndexEntry[] {
  const entries: IndexEntry[] = [];
  for (const line of content.split('\n')) {
    if (!line.startsWith('|') || line.includes('---') || line.includes('Date')) continue;
    const parts = line.split('|').map(s => s.trim()).filter(Boolean);
    if (parts.length >= 4) {
      const pathMatch = parts[3].match(/\(([^)]+)\)/);
      entries.push({
        date: parts[0],
        title: parts[1],
        attendees: parts[2],
        path: pathMatch ? pathMatch[1] : parts[3]
      });
    }
  }
  return entries;
}

/**
 * Main extraction function
 */
export async function extractGranolaCalls(options?: {
  outputPath?: string;
  silent?: boolean;
  limit?: number;
}): Promise<ExtractionResult> {
  const outputBase = options?.outputPath || OUTPUT_BASE;
  const silent = options?.silent || false;
  const limit = options?.limit || 50;

  const result: ExtractionResult = {
    newCalls: 0,
    updatedCalls: 0,
    skippedInProgress: 0,
    errors: [],
    totalCalls: 0
  };

  // Get token
  const token = getAccessToken();
  if (!token) {
    result.errors.push('No valid access token - open Granola app to refresh');
    return result;
  }

  if (!silent) console.log('📞 Fetching documents from Granola...');

  // Fetch documents
  let docs: Document[];
  try {
    docs = await fetchDocuments(token, limit);
  } catch (err: any) {
    result.errors.push(`Failed to fetch documents: ${err.message}`);
    return result;
  }

  if (!silent) console.log(`📋 Found ${docs.length} documents`);

  // Create output directory
  if (!existsSync(outputBase)) {
    mkdirSync(outputBase, { recursive: true });
  }

  const newIndexEntries: IndexEntry[] = [];

  // Process each document
  for (const doc of docs) {
    const dateStr = formatDate(doc.created_at);
    const safeTitle = safeFilename(doc.title);
    const dirName = `${dateStr}_${safeTitle}`;
    const callDir = join(outputBase, dirName);

    const folderExists = existsSync(callDir);
    let isUpdate = false;

    // For existing folders: check if we need to re-sync
    if (folderExists) {
      if (!needsResync(callDir, doc)) {
        continue; // No changes since last sync
      }
      isUpdate = true;
      if (!silent) console.log(`🔄 Updating: ${doc.title}`);
    } else {
      if (!silent) console.log(`✨ Processing: ${doc.title}`);
    }

    try {
      // Fetch transcript and panels
      const [transcript, panels] = await Promise.all([
        fetchTranscript(token, doc.id),
        fetchPanels(token, doc.id)
      ]);

      // Skip if no transcript (not a real call)
      if (transcript.length === 0) {
        if (!silent) console.log(`  ⏭️  No transcript, skipping`);
        continue;
      }

      // For NEW folders only: skip if call is still in progress
      if (!folderExists && isCallInProgress(doc, transcript)) {
        if (!silent) console.log(`  ⏳ Call still in progress, skipping for now`);
        result.skippedInProgress++;
        continue;
      }

      mkdirSync(callDir, { recursive: true });

      // Get attendees from calendar event
      const event = doc.google_calendar_event;
      const attendees = event?.attendees?.map(a => a.displayName || a.email || 'Unknown') || [];
      const attendeeStr = attendees.join(', ') || 'No attendees';

      // 1. Write metadata with sync tracking
      const metadata: StoredMetadata = {
        id: doc.id,
        title: doc.title,
        date: doc.created_at,
        attendees: attendees,
        calendar_event: event?.summary,
        transcript_segments: transcript.length,
        synced_at: new Date().toISOString(),
        document_updated_at: doc.updated_at
      };
      writeFileSync(join(callDir, 'metadata.json'), JSON.stringify(metadata, null, 2));

      // 2. Write transcript
      const transcriptMd = formatTranscript(transcript);
      if (transcriptMd) {
        writeFileSync(join(callDir, 'transcript.md'), `# Transcript: ${doc.title}\n\n${transcriptMd}`);
      }

      // 3. Write notes
      const notesMd = formatNotes(doc, panels);
      if (notesMd.trim()) {
        writeFileSync(join(callDir, 'notes.md'), `# Notes: ${doc.title}\n\n${notesMd}`);
      }

      // Add to index (only for new calls)
      if (!isUpdate) {
        newIndexEntries.push({
          date: dateStr,
          title: doc.title,
          attendees: attendeeStr,
          path: `./${dirName}/`
        });
        result.newCalls++;
      } else {
        result.updatedCalls++;
      }

    } catch (err: any) {
      if (!silent) console.error(`  ❌ Error: ${err.message}`);
      result.errors.push(`${doc.title}: ${err.message}`);
    }
  }

  // Update INDEX.md
  if (newIndexEntries.length > 0 || !existsSync(join(outputBase, 'INDEX.md'))) {
    const indexPath = join(outputBase, 'INDEX.md');
    let allEntries = newIndexEntries;

    if (existsSync(indexPath)) {
      const existing = parseExistingIndex(readFileSync(indexPath, 'utf-8'));
      allEntries = [...existing, ...newIndexEntries];
    }

    // Sort by date descending
    allEntries.sort((a, b) => b.date.localeCompare(a.date));
    writeFileSync(indexPath, generateIndexMarkdown(allEntries));
  }

  // Count total
  if (existsSync(outputBase)) {
    result.totalCalls = readdirSync(outputBase, { withFileTypes: true })
      .filter(d => d.isDirectory()).length;
  }

  if (!silent) {
    const parts = [`${result.newCalls} new`];
    if (result.updatedCalls > 0) parts.push(`${result.updatedCalls} updated`);
    if (result.skippedInProgress > 0) parts.push(`${result.skippedInProgress} in-progress`);
    console.log(`\n✅ Extracted ${parts.join(', ')} (${result.totalCalls} total)`);
  }

  return result;
}

// CLI execution
if (import.meta.main) {
  extractGranolaCalls()
    .then(result => {
      if (result.errors.length > 0) {
        console.error('\n⚠️ Errors:');
        result.errors.forEach(err => console.error(`  - ${err}`));
      }
      process.exit(result.errors.length > 0 ? 1 : 0);
    })
    .catch(err => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}
