#!/usr/bin/env bun
import stripAnsi from 'strip-ansi';

const SESSION_ID = process.env.ATLAS_SESSION_ID || 'unknown';
const BACKEND_URL = 'http://localhost:8767/api/text-stream';
const FLUSH_DELAY = 100; // Increased for settling
const RESET_TIMEOUT = 60000; // Reset cumulative tracking after 60s inactivity (new turn)

// Cumulative content tracking for diff-based deduplication
let cumulativeSent = '';  // Everything we've sent this turn
let lastSendTime = 0;

/**
 * Get the delta (new content only) by comparing against what we've already sent.
 * Returns null if content should be skipped (duplicate/subset).
 */
function getDelta(newContent: string): string | null {
  const now = Date.now();

  // Reset on timeout (likely new conversation turn)
  if (lastSendTime > 0 && (now - lastSendTime) > RESET_TIMEOUT) {
    cumulativeSent = '';
  }

  // Case 1: New content extends what we've sent → send only the delta
  if (newContent.startsWith(cumulativeSent) && cumulativeSent.length > 0) {
    const delta = newContent.slice(cumulativeSent.length);
    return delta.length > 0 ? delta : null;
  }

  // Case 2: We've already sent this exact content → skip
  if (cumulativeSent === newContent) {
    return null;
  }

  // Case 3: New content is a subset of what we've sent → skip
  if (cumulativeSent.includes(newContent) && newContent.length < cumulativeSent.length) {
    return null;
  }

  // Case 4: What we've sent is contained in new content (but doesn't start with it)
  // This could be a rewrite - find the overlap and send only new parts
  if (newContent.includes(cumulativeSent) && cumulativeSent.length > 0) {
    // Find where our sent content appears in new content
    const idx = newContent.indexOf(cumulativeSent);
    if (idx === 0) {
      // Starts with our content - handled in Case 1
      return newContent.slice(cumulativeSent.length) || null;
    }
    // Content appears in middle/end - this is unusual, send the prefix
    // But also update cumulative to the full new content
    return newContent;
  }

  // Case 5: Completely different content → new section, send all
  // Reset cumulative since this is likely a new response section
  return newContent;
}

// Spinner and UI characters (Unicode) + ALL box drawing characters
const SPINNER_CHARS = /[✻✶✳✢·✽∴⏺⏵▐▛█▜▌▝▘↑↓⎿�─━│┃┌┐└┘├┤┬┴┼╭╮╰╯╴╵╶╷╸╹╺╻┄┅┆┇┈┉┊┋]/g;

// Malformed CSI sequences (without ESC prefix) - these leak through often
const MALFORMED_CSI = /\[[\d;]*[A-Za-z]/g;

// Orphaned ANSI parameters (color codes, cursor positions)
const ORPHANED_ANSI_PARAMS = /(?:^|[^a-zA-Z])(\d{1,3}m|0m|49m|39m|\d{1,3};\d{1,3}[mHJ])/g;

// Cursor movement garbage patterns (only clearly invalid combinations)
// NOTE: Do NOT add common letter pairs like 'ng' - they appear in real words
const CURSOR_GARBAGE = /(?:T[wsi]|wt|sn|tg)+/g;

// Status bar patterns
const STATUS_PATTERNS = [
  /\(esc to interrupt[^)]*\)/gi,
  /\d+\.?\d*k?\s*tokens?/gi,
  /thought for \d+s?\)?/gi,
  /\(shift\+Tab[^)]*\)/gi,
  /running (?:stop ?)?hooks?[^·\n]*/gi,
  /bypass permissions on[^\n]*/gi,
  /ctrl\+o to expand/gi,
  /think[a-z]*\)/gi,  // "Thinking)", "thinki)", etc.
  /inking\)/gi,  // "inking)" when "Th" is erased
  /nking\)/gi,  // "nking)" partial
  /ought for/gi,  // Partial "thought for"
  /cceeded/gi,  // Partial "succeeded"
  /ucceeded/gi,  // Partial "succeeded"
  /uceded/gi,  // Partial "succeeded"
  /earc\(/gi,  // Partial "Search("
  /earch\(/gi,  // Partial "Search("
  /hok\b/gi,  // Partial "hook"
  /suces/gi,  // Partial "success"
  /reTolUse/gi,  // Partial "PreToolUse"
  /\[7m/g,  // Bold/inverse escape
];

// Hook output messages
const HOOK_PATTERNS = [
  /(?:Pre|Post)ToolUse:[^\n]*/g,
  /SessionStart:[^\n]*/g,
  /Callback hook[^\n]*/g,
  /hook succeeded[^\n]*/g,
];

// Claude Code banner/logo
const BANNER_PATTERNS = [
  /Claude Code v[\d.]+/g,
  /Opus \d+\.\d+/g,
  /Claude Max/g,
  /~\/\.codos\/sessions\/[a-f0-9-]+/g,
];

// Thinking indicator patterns (only match complete words, not partial)
const THINKING_PATTERNS = [
  /\bThinking\.{0,3}\b/gi,
];

// Claude Code processing indicators - fun words with animated dots
const PROCESSING_INDICATOR_PATTERNS = [
  /\b[A-Z][a-z]{2,14}…/g,
  /\b[A-Z][a-z]{2,14}\.{3}/g,
  /([A-Za-z])\1{1,}[A-Za-z]*…/g,
  /[A-Za-z]{1,4}[…\.]+[A-Za-z]{1,4}[…\.]+[A-Za-z]*/g,
  /^\s*[A-Za-z]{3,15}…\s*$/gm,
];

// Issue 1: "thinking" spam - interleaved with numbers (including partial "thinki")
const THINKING_SPAM_PATTERNS = [
  /(?:thinking\d*)+/gi,  // thinking63thinking7thinking72...
  /(?:thinki\d*)+/gi,    // thinki3thinki7... (partial due to cursor movement)
  /thinking/gi,          // standalone "thinking" word
  /thinki\)/gi,          // "thinki)" standalone
];

// Issue 2: Mixed letter/number garbage from animation frames
const MIXED_GARBAGE_PATTERNS = [
  /[A-Za-z]\d[A-Za-z]\d[A-Za-z\d]+/g,  // Ca1an34ei8rt...
  /\d[A-Za-z]\d[A-Za-z][A-Za-z\d]+/g,  // 1a2b3c...
];

// Issue 3: Welcome banner box
const WELCOME_BANNER_PATTERNS = [
  /Welcome back [A-Z]+!/gi,
  /Recent activity/gi,
  /No recent activity/gi,
  /What's new/gi,
  /Added support for/gi,
  /Fixed shell completion/gi,
  /Fixed API errors/gi,
  /\/release-notes for more/gi,
  /\S+@\S+\.\S+/gi,  // redact email addresses
  /Organization/gi,
  /~\/…\/sessions\/[a-f0-9-]+/gi,
];

// Issue 4: Installer message
const INSTALLER_PATTERNS = [
  /installer\.\s*Run\s*`claude install`[^\n]*/gi,
  /https:\/\/docs\.anthropic\.com\/[^\s]*/gi,
  /getting-started for more options\.?/gi,
];

// Read tool output artifacts
const READ_TOOL_PATTERNS = [
  /Read \d+ lines/gi,
  /Read\([^)]+\)/g,
  /Found \d+ files?\s*\(\)/gi,
];

// Random digit sequences (leftover ANSI parameters)
const DIGIT_GARBAGE = [
  /(?<![a-zA-Z])(?:\d{5,})/g,  // 5+ digit sequences not after letters
  /\)\d{3,}/g,  // ) followed by digits
  /\d+\)/g,  // digits followed by )
  /…+/g,  // All ellipsis characters
];

function cleanText(text: string): string {
  // 1. Strip ANSI codes (with ESC prefix)
  let clean = stripAnsi(text);

  // 2. Remove malformed CSI (without ESC prefix)
  clean = clean.replace(MALFORMED_CSI, '');

  // 3. Remove orphaned ANSI parameters
  clean = clean.replace(ORPHANED_ANSI_PARAMS, '');

  // 4. Remove cursor garbage patterns
  clean = clean.replace(CURSOR_GARBAGE, '');

  // 5. Remove spinner/UI characters
  clean = clean.replace(SPINNER_CHARS, '');

  // 6. Remove status patterns
  for (const pattern of STATUS_PATTERNS) {
    clean = clean.replace(pattern, '');
  }

  // 7. Remove hook messages
  for (const pattern of HOOK_PATTERNS) {
    clean = clean.replace(pattern, '');
  }

  // 8. Remove banner patterns
  for (const pattern of BANNER_PATTERNS) {
    clean = clean.replace(pattern, '');
  }

  // 9. Remove thinking patterns
  for (const pattern of THINKING_PATTERNS) {
    clean = clean.replace(pattern, '');
  }

  // 10. Remove processing indicator patterns (Echati…, etc.)
  for (const pattern of PROCESSING_INDICATOR_PATTERNS) {
    clean = clean.replace(pattern, '');
  }

  // 11. Remove "thinking" spam
  for (const pattern of THINKING_SPAM_PATTERNS) {
    clean = clean.replace(pattern, '');
  }

  // 12. Remove mixed letter/number garbage
  for (const pattern of MIXED_GARBAGE_PATTERNS) {
    clean = clean.replace(pattern, '');
  }

  // 13. Remove welcome banner content
  for (const pattern of WELCOME_BANNER_PATTERNS) {
    clean = clean.replace(pattern, '');
  }

  // 14. Remove installer message
  for (const pattern of INSTALLER_PATTERNS) {
    clean = clean.replace(pattern, '');
  }

  // 15. Remove Read tool artifacts
  for (const pattern of READ_TOOL_PATTERNS) {
    clean = clean.replace(pattern, '');
  }

  // 16. Remove digit garbage
  for (const pattern of DIGIT_GARBAGE) {
    clean = clean.replace(pattern, '');
  }

  // 17. Remove prompt characters
  clean = clean.replace(/❯[^\n]*/g, '');

  // 18. Clean up orphaned parentheses with just numbers/spaces
  clean = clean.replace(/\(\s*\d*\s*\)/g, '');
  clean = clean.replace(/\[\s*\d*\s*\]/g, '');

  // 19. Clean up whitespace
  clean = clean
    .replace(/\n{3,}/g, '\n\n')  // Max 2 newlines
    .replace(/[ \t]+/g, ' ')      // Collapse horizontal whitespace
    .split('\n')
    .map(line => line.trim())
    .filter(line => {
      // Skip lines that are just numbers
      if (/^\d+$/.test(line)) return false;
      // Skip lines that are just 1-2 characters (likely garbage)
      if (line.length > 0 && line.length <= 2) return false;
      return true;
    })
    .join('\n')
    .trim();

  return clean;
}

let buffer = '';
let flushTimeout: Timer | null = null;

async function flush() {
  if (!buffer) return;

  const clean = cleanText(buffer);
  buffer = '';

  if (!clean) return;

  // Get delta (only new content we haven't sent)
  const delta = getDelta(clean);
  if (!delta) return;

  // Update cumulative tracking
  // If delta is the full clean content, this is new/different content
  if (delta === clean) {
    // Completely new content - could be new section or significant rewrite
    // Keep the new content as our baseline
    cumulativeSent = clean;
  } else {
    // Delta is a suffix - append to cumulative
    cumulativeSent += delta;
  }
  lastSendTime = Date.now();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  fetch(BACKEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: SESSION_ID, text: delta }),
    signal: controller.signal,
  }).then(() => clearTimeout(timeoutId)).catch(() => clearTimeout(timeoutId));
}

function scheduleFlush() {
  if (flushTimeout) clearTimeout(flushTimeout);
  flushTimeout = setTimeout(flush, FLUSH_DELAY);
}

for await (const chunk of Bun.stdin.stream()) {
  buffer += new TextDecoder().decode(chunk);

  // Flush on newlines or buffer size
  if (buffer.includes('\n')) {
    if (flushTimeout) clearTimeout(flushTimeout);
    await flush();
  } else if (buffer.length >= 2048) {
    scheduleFlush();
  }
}
await flush();
