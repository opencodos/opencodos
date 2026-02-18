#!/usr/bin/env bun
/**
 * Daily Todo Generator
 *
 * Generates today's todo list by combining:
 * 1. Unchecked items from yesterday's todo (interactive selection or auto-carry)
 * 2. Scheduled calls from calendar
 * 3. Action items from today's morning brief
 *
 * Usage:
 * - `bun run generate-todo.ts --context-only` - Output context to stdout (for Claude Code)
 * - `bun run generate-todo.ts` - Print instructions to use /todo skill
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createInterface } from 'readline';
import {
  gatherAllContext,
  getToday,
  findLastTodoFile,
  extractUncheckedItems,
  formatLocalDate
} from './gather-todo-context';
import { updateMetrics, formatVelocityContext, type VelocityContext } from './velocity-tracker';

// Configuration
const VAULT_PATH = process.env.VAULT_PATH || '';
const TODOS_PATH = join(VAULT_PATH, '3 - Todos');

/**
 * Check if running in interactive mode (has TTY)
 */
function isInteractive(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

/**
 * Prompt user to select which items to carry over
 */
async function selectItemsToCarry(items: string[]): Promise<string[]> {
  if (items.length === 0) return [];

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const question = (prompt: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(prompt, resolve);
    });
  };

  console.log('\n Unchecked items from yesterday:');
  items.forEach((item, i) => {
    console.log(`  ${i + 1}. ${item}`);
  });

  console.log('\nWhich items to carry over?');
  console.log('  - Enter numbers separated by commas (e.g., 1,3,5)');
  console.log('  - Enter "all" to carry all items');
  console.log('  - Enter "none" to skip all');
  console.log('  - Press Enter for all (default)');

  const answer = await question('\n> ');
  rl.close();

  const trimmed = answer.trim().toLowerCase();

  if (trimmed === '' || trimmed === 'all') {
    return items;
  }

  if (trimmed === 'none' || trimmed === '0') {
    return [];
  }

  // Parse comma-separated numbers
  const selectedIndices = trimmed
    .split(',')
    .map(s => parseInt(s.trim(), 10) - 1)
    .filter(i => i >= 0 && i < items.length);

  return selectedIndices.map(i => items[i]);
}

/**
 * System prompt for todo generation (exported for use by Claude Code)
 */
export const TODO_SYSTEM_PROMPT = `You are generating a daily todo list. Output ONLY the markdown todo list, no explanation.

CRITICAL: Read and follow "Brief Quality Rules" in the context EXACTLY. These override defaults.

## Format

# {DATE}

## Highest Leverage (pick one from each)

### Deep Work Options

**MANDATORY: Option A = CODE. Option B = PLANNING.**

**Option A (CODE/SHIP):** [Task that produces working code]
- MUST involve: writing TypeScript/Python/etc, git commits, npm/bun commands, API integrations
- Examples: "Build FastAPI endpoint", "Implement MCP tool", "Fix ingestion bug", "Deploy to server"
- NOT CODE (use for Option B): Notion pages, Google Docs, slide decks, 1-pagers, research, pricing docs, proposals
- **Why:** [Which goal, what ships]
- **Last action:** [What happened last]
- **Next step:** [[Technical action with specific code output - "Implement X function", "Create Y endpoint", "Fix Z bug"]]

**Option B (STRATEGY/PLANNING):** [Task that advances business]
- Can be: sales materials, pitch decks, research, planning docs, call prep
- **Why:** [Which goal, what impact]
- **Last action:** [What happened last]
- **Next step:** [[Planning action - "Draft X doc", "Research Y", "Prep for Z call"]]

### Comms Options

**PRIORITIZATION RULE - by STAKES not EASE:**
1. **High stakes, uncomfortable** (investor conflicts, money conversations, confrontations) -> ALWAYS Option A if present
2. **High stakes, time-sensitive** (deadlines, decisions pending on them) -> Include
3. **Warm leads with clear revenue path** (referrals to paying clients) -> Include
4. **Relationship maintenance** (catch-ups, coffee chats, "staying in touch") -> Only if nothing above exists

Do NOT avoid difficult conversations. If there's an active conflict, pending investor decision, or money at stake - that person goes in Option A, even if uncomfortable.

**MESSAGE CONTINUITY RULE:**
The "Next step" message MUST continue the thread from "Last action":
- If ball is with them (waiting for reply) -> gentle nudge on THAT topic, not a new topic
- If ball is with you -> respond to what THEY asked, not pivot to something else
- Do NOT jump to calendar events or new topics when there's an unresolved thread
- The message should feel like a natural continuation, not a context switch

Example (prioritization):
- BAD: Suggest casual coffee chat when investor conflict is unresolved
- GOOD: Investor conflict as Option A (high stakes), warm revenue lead as Option B

Example (message continuity):
- Last action: "User asked 'create chat in telegram or slack?' - no reply"
- BAD next step: "Asking about a calendar event with someone else"
- GOOD next step: "Gentle nudge on the unanswered question: 'Hey, what do you think - telegram or slack?'"

**Option A: [Person name]**
- **Why:** [Why this person matters today - what's at stake, timing]
- **Last action:** [Quote from context] -- *Source: [Telegram Summary DATE / Granola TITLE / etc]*
- **Next step:** [[Actual message text in their language - simple, not trying to do too much]]

**Option B: [Person name]**
- **Why:** [Why this person matters today]
- **Last action:** [Quote from context] -- *Source: [specific source file/section]*
- **Next step:** [[Actual message text]]

NOTE: "Last action" MUST include a source citation. If you cannot cite a specific source, write "No specific interaction found in provided context."

## Fear Work (address one fear today)
*From: [which fear from My Fears list]*
- [ ] [[SMALLEST possible step - assume high resistance. Not "draft a post" but "open Twitter and read 3 posts from people I admire". Build momentum with tiny wins.]]

## Today's Schedule

### Scheduled Meetings
- HH:MM - [Meeting name] with [Person] | Prep: [1 key thing to prepare or ask]

### Expected Comms (touch base, no meeting scheduled)
People you should reach out to today based on recent context (waiting on their reply, ball in your court, relationship maintenance):
- [ ] [Person]: [Why today - last interaction, what's pending] -> [[short message]]

---

## Deep Work
- [ ] Context/task name: [[Specific executable action with concrete deliverable]]

## Comms
- [ ] HH:MM - Call with Name: [[Prep: key topics to cover]]
- [ ] Send message to Name: [[Actual message text in recipient's language]]

## Long Tail
- [ ] Context: [[Specific deferred action]]

## CRITICAL RULES

### CRITICAL: No Hallucinating Communication History
**STOP. Before writing ANY "Last action" field, CTRL+F the context for that person's name.**

The "Last action" field MUST be a direct quote or close paraphrase from the provided data (Telegram summaries, Granola calls, inbox).

VERIFICATION: Can you point to the EXACT line in the context where this information appears? If not, you're hallucinating.

If you cannot find specific message content:
- Quote what IS there: "Last action: Summary says 'Contact wants to speak with all investors by end of week' (Jan 15)"
- Or admit uncertainty: "Last action: No specific message in context, only summary mentions group call"

FORBIDDEN - inventing quotes that don't exist in the data, like:
- "User asked about creating a Telegram chat" (unless this EXACT text appears in context)
- Any specific message text you cannot point to in the provided data

### CRITICAL: Contact Name Resolution
For calendar events and comms where only an email is shown:

1. **Check CRM first** - Is there a contact with this email or from this company?
2. **Cross-reference other sources** - Are there Telegram DMs, Granola calls, or inbox items mentioning someone from this organization?
3. **Make an informed suggestion** if you find context:
   - "Call with vs@example.org -- likely Vitaliy (recent Telegram conversation about Project X)"
   - "Unknown ExampleCorp contact (vs@example.org) -- possibly related to Alex's team"
4. **Never guess from email prefix alone** - "vs" could be Viktor, Vitaliy, Vladimir, etc.
5. **If truly unknown**, say so clearly: "Unknown contact from ExampleCorp (vs@example.org)"

The goal: Use ALL available context to identify contacts, but be explicit about uncertainty rather than hallucinating names.

### Format: "Header: [[action]]"
Every item has TWO parts:
1. **Header** - what this is about (no brackets)
2. **Action** - executable content in [[double brackets]]

**Deep Work examples:**
- BAD: "[[Draft feature list...]]"
- GOOD: "DKOS feature spec: [[Draft 5-feature list: 1) Slack MCP, 2) Linear sync, 3) Calendar, 4) Voice, 5) Brief automation]]"

- BAD: "Research technical partnership strategy"
- GOOD: "Technical co-founder criteria: [[Write rubric: AI-native, GitHub active, async-first, equity-motivated, domain overlap]]"

**Comms examples:**
- BAD: "[[Alex, still available?]]"
- GOOD: "Send message to Alex: [[Alex, still available for a quick call today? Happy to do tomorrow AM your time if easier.]]"

- BAD: "Send message to Sam re: committee status"
- GOOD: "Send message to Sam: [[Sam, how did the committee go? Any decision on my position?]]"

### Language rules for messages
- **Russian speakers** (Cyrillic names or known Russian contacts): Write message in RUSSIAN
- **English speakers** (Latin names or known English contacts): Write message in ENGLISH
- ALWAYS include a message for EVERY person mentioned in Key Relationships section of brief

### CRITICAL: Context-aware messages
Before writing ANY message, check the "Recent Communications" section for:
- Latest Granola call notes with that person
- Recent Telegram/Slack/Gmail exchanges
- What was the LAST interaction? Who has the ball?
- Was there an interrupted call, pending decision, or open thread?

Messages MUST acknowledge recent context:
- BAD: Generic "let's catch up" when you just had an interrupted call
- GOOD: "Sorry we got cut off - let's reschedule this week?"
- BAD: "Want to discuss the project" when they're waiting for YOUR response
- GOOD: "Here's the update I promised: [specific content]"

### Don't push closed doors
If someone has clearly declined, said no, or made a final decision:
- Do NOT keep suggesting them as high-leverage comms
- Do NOT create action items to "follow up" or "check in" with them
- Accept the decision and move on
- Only re-engage if there's genuinely new information that changes the context

Also: If a call was interrupted/abrupt, assume the user already handled the follow-up separately. Don't create "reschedule" tasks.

### Transform carried items
- Yesterday: "Design ingestion pipeline"
- Today: "Ingestion architecture: [[Sketch flow: Telegram->Parser->Markdown->Vault, MCP for Slack/Linear/GitHub]]"

### Delete bullshit
Remove vague items with no clear first action:
- "Research X strategy"
- "Plan Y approach"
- "Explore Z options"

### Include 10 items per bucket
Include ALL carried-over items. Do not drop or consolidate tasks - each unchecked item from the previous todo should appear. Fill each bucket with up to 10 items.

### Velocity-Aware Task Limits
If velocity context is provided:
- Use the "Target tasks" number as your maximum
- If completion rate < 70%, be conservative - fewer tasks done well beats many tasks abandoned
- Address zombie tasks (carried 3+ days) - either complete, break down, or explicitly drop
- If Deep Work completion is low, reduce scope or break into smaller deliverables`;

/**
 * Main function - now supports --context-only flag
 */
export async function runDailyTodo(options?: {
  silent?: boolean;
  interactive?: boolean;  // Force interactive mode (or auto-detect from TTY)
  autoCarry?: boolean;    // Force auto-carry all items (for cron)
  contextOnly?: boolean;  // Just output context, don't generate
}): Promise<{ success: boolean; path?: string; error?: string; context?: string }> {
  const silent = options?.silent || false;
  const contextOnly = options?.contextOnly || false;

  // Default: interactive if TTY available, unless autoCarry is explicitly set
  const shouldInteract = options?.autoCarry === true ? false : (options?.interactive ?? isInteractive());

  const today = getToday();

  // Context-only mode: output context and exit
  if (contextOnly) {
    const context = gatherAllContext({
      includeCarryover: true,
      verbose: !silent
    });
    return { success: true, context };
  }

  // Regular mode: print instructions to use Claude Code
  if (!silent) {
    console.log('\n===== Daily Todo Generator =====\n');
    console.log('This script has been migrated to use Claude Code for generation.');
    console.log('\nTo generate today\'s todo, use one of these methods:\n');
    console.log('1. In Claude Code, run: /todo');
    console.log('2. Or run the shell script: ./run-todo-cc.sh');
    console.log('\nTo just see the context that would be used:');
    console.log('  bun run generate-todo.ts --context-only\n');
  }

  return { success: true };
}

// CLI execution
if (import.meta.main) {
  const args = process.argv.slice(2);
  const contextOnly = args.includes('--context-only') || args.includes('-c');
  const silent = args.includes('--silent') || args.includes('-s');
  const autoCarry = args.includes('--auto-carry');

  runDailyTodo({ contextOnly, silent, autoCarry })
    .then(result => {
      if (!result.success) {
        console.error(`\nError: ${result.error}`);
        process.exit(1);
      }
      if (result.context) {
        // Output context to stdout
        console.log(result.context);
      }
      process.exit(0);
    })
    .catch(err => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}
