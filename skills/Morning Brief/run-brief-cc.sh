#!/bin/bash
#
# Morning Brief Generator - Claude Code Wrapper
#
# Generates a morning brief using Claude Code CLI instead of direct API calls.
# This provides better context awareness and uses the Opus model.
#
# Usage:
#   ./run-brief-cc.sh              # Generate brief (default)
#   ./run-brief-cc.sh --dry-run    # Gather context only, don't invoke Claude
#

set -e

# Load environment (paths + API keys)
# shellcheck source=/dev/null
source ~/.codos/env.sh

# Prevent nested-session detection if invoked from within Claude Code
unset CLAUDECODE

# Lock file to prevent concurrent executions
LOCKFILE="/tmp/morning-brief.lock"
cleanup() { rm -f "$LOCKFILE"; }
trap cleanup EXIT

if [ -f "$LOCKFILE" ]; then
    PID=$(cat "$LOCKFILE")
    if kill -0 "$PID" 2>/dev/null; then
        echo "Morning brief already running (PID $PID), skipping"
        exit 0
    fi
    rm -f "$LOCKFILE"
fi
echo $$ > "$LOCKFILE"

# Timeout function (pure bash, no coreutils needed)
# Uses pkill -P to kill child processes, preventing zombie accumulation
run_with_timeout() {
    local timeout=$1
    shift

    "$@" &
    local pid=$!

    (
        sleep "$timeout"
        pkill -TERM -P "$pid" "." 2>/dev/null
        kill -TERM "$pid" 2>/dev/null
        sleep 5
        pkill -9 -P "$pid" "." 2>/dev/null
        kill -9 "$pid" 2>/dev/null
    ) &>/dev/null &
    local watchdog=$!

    wait "$pid"
    local ret=$?

    kill "$watchdog" 2>/dev/null
    wait "$watchdog" 2>/dev/null

    # Final cleanup: kill any remaining children
    pkill -9 -P "$pid" "." 2>/dev/null
    kill -9 "$pid" 2>/dev/null

    return $ret
}

# Derived paths
BRIEF_DIR="${CODOS_PATH}/skills/Morning Brief"
CONTEXT_FILE="/tmp/brief-context.md"
TODAY=$(date +%Y-%m-%d)
DAY_OF_WEEK=$(date +%A)
BRIEF_OUTPUT="${VAULT_PATH}/0 - Daily Briefs/${TODAY}.md"

# Parse arguments
DRY_RUN=false
FULL_CONTEXT=true  # Default to full context mode (no truncation)
for arg in "$@"; do
    case $arg in
        --dry-run)
            DRY_RUN=true
            ;;
        --truncated)
            FULL_CONTEXT=false
            ;;
        --help|-h)
            echo "Morning Brief Generator - Claude Code Wrapper"
            echo ""
            echo "Usage:"
            echo "  ./run-brief-cc.sh              # Generate brief (full context, default)"
            echo "  ./run-brief-cc.sh --truncated   # Generate brief (truncated context)"
            echo "  ./run-brief-cc.sh --dry-run    # Gather context only"
            echo "  ./run-brief-cc.sh --help       # Show this help"
            exit 0
            ;;
    esac
done

echo "=========================================="
echo "  Morning Brief Generator v3.0"
echo "=========================================="
echo ""
echo "Date: ${DAY_OF_WEEK}, ${TODAY}"
echo "Codos: ${CODOS_PATH}"
echo "Vault: ${VAULT_PATH}"
echo ""

# Step 0: Run Gmail sync to ensure fresh email data
echo "[0/4] Syncing Gmail..."
GMAIL_SYNC="${CODOS_PATH}/ingestion/Gmail/gmail-sync.ts"
if [ -f "$GMAIL_SYNC" ]; then
    if run_with_timeout 120 bun run "$GMAIL_SYNC" 2>/dev/null; then
        echo "      Gmail sync complete"
    else
        echo "      Gmail sync failed (non-fatal, continuing)"
    fi
else
    echo "      Gmail sync script not found, skipping"
fi
echo ""

# Step 1: Gather context
GATHER_FLAGS=""
if [ "$FULL_CONTEXT" = true ]; then
    GATHER_FLAGS="--full"
    echo "[1/4] Gathering context (full mode — no truncation)..."
else
    echo "[1/4] Gathering context (truncated mode)..."
fi
cd "${BRIEF_DIR}"

if ! bun run gather-brief-context.ts ${GATHER_FLAGS} > "${CONTEXT_FILE}" 2>/dev/null; then
    echo "Error: Failed to gather context"
    exit 1
fi

CONTEXT_SIZE=$(wc -c < "${CONTEXT_FILE}" | tr -d ' ')
echo "      Context size: ${CONTEXT_SIZE} bytes"

if [ "$DRY_RUN" = true ]; then
    echo ""
    echo "[Dry run] Context saved to: ${CONTEXT_FILE}"
    echo ""
    echo "Preview (first 50 lines):"
    echo "---"
    head -50 "${CONTEXT_FILE}"
    echo "---"
    exit 0
fi

# Step 2: Generate brief with Claude Code
echo "[2/4] Generating brief with Claude Code (Opus)..."

# Build the prompt
PROMPT="You are Atlas, generating a Morning Brief.

Today is ${DAY_OF_WEEK}, ${TODAY}.

INSTRUCTIONS:
1. Read the context file at ${CONTEXT_FILE}
2. Generate a morning brief following the 9-section standard structure
3. Write the brief to: ${BRIEF_OUTPUT}

The brief structure:
1. System Synthesis (2-3 sentences: tone, blocker, success criteria)
2. Priority Actions (top 3 items with score >= 9)
3. Today's Schedule - CLIENT DISCOVERY CALLS need FULL PROFILE TABLES
4. Strategic Leverage (top 5 items with score >= 7)
5. Messages to Respond (full message text)
6. Email Highlights (actionable only)
7. Tasks (grouped by bucket)
8. Context Loaded (health, entities, calls)
9. Errors (only if any)

CRITICAL RULES:
- Follow 'Brief Quality Rules' from context EXACTLY
- Include FULL message text, not summaries
- Be specific: quote actual messages, name actual people
- Every calendar event needs specific prep
- Language match: Russian for Russian speakers

CALL PREP - CRITICAL:
For each CLIENT DISCOVERY call in the calendar, find the matching lead in 'LEADS DATABASE' section by name. Then generate a FULL profile table:

### HH:MM-HH:MM — [Person] @ [Company]
|              |                                           |
| ------------ | ----------------------------------------- |
| **Org**      | [From lead data or research]              |
| **Size**     | [From lead's team_size]                   |
| **Request**  | [From lead's looking_for]                 |
| **Tried**    | [From lead's tried]                       |
| **Maturity** | [LOW/MEDIUM/HIGH based on what they tried]|
| **Play**     | [Your strategic approach]                 |

**Key Questions:**
1-6 tailored questions based on their context.

DO NOT skip this for any discovery call - use the leads data to fill the table.

Start by reading ${CONTEXT_FILE}, then generate and save the brief."

# Invoke Claude Code
CLAUDE_TIMEOUT=600  # 10 minutes

# Use subscription instead of API credits
# See: https://github.com/anthropics/claude-code/issues/3040
unset ANTHROPIC_API_KEY

# Disable external MCP servers in headless mode to prevent hangs
# (Telegram MCP, etc. can block startup when services unavailable)
# --strict-mcp-config without --mcp-config = load zero MCP servers
run_with_timeout $CLAUDE_TIMEOUT claude -p "${PROMPT}" \
    --model claude-opus-4-6 \
    --allowedTools "Read,Write,Bash" \
    --permission-mode bypassPermissions \
    --strict-mcp-config \
    2>&1 | tee /tmp/brief-generation.log
CLAUDE_EXIT=${PIPESTATUS[0]}

if [ "$CLAUDE_EXIT" -eq 0 ]; then
    echo ""
    echo "      Brief generation complete"
else
    echo ""
    echo "Error: Claude Code invocation failed or timed out (exit $CLAUDE_EXIT)"
    echo "Check /tmp/brief-generation.log for details"
    exit 1
fi

# Step 3: Verify output
echo "[3/4] Verifying output..."

if [ -f "${BRIEF_OUTPUT}" ]; then
    BRIEF_SIZE=$(wc -c < "${BRIEF_OUTPUT}" | tr -d ' ')
    BRIEF_LINES=$(wc -l < "${BRIEF_OUTPUT}" | tr -d ' ')
    echo "      Brief saved: ${BRIEF_OUTPUT}"
    echo "      Size: ${BRIEF_SIZE} bytes, ${BRIEF_LINES} lines"

    # Generate todo as well
    echo ""
    echo "[Bonus] Generating todo list..."
    TODO_PATH="${VAULT_PATH}/3 - Todos/${TODAY}.md"
    cd "${CODOS_PATH}/skills/Daily Todo"
    if ./run-todo-cc.sh > /tmp/todo-generation.log 2>&1; then
        if [ -f "${TODO_PATH}" ]; then
            echo "      Todo saved: ${TODO_PATH}"
        fi
    else
        echo "      Todo generation failed. Check /tmp/todo-generation.log"
    fi
else
    echo "Warning: Brief file not found at expected location"
    echo "Check /tmp/brief-generation.log for Claude's output"
fi

echo ""
echo "=========================================="
echo "  Done!"
echo "=========================================="

# Cleanup
rm -f "${CONTEXT_FILE}"
