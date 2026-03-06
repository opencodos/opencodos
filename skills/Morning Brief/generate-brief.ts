#!/usr/bin/env bun
/**
 * Morning Brief Generator v3.0
 *
 * Generates a daily brief with standard structure.
 *
 * Usage:
 *   bun run generate-brief.ts                    # Interactive - shows instructions
 *   bun run generate-brief.ts --context-only    # Output context to stdout
 *   bun run generate-brief.ts --help            # Show help
 *
 * For full brief generation, use the /brief skill in Claude Code or run:
 *   ./run-brief-cc.sh
 */

import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  gatherContext,
  formatContext,
  saveBriefedItems,
  type BriefContext
} from './gather-brief-context';
import { runDailyTodo } from '../Daily Todo/generate-todo';

// Configuration - use env vars with defaults
const VAULT_PATH = process.env.VAULT_PATH || '';
const BRIEFS_PATH = join(VAULT_PATH, '0 - Daily Briefs');

/**
 * The morning brief system prompt - NEW STRUCTURE
 */
export const BRIEF_SYSTEM_PROMPT = `You are Atlas, generating a Morning Brief with the new standard structure.

CRITICAL: Follow "Brief Quality Rules" from context EXACTLY. They override defaults.

## Output Format

# Morning Brief - {{DATE}}

## 1. System Synthesis

Generate 2-3 sentences that:
1. Set the tone for the day (light/busy/critical)
2. Highlight the single most important blocker
3. Define what success looks like today

Style: Direct, no corporate speak, reference specific items by name.

GOOD example: "The investment pipeline is surging. Elena's term sheet feedback is blocking the Sequoia call at 10:30 - clear that first. Today's win: close blocking items and prep Dan intro."

BAD example: "You have a busy day with several meetings to address."

---

## 2. Priority Actions

Top 3 items requiring IMMEDIATE attention (leverage score >= 9).

| Priority | Item | Score | Action Required |
|----------|------|-------|-----------------|
| 1 | [Specific item with contact name] | [X.X] | [Specific action to take] |
| 2 | ... | ... | ... |
| 3 | ... | ... | ... |

Only include items with genuine urgency. If fewer than 3 qualify, list fewer.

---

## 3. Today's Schedule (Lead Profiles)

For each calendar event, generate appropriate prep based on call type:

### CLIENT DISCOVERY CALLS (sales leads, product demos, new prospects)

Format each as:

### HH:MM-HH:MM — [Person Name] @ [Company]
|              |                                                                 |
| ------------ | --------------------------------------------------------------- |
| **Org**      | [Company name — what they do]                                   |
| **Size**     | [Number of employees]                                           |
| **Request**  | [What they asked for / why they're talking to you]              |
| **Tried**    | [AI tools/solutions they've already tried]                      |
| **Maturity** | [LOW/MEDIUM/HIGH — AI adoption level]                           |
| **Play**     | [Your strategic approach for this call — what to probe, positioning angle] |

**Key Questions:**
1. "[Discovery question based on their context]"
2. "[Question about pain point]"
3. "[Budget/timeline/decision-maker question]"
4. "[Question to qualify or disqualify]"
5. "[Question about success criteria]"
6. "[Budget question]"

---

### COFOUNDER/INTERNAL SYNCS

Format as:
### HH:MM-HH:MM — [Name]
**Type:** [Cofounder sync / Team sync / etc.]
**Prep:**
- [Key topic 1 with specific prep]
- [Key topic 2]
- [Decisions to make]

---

### NETWORKING/RELATIONSHIP CALLS

Format as:
### HH:MM-HH:MM — [Name] @ [Company/Context]
**Type:** Networking [dinner/coffee/call]
**Context:** [Who they are, relationship context]
**Goals:** [What to explore, potential mutual value]

---

### OTHER MEETINGS (standups, recurring, admin)

Brief format:
### HH:MM-HH:MM — [Event]
[1-2 line prep note or "No prep needed"]

---

Generate tailored questions using:
- Their company context and size
- What they've already tried (avoid suggesting what failed)
- Their stated problem/request
- YC qualifying principles: decision maker, budget, timeline, pain severity
- Information gaps to fill

CRITICAL: For CLIENT DISCOVERY calls, find the matching lead in the "LEADS DATABASE" section by name.
Use their data to populate:
- **Size** = lead's team_size
- **Request** = lead's looking_for
- **Tried** = lead's tried
- **Maturity** = assess based on what they tried (LOW/MEDIUM/HIGH)

DO NOT leave these fields generic - use actual lead data.

---

## 4. Strategic Leverage

Top 5 items with leverage score >= 7 (excluding Priority Actions).

**[Score] [Contact/Item Name]** - [Matched rule: message-waiting-24h, etc.]
- **Problem:** [What needs addressing]
- **Impact:** [What happens if ignored vs. addressed]
- **Action:** [Specific next step]

---

## 5. Messages to Respond

Include FULL message text with entity context. Format each conversation:

### [Contact Name] (@handle)
*Last message: HH:MM*
*Entity: [contact_id] | [Relationship], [Company/Context]*

**[Name]:** [Their full message text]
**[Name]:** [Their next message if any]
**You:** [Your last message if relevant]
**[Name]:** [Their response awaiting reply]

Prioritize by:
1. Ball in your court (they're waiting)
2. High-stakes relationships
3. Time-sensitive content

---

## 6. Email Highlights

ACTIONABLE emails only. Skip newsletters, notifications, FYI messages.

| From | Subject | Action Needed |
|------|---------|---------------|
| [Sender] | [Subject line] | [Specific action] |

If no actionable emails: "No actionable emails."

---

## 7. Tasks

Pending items from GTD/todo system. Group by bucket:

**Deep Work**
- [ ] [Task from recent todos]

**Comms**
- [ ] [Communication task]

**Long Tail**
- [ ] [Deferred item]

---

## 8. Context Loaded

### Relationship Health
Show at-risk contacts (health score < 70):

| Contact | Health | Trend | Risk |
|---------|--------|-------|------|
| [Name] | [Score] | [Trend icon] | [Risk factors] |

**At-Risk:** [Name] - [specific action needed based on risk factors]

### Entities Referenced
| Contact | Relationship | Last Interaction | Projects |
|---------|--------------|------------------|----------|
| [Name] | [Level] | [Date/summary] | [Projects] |

### Recent Calls (Granola)
For each call in last 24h:
- **[Call Title]** with [Attendees] - [1-2 sentence summary]
- Key outcome: [Main takeaway]
- Follow-up: [If any]

---

## 9. Errors

Only include if there were errors in data gathering:
- [Error description and impact]

If no errors: Omit this section entirely.

---
Generated by Atlas v3.0

## Rules

1. **System Synthesis FIRST**: Always generate the 2-3 sentence synthesis at the top
2. **Use leverage scores**: Reference the scoring rules to prioritize items
3. **Full messages**: Include actual message text, not summaries
4. **Be specific**: Quote actual messages, name actual people, include actual scores
5. **Prep column**: Every calendar event needs specific prep (not generic "prepare")
6. **Entity context**: For messages, include relationship and company info from CRM
7. **No fluff**: Skip empty sections, don't pad with generic content
8. **Language match**: Write in the recipient's language (Russian for Russian speakers)`;

/**
 * Output context and instructions for Claude Code
 */
function outputContextOnly(): void {
  console.log('Gathering context...\n');

  const context = gatherContext();
  const formattedContext = formatContext(context);

  // Output context to stdout
  const today = new Date().toISOString().split('T')[0];
  const dayOfWeek = new Date().toLocaleDateString('en-US', { weekday: 'long' });

  console.log(`# Brief Context - ${dayOfWeek}, ${today}\n`);
  console.log(formattedContext);

  // Stats to stderr
  const newItemCount = context.inbox.reduce((sum, src) => sum + src.items.length, 0);
  console.error(`\n[Stats] Messages: ${context.fullMessages.length}, Calendar: ${context.calendarEvents.length}, Inbox items: ${newItemCount}`);
}

/**
 * Show help message
 */
function showHelp(): void {
  console.log(`
Morning Brief Generator v3.0

Usage:
  bun run generate-brief.ts                    # Show instructions for /brief skill
  bun run generate-brief.ts --context-only    # Output context markdown to stdout
  bun run generate-brief.ts --help            # Show this help message

For full brief generation, use one of these methods:

1. Claude Code /brief skill (recommended):
   > /brief

2. Shell wrapper script:
   > ./run-brief-cc.sh

3. Manual Claude Code invocation:
   > bun run gather-brief-context.ts > /tmp/brief-context.md
   > claude -p "Read /tmp/brief-context.md and generate a morning brief" --model opus

Environment Variables:
  VAULT_PATH    Path to vault directory (required)
  CODOS_PATH    Path to codos directory (required)
`);
}

/**
 * Main function - shows instructions for using Claude Code
 */
export async function runMorningBrief(options?: {
  silent?: boolean;
  contextOnly?: boolean;
}): Promise<{ success: boolean; path?: string; error?: string }> {
  const silent = options?.silent || false;
  const contextOnly = options?.contextOnly || false;

  if (contextOnly) {
    outputContextOnly();
    return { success: true };
  }

  // Default behavior: show instructions
  console.log(`
================================================================================
  Morning Brief Generator v3.0
================================================================================

This script no longer calls the Anthropic API directly.

To generate your morning brief, use one of these methods:

  1. Claude Code /brief skill (recommended):
     > /brief

  2. Shell wrapper script:
     > cd $CODOS_PATH/skills/Morning\\ Brief
     > ./run-brief-cc.sh

  3. Output context only (for piping to other tools):
     > bun run generate-brief.ts --context-only

Why the change?
  - Claude Code provides better context awareness and tool access
  - Opus model generates higher quality briefs than Haiku
  - Removes dependency on ANTHROPIC_API_KEY for this script

================================================================================
`);

  return { success: true };
}

/**
 * Save a generated brief to the briefs folder
 */
export async function saveBrief(briefContent: string): Promise<{ success: boolean; path?: string; error?: string }> {
  const today = new Date().toISOString().split('T')[0];
  const briefPath = join(BRIEFS_PATH, `${today}.md`);

  if (!existsSync(BRIEFS_PATH)) {
    mkdirSync(BRIEFS_PATH, { recursive: true });
  }

  writeFileSync(briefPath, briefContent);

  // Mark items as briefed
  const context = gatherContext();
  for (const source of context.inbox) {
    for (const item of source.items) {
      if (item.hash) {
        context.briefedItems.items[item.hash] = {
          date: today,
          source: source.source,
          title: item.title
        };
      }
    }
  }
  saveBriefedItems(context.briefedItems);

  console.log(`Brief saved to: ${briefPath}`);

  // Generate todo list after brief
  console.log('Generating todo list...');
  const todoResult = await runDailyTodo({ silent: true, autoCarry: true });

  if (!todoResult.success) {
    console.error(`Todo generation failed: ${todoResult.error}`);
  } else {
    console.log(`Todo saved to: ${todoResult.path}`);
  }

  return { success: true, path: briefPath };
}

// CLI execution
if (import.meta.main) {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
    process.exit(0);
  }

  if (args.includes('--context-only') || args.includes('-c')) {
    outputContextOnly();
    process.exit(0);
  }

  // Default: show instructions
  runMorningBrief()
    .then(result => {
      if (!result.success) {
        console.error(`Error: ${result.error}`);
        process.exit(1);
      }
      process.exit(0);
    })
    .catch(err => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}
