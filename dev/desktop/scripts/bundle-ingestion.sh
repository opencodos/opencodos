#!/usr/bin/env bash
set -euo pipefail

# Bundle ingestion sync scripts into src-tauri/resources/ingestion/
# These are lightweight TypeScript files that bun runs directly (no npm deps).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TAURI_DIR="$DESKTOP_DIR/src-tauri"
RESOURCES_DIR="$TAURI_DIR/resources"
INGESTION_SRC="$(cd "$DESKTOP_DIR/../../ingestion" && pwd)"
INGESTION_DST="$RESOURCES_DIR/ingestion"

info() { echo "  [ingestion] $*"; }

# Clean previous bundle
rm -rf "$INGESTION_DST"
mkdir -p "$INGESTION_DST"

# Copy shared lib (all non-test .ts and .py files)
info "Copying shared lib..."
mkdir -p "$INGESTION_DST/lib"
find "$INGESTION_SRC/lib" -maxdepth 1 \( -name "*.ts" -o -name "*.py" \) ! -name "*.test.ts" \
    -exec cp {} "$INGESTION_DST/lib/" \;

# Copy each connector's sync scripts (only .ts and .py files, no venvs/node_modules)
for connector in Gmail Calendar Slack Notion Linear Github Granola; do
    src_dir="$INGESTION_SRC/$connector"
    if [ -d "$src_dir" ]; then
        info "Copying $connector..."
        mkdir -p "$INGESTION_DST/$connector"
        # Copy TypeScript and Python sync scripts
        find "$src_dir" -maxdepth 1 \( -name "*.ts" -o -name "*.py" -o -name "*.yaml" -o -name "package.json" \) \
            -exec cp {} "$INGESTION_DST/$connector/" \;
    fi
done

# Telegram-agent is handled separately (standalone binary via bundle:services)
# But copy the ingestion/Telegram directory if it exists (for non-agent Telegram scripts)
if [ -d "$INGESTION_SRC/Telegram" ]; then
    info "Copying Telegram..."
    mkdir -p "$INGESTION_DST/Telegram"
    find "$INGESTION_SRC/Telegram" -maxdepth 1 \( -name "*.ts" -o -name "*.py" -o -name "package.json" \) \
        -exec cp {} "$INGESTION_DST/Telegram/" \;
fi

info "Done. Bundled ingestion scripts to $INGESTION_DST"
