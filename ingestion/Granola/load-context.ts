#!/usr/bin/env bun
// SessionStart hook: Load core context into every Cyberman session

import { readFileSync, existsSync } from 'fs';
import { extractGranolaCalls } from '../../scripts/extract-granola';

const CYBERMAN_DIR = process.env.CYBERMAN_DIR || process.cwd();

function readFile(path: string): string {
  const fullPath = `${CYBERMAN_DIR}/${path}`;
  if (existsSync(fullPath)) {
    return readFileSync(fullPath, 'utf-8');
  }
  return `[File not found: ${path}]`;
}

// Read stdin for hook payload (required by Claude Code hooks)
let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });

process.stdin.on('end', async () => {
  // Try to extract Granola calls (silent, incremental)
  let granolaStatus = '';
  let granolaMessage = '';

  try {
    const result = await extractGranolaCalls({ silent: true });

    // Build status for context and user message
    if (result.newCalls > 0) {
      granolaMessage = `📞 Granola: Extracted ${result.newCalls} new call${result.newCalls > 1 ? 's' : ''} | Total: ${result.totalCalls} calls indexed`;
      granolaStatus = `\n${granolaMessage}`;
    } else if (result.totalCalls > 0) {
      granolaMessage = `📞 Granola: ${result.totalCalls} call${result.totalCalls > 1 ? 's' : ''} indexed (no new calls)`;
      granolaStatus = `\n${granolaMessage}`;
    }

    if (result.errors.length > 0) {
      const errorMsg = `⚠️ ${result.errors.length} error${result.errors.length > 1 ? 's' : ''} during extraction`;
      granolaStatus += `\n${errorMsg}`;
      granolaMessage = granolaMessage ? `${granolaMessage} | ${errorMsg}` : errorMsg;
    }
  } catch (err: any) {
    // Silent failure - don't break session
    if (err.message && !err.message.includes('File not found')) {
      const errorMsg = `⚠️ Granola extraction failed: ${err.message}`;
      granolaStatus = `\n${errorMsg}`;
      granolaMessage = errorMsg;
    }
  }

  // System context for Claude
  const context = `
<system-reminder>
## Your Identity
${readFile('context/who-am-i.md')}

## Fund Context
${readFile('context/what-is-cyber.md')}

## Deal Context Auto-Loading
When the user mentions a company that might be a deal:
1. Check if /deals/<company-slug>/ exists (try kebab-case conversion)
2. If exists, read /deals/<company-slug>/.cyberman/context.md
3. Also check for latest research in /deals/<company-slug>/research/
4. Incorporate this context into your response

## Logging Requirement
After completing any workflow (research, content, memo), append a log entry to:
/.cyberman/logs/YYYY-MM-DD.md

Use format:
## HH:MM | category | type | subject
- Workflow: name
- Duration: Xm Ys
- Output: path
- Agents: (if used)
- Sources: (if used)

---
${granolaStatus}
</system-reminder>`;

  // Use JSON output for user-visible messages
  const hookOutput = {
    "hookSpecificOutput": {
      "hookEventName": "SessionStart",
      "additionalContext": context
    },
    "systemMessage": granolaMessage || "Ready!"
  };

  console.log(JSON.stringify(hookOutput));
  process.exit(0);
});
