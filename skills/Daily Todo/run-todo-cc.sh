#!/bin/bash
#
# Daily Todo Generator - Claude Code Wrapper
#
# This script gathers context and invokes Claude Code to generate today's todo.
# It replaces the direct Anthropic API call with Claude Code CLI.
#
# Usage: ./run-todo-cc.sh [--dry-run]
#

set -e

# Load environment (paths + API keys)
# shellcheck source=/dev/null
source ~/.codos/env.sh

SKILL_DIR="${CODOS_PATH}/skills/Daily Todo"
CONTEXT_FILE="/tmp/todo-context.md"

# Get today's date
TODAY=$(date +%Y-%m-%d)
TODO_PATH="${VAULT_PATH}/3 - Todos/${TODAY}.md"

# Parse arguments
DRY_RUN=false
for arg in "$@"; do
  case $arg in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
  esac
done

echo "===== Daily Todo Generator (Claude Code) ====="
echo ""
echo "Today: ${TODAY}"
echo "Output: ${TODO_PATH}"
echo ""

# Step 1: Gather context
echo "Step 1: Gathering context..."
cd "${SKILL_DIR}"
VAULT_PATH="${VAULT_PATH}" bun run gather-todo-context.ts --verbose > "${CONTEXT_FILE}" 2>&1 || {
  # Stderr went to file too, extract just stdout
  VAULT_PATH="${VAULT_PATH}" bun run gather-todo-context.ts > "${CONTEXT_FILE}"
}

CONTEXT_SIZE=$(wc -c < "${CONTEXT_FILE}" | tr -d ' ')
echo "  Context file: ${CONTEXT_FILE} (${CONTEXT_SIZE} bytes)"
echo ""

if [ "$DRY_RUN" = true ]; then
  echo "Step 2: [DRY RUN] Would invoke Claude Code with:"
  echo "  claude -p --model opus"
  echo "  --allowedTools \"Read,Write\""
  echo "  --permission-mode bypassPermissions"
  echo ""
  echo "Context preview (first 500 chars):"
  head -c 500 "${CONTEXT_FILE}"
  echo ""
  echo "..."
  echo ""
  echo "Dry run complete. Context saved to ${CONTEXT_FILE}"
  exit 0
fi

# Step 2: Build the prompt
SYSTEM_PROMPT="You are generating a daily todo list. Read the context file at /tmp/todo-context.md, then write the todo to ${TODO_PATH}.

CRITICAL: Output ONLY the todo content to the file. No explanations, no confirmations.

After reading the context:
1. Generate a complete daily todo following the format in the context
2. Write it to ${TODO_PATH}
3. Respond with just 'Done.' when complete"

# Step 3: Invoke Claude Code
echo "Step 2: Invoking Claude Code..."
echo ""

# Use subscription instead of API credits
# See: https://github.com/anthropics/claude-code/issues/3040
unset ANTHROPIC_API_KEY

claude -p --model opus \
  --allowedTools "Read,Write" \
  --permission-mode bypassPermissions \
  "${SYSTEM_PROMPT}

Read the context from ${CONTEXT_FILE} and generate today's todo."

# Step 4: Verify output
echo ""
if [ -f "${TODO_PATH}" ]; then
  TODO_SIZE=$(wc -l < "${TODO_PATH}" | tr -d ' ')
  echo "===== Todo Generated ====="
  echo "Path: ${TODO_PATH}"
  echo "Lines: ${TODO_SIZE}"
  echo ""
  echo "Preview (first 30 lines):"
  echo "---"
  head -30 "${TODO_PATH}"
  echo "---"
else
  echo "ERROR: Todo file was not created at ${TODO_PATH}"
  exit 1
fi

# Cleanup
rm -f "${CONTEXT_FILE}"
echo ""
echo "Done."
