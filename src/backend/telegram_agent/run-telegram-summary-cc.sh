#!/bin/bash
#
# Run Telegram Daily Summary using Claude Code
#
# This script:
# 1. Gathers Telegram context using Python script
# 2. Invokes Claude Code to analyze and write summary
# 3. Saves output to Obsidian Vault
#
# Usage:
#   ./run-telegram-summary-cc.sh
#

set -e

# Load environment (paths + API keys)
source ~/.codos/env.sh

# Lock file to prevent concurrent executions
LOCKFILE="/tmp/telegram-summary.lock"
cleanup() { rm -f "$LOCKFILE"; }
trap cleanup EXIT

if [ -f "$LOCKFILE" ]; then
    PID=$(cat "$LOCKFILE")
    if kill -0 "$PID" 2>/dev/null; then
        echo "Telegram summary already running (PID $PID), skipping"
        exit 0
    fi
    rm -f "$LOCKFILE"
fi
echo $$ > "$LOCKFILE"

# Timeout function
run_with_timeout() {
    local timeout=$1
    shift
    "$@" &
    local pid=$!
    ( sleep "$timeout"; kill -TERM "$pid" 2>/dev/null; sleep 5; kill -9 "$pid" 2>/dev/null ) &>/dev/null &
    local watchdog=$!
    wait "$pid"
    local ret=$?
    kill "$watchdog" 2>/dev/null
    wait "$watchdog" 2>/dev/null
    return $ret
}

# Paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON_SCRIPT="$SCRIPT_DIR/gather-telegram-summary-context.py"
CONTEXT_FILE="/tmp/telegram-context.md"
TODAY=$(date +%Y-%m-%d)
GENERATED=$(date -u +%Y-%m-%dT%H:%M:%SZ)
OUTPUT_DIR="$VAULT_PATH/1 - Inbox (Last 7 days)/Telegram/Daily Summary"
OUTPUT_FILE="$OUTPUT_DIR/$TODAY.md"
CLAUDE_TIMEOUT=600  # 10 minutes

echo "=== Telegram Daily Summary via Claude Code ==="
echo "Date: $TODAY"
echo "Output: $OUTPUT_FILE"
echo ""

# Ensure output directory exists
mkdir -p "$OUTPUT_DIR"

# Step 1: Gather context
echo "Step 1: Gathering Telegram context..."
cd "$SCRIPT_DIR"

# Activate virtual environment if it exists
if [ -d ".venv" ]; then
    source .venv/bin/activate
fi

python "$PYTHON_SCRIPT" > "$CONTEXT_FILE" 2>&1 || {
    # Check if it's just "no messages" (which goes to stdout)
    if grep -q "No new messages" "$CONTEXT_FILE"; then
        echo "No new messages in the last 24 hours."
        # Still create the file with minimal content
        cat > "$OUTPUT_FILE" << EOF
---
date: $TODAY
generated: $GENERATED
messages_analyzed: 0
---

# Telegram Summary - $TODAY

No new messages in the last 24 hours.
EOF
        echo "Summary saved to: $OUTPUT_FILE"
        exit 0
    fi
    echo "Error gathering context"
    cat "$CONTEXT_FILE"
    exit 1
}

# Check if context file has actual content
if [ ! -s "$CONTEXT_FILE" ]; then
    echo "No context generated (empty file)"
    exit 1
fi

# Count messages from stderr output (logged during gather)
echo ""

# Step 2: Invoke Claude Code to analyze
echo "Step 2: Analyzing with Claude Code..."

# Build the prompt for Claude Code
CLAUDE_PROMPT="Read the Telegram context from /tmp/telegram-context.md and analyze the messages.

Then write a daily summary to: $OUTPUT_FILE

The file should have this format:
---
date: $TODAY
generated: $GENERATED
messages_analyzed: [count from context]
---

# Telegram Summary - $TODAY

[Your analysis here following the format in the context file]

Follow the OUTPUT FORMAT and CRITICAL RULES specified in the context file exactly."

# Use subscription instead of API credits
# See: https://github.com/anthropics/claude-code/issues/3040
unset ANTHROPIC_API_KEY

# Run Claude Code with timeout
if run_with_timeout $CLAUDE_TIMEOUT claude -p "$CLAUDE_PROMPT" \
    --model claude-opus-4-6 \
    --allowedTools "Read,Write" \
    --permission-mode bypassPermissions \
    2>&1 | tee /tmp/telegram-summary-generation.log; then
    echo ""
    echo "=== Summary generation complete ==="
    echo "Output: $OUTPUT_FILE"
else
    echo ""
    echo "Error: Claude Code timed out or failed (exit $?)"
    echo "Check /tmp/telegram-summary-generation.log for details"
    exit 1
fi
