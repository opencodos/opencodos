#!/bin/bash
#
# Granola Call Summarization - Claude Code Wrapper
#
# Summarizes call transcripts using Claude Code CLI (subscription billing).
#
# Usage:
#   ./run-summarize-cc.sh              # Summarize all unsummarized calls
#   ./run-summarize-cc.sh --dry-run    # List calls to summarize without invoking Claude
#

set -e

# Load environment (paths)
source ~/.codos/env.sh

# Lock file to prevent concurrent executions
LOCKFILE="/tmp/granola-summarize.lock"
cleanup() { rm -f "$LOCKFILE"; }
trap cleanup EXIT

if [ -f "$LOCKFILE" ]; then
    PID=$(cat "$LOCKFILE")
    if kill -0 "$PID" 2>/dev/null; then
        echo "Granola summarization already running (PID $PID), skipping"
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

GRANOLA_DIR="${VAULT_PATH}/1 - Inbox (Last 7 days)/Granola"
SUMMARIES_DIR="${GRANOLA_DIR}/Summaries"
CLAUDE_TIMEOUT=300  # 5 minutes per call summary

# Parse arguments
DRY_RUN=false
for arg in "$@"; do
    case $arg in
        --dry-run)
            DRY_RUN=true
            ;;
        --help|-h)
            echo "Granola Call Summarization - Claude Code Wrapper"
            echo ""
            echo "Usage:"
            echo "  ./run-summarize-cc.sh              # Summarize all unsummarized calls"
            echo "  ./run-summarize-cc.sh --dry-run    # List calls without summarizing"
            echo "  ./run-summarize-cc.sh --help       # Show this help"
            exit 0
            ;;
    esac
done

echo "=========================================="
echo "  Granola Call Summarization"
echo "=========================================="
echo ""
echo "Granola folder: ${GRANOLA_DIR}"
echo "Summaries folder: ${SUMMARIES_DIR}"
echo ""

# Ensure summaries directory exists
mkdir -p "${SUMMARIES_DIR}"

# Find calls that need summarization (handle paths with spaces)
UNSUMMARIZED=()
while IFS= read -r dir; do
    [ -z "$dir" ] && continue
    CALL_NAME=$(basename "$dir")
    SUMMARY_FILE="${SUMMARIES_DIR}/${CALL_NAME}.md"

    if [ ! -f "$SUMMARY_FILE" ]; then
        if [ -f "${dir}/transcript.md" ]; then
            UNSUMMARIZED+=("$CALL_NAME")
        fi
    fi
done < <(find "${GRANOLA_DIR}" -mindepth 1 -maxdepth 1 -type d ! -name "Summaries" | sort)

if [ ${#UNSUMMARIZED[@]} -eq 0 ] && [ ! -d "${GRANOLA_DIR}" ]; then
    echo "No call directories found."
    exit 0
fi

if [ ${#UNSUMMARIZED[@]} -eq 0 ]; then
    echo "All calls already summarized."
    exit 0
fi

echo "Calls to summarize: ${#UNSUMMARIZED[@]}"
for call in "${UNSUMMARIZED[@]}"; do
    echo "  - $call"
done
echo ""

if [ "$DRY_RUN" = true ]; then
    echo "[Dry run] Exiting without summarizing."
    exit 0
fi

# Use subscription instead of API credits
unset ANTHROPIC_API_KEY

# Process each call
SUMMARIZED=0
ERRORS=0

for call in "${UNSUMMARIZED[@]}"; do
    echo "Processing: $call"

    CALL_DIR="${GRANOLA_DIR}/${call}"
    TRANSCRIPT="${CALL_DIR}/transcript.md"

    # Scale timeout by transcript size: 5 min base + 1 min per 20KB
    TRANSCRIPT_SIZE=$(wc -c < "$TRANSCRIPT" 2>/dev/null || echo 0)
    CALL_TIMEOUT=$(( CLAUDE_TIMEOUT + TRANSCRIPT_SIZE / 20000 * 60 ))
    echo "  Transcript: ${TRANSCRIPT_SIZE} bytes, timeout: ${CALL_TIMEOUT}s"
    METADATA="${CALL_DIR}/metadata.json"
    SUMMARY_FILE="${SUMMARIES_DIR}/${call}.md"

    # Read metadata if exists
    if [ -f "$METADATA" ]; then
        TITLE=$(python3 -c "import json,sys;d=json.load(open(sys.argv[1]));print(d.get('title',''))" "$METADATA" 2>/dev/null || echo "$call")
        DATE=$(python3 -c "import json,sys;d=json.load(open(sys.argv[1]));print(d.get('date',''))" "$METADATA" 2>/dev/null || echo "Unknown")
        ATTENDEES=$(python3 -c "import json,sys;d=json.load(open(sys.argv[1]));print(', '.join(d.get('attendees',[])))" "$METADATA" 2>/dev/null || echo "Unknown")
    else
        TITLE="$call"
        DATE="Unknown"
        ATTENDEES="Unknown"
    fi

    # Build prompt
    PROMPT="Summarize this meeting transcript for ${USER_NAME:-the user}'s personal AI assistant (Atlas).

## Meeting Info
- Title: ${TITLE}
- Date: ${DATE}
- Attendees: ${ATTENDEES}

## Instructions
Read the transcript at ${TRANSCRIPT} and create a summary with these sections:

### Part 1: Meeting Summary
1. **TL;DR** - 1-2 sentence overview
2. **Key Points** - Main topics discussed (bullet points)
3. **Action Items** - Tasks or follow-ups (format as checkboxes: - [ ] Task)
4. **Decisions Made** - Any YES/NO decisions, commitments, or refusals
5. **Notable Quotes** - 1-2 important quotes

### Part 2: Atlas Next Steps
**CRM Updates**
| Person | Update |
|--------|--------|
| Name | What changed: status, relationship, new info |

**Tasks to Add**
- [ ] Task description (deadline if mentioned)

**Memory Updates**
- New facts worth remembering

Write the summary to ${SUMMARY_FILE} in this format:

# Summary: ${TITLE}

**Date:** ${DATE}
**Attendees:** ${ATTENDEES}

---

[Summary content here]

---
*Auto-generated from Granola transcript*"

    # Invoke Claude Code with timeout
    if run_with_timeout $CALL_TIMEOUT claude -p "$PROMPT" \
        --model claude-opus-4-6 \
        --allowedTools "Read,Write" \
        --permission-mode bypassPermissions \
        2>&1 | tee "/tmp/granola-summary-${call}.log"; then

        if [ -f "$SUMMARY_FILE" ]; then
            echo "  ✓ Summarized: $SUMMARY_FILE"
            ((SUMMARIZED++))
        else
            echo "  ✗ Summary file not created"
            ((ERRORS++))
        fi
    else
        echo "  ✗ Claude Code failed or timed out for: $call"
        ((ERRORS++))
    fi
    echo ""
done

echo "=========================================="
echo "  Done!"
echo "=========================================="
echo "Summarized: ${SUMMARIZED}"
echo "Errors: ${ERRORS}"
