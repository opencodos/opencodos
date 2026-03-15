#!/bin/bash
#
# Inbox Suggestions Generator - Claude Code Wrapper
#
# Generates AI-powered suggestions (summary, draft reply, action type) for each
# Telegram conversation using Claude Code CLI with subscription.
#
# Runs as a background job after every Telegram sync.
#
# Usage:
#   ./run-inbox-suggestions.sh
#

set -e

# Load environment (paths + API keys)
# shellcheck source=/dev/null
source ~/.codos/env.sh

# Lock file to prevent concurrent executions
LOCKFILE="/tmp/inbox-suggestions.lock"
PROMPT_FILE=""
CLEAN_WORKDIR=""
cleanup() { rm -f "$LOCKFILE" "$PROMPT_FILE"; [ -n "$CLEAN_WORKDIR" ] && rm -rf "$CLEAN_WORKDIR"; }
trap cleanup EXIT

if [ -f "$LOCKFILE" ]; then
    PID=$(cat "$LOCKFILE")
    if kill -0 "$PID" 2>/dev/null; then
        echo "[$(date)] Inbox suggestions already running (PID $PID), skipping"
        exit 0
    fi
    rm -f "$LOCKFILE"
fi
echo $$ > "$LOCKFILE"

# Derived paths
TELEGRAM_DIR="${VAULT_PATH}/1 - Inbox (Last 7 days)/Telegram"
SUGGESTIONS_FILE="${TELEGRAM_DIR}/.inbox-suggestions.json"

# Debounce: skip if suggestions file is less than 5 minutes old
if [ -f "$SUGGESTIONS_FILE" ]; then
    FILE_AGE=$(( $(date +%s) - $(stat -f %m "$SUGGESTIONS_FILE") ))
    if [ "$FILE_AGE" -lt 300 ]; then
        echo "[$(date)] Suggestions file is ${FILE_AGE}s old (< 300s), skipping"
        exit 0
    fi
fi

# Verify Telegram dir exists
if [ ! -d "$TELEGRAM_DIR" ]; then
    echo "[$(date)] Telegram directory not found: $TELEGRAM_DIR"
    exit 1
fi

echo "[$(date)] Generating inbox suggestions..."

# Summary file written by sync with just unread conversations + recent messages
UNREAD_SUMMARY="${TELEGRAM_DIR}/.inbox-unread.json"

if [ ! -f "$UNREAD_SUMMARY" ]; then
    echo "[$(date)] No unread summary found — run a Telegram sync first"
    exit 0
fi

# Check if there are any unread conversations
CONV_COUNT=$(python3 -c "import json; d=json.load(open('$UNREAD_SUMMARY')); print(len(d.get('conversations',[])))" 2>/dev/null || echo "0")
if [ "$CONV_COUNT" = "0" ]; then
    echo "[$(date)] No unread conversations, writing empty suggestions"
    echo '{"suggestions":[],"generated":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"}' > "$SUGGESTIONS_FILE"
    exit 0
fi

echo "[$(date)] Processing $CONV_COUNT unread conversations..."

# Read unread data and embed directly in prompt (avoids tool call for Read)
UNREAD_DATA=$(cat "$UNREAD_SUMMARY")

# Write prompt to temp file to avoid shell expansion issues with large strings
PROMPT_FILE=$(mktemp /tmp/inbox-prompt.XXXXXX)
cat > "$PROMPT_FILE" << 'PROMPT_OUTER'
You are analyzing Telegram conversations to generate inbox suggestions.

Here is the unread conversations data:

PROMPT_OUTER

# Append the actual JSON data
echo "$UNREAD_DATA" >> "$PROMPT_FILE"

# Append the rest of the prompt (using heredoc with variable for output path)
cat >> "$PROMPT_FILE" << PROMPT_INNER

Based on the data above, generate suggestions and write them as JSON to: ${SUGGESTIONS_FILE}

OUTPUT FORMAT — write a JSON file with this structure:
{
  "suggestions": [
    {
      "filename": "Name.md",
      "priority": "high|medium|low",
      "type": "reply|task|schedule|action|ignore",
      "label": "Reply|Task|Schedule|Action|No action",
      "summary": "1-2 sentence analysis of what's happening and what to do",
      "draft": "Draft reply text in the conversation's language, or null if no reply needed",
      "action": "Next step description, or null if no action needed"
    }
  ],
  "generated": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}

CLASSIFICATION RULES:
- type=reply: conversation needs a reply from me. Always include a draft.
- type=task: conversation contains a task/request I should act on
- type=schedule: conversation involves scheduling (meeting, call, etc.)
- type=action: conversation needs some other action (forward, look up, etc.)
- type=ignore: no action needed (resolved, informational, or I sent the last message). Still include summary.

PRIORITY RULES:
- high: waiting >24h for my reply, urgent request, important contact
- medium: needs attention but not urgent
- low: informational, no rush, or no action needed

LANGUAGE RULES:
- Draft replies MUST be in the same language as the conversation (Russian for Russian chats, English for English, etc.)
- Owner name patterns are set in OWNER_PATTERNS env var — if the last message sender matches these, the owner already replied

CONTEXT ENRICHMENT:
- Each conversation may include a 'related_context' array with snippets from Granola calls, Gmail, Slack, Briefs, Todos
- Use this context to write BETTER suggestions: reference past meetings, email threads, scheduled calls, or todo items
- Do NOT hallucinate context that isn't in related_context — only use what's provided

IMPORTANT:
- ONLY generate suggestions for conversations in the data above — do NOT Read or Glob any other files
- Be concise in summaries — 1-2 sentences max
- Drafts should be natural and conversational, matching the chat's tone
- Write ONLY valid JSON to the output file, no markdown wrapping
- You have ONE task: Write the JSON file. Do it immediately.
PROMPT_INNER

# Clear env vars that interfere with nested Claude invocations
unset ANTHROPIC_API_KEY
unset CLAUDECODE

# Run from clean empty dir to avoid loading CLAUDE.md and scanning project files
# NOTE: /tmp causes 100% CPU hang — CLI scans working dir and /tmp has thousands of files
CLEAN_WORKDIR=$(mktemp -d /tmp/claude-inbox.XXXXXX)
cd "$CLEAN_WORKDIR"

claude -p "$(cat "$PROMPT_FILE")" \
    --model claude-sonnet-4-20250514 \
    --max-turns 5 \
    --allowedTools "Write" \
    --permission-mode bypassPermissions \
    < /dev/null \
    2>&1
CLAUDE_EXIT=$?

if [ "$CLAUDE_EXIT" -eq 0 ]; then
    # Verify the file was actually written/updated (Claude exits 0 even on max-turns)
    if [ -f "$SUGGESTIONS_FILE" ]; then
        FILE_AGE=$(( $(date +%s) - $(stat -f %m "$SUGGESTIONS_FILE") ))
        if [ "$FILE_AGE" -lt 60 ]; then
            echo "[$(date)] Inbox suggestions generated successfully"
            echo "[$(date)] Output: $SUGGESTIONS_FILE ($(wc -c < "$SUGGESTIONS_FILE" | tr -d ' ') bytes)"
        else
            echo "[$(date)] Warning: Claude exited 0 but suggestions file was not updated (age: ${FILE_AGE}s)"
        fi
    else
        echo "[$(date)] Warning: suggestions file not found after generation"
    fi
else
    echo "[$(date)] Error: Claude Code invocation failed or timed out (exit $CLAUDE_EXIT)"
fi
