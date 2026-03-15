#!/usr/bin/env bash
set -euo pipefail

# Bundle a standalone Bun binary + claude-code CLI into
# src-tauri/resources/ so the Tauri app can run without system bun/claude.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TAURI_DIR="$DESKTOP_DIR/src-tauri"
RESOURCES_DIR="$TAURI_DIR/resources"

BUN_VERSION="1.2.1"
PLATFORM="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

# Map architecture names to bun release naming
case "$ARCH" in
    x86_64)  BUN_ARCH="x64" ;;
    arm64)   BUN_ARCH="aarch64" ;;
    aarch64) BUN_ARCH="aarch64" ;;
    *)       echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

case "$PLATFORM" in
    darwin) BUN_PLATFORM="darwin" ;;
    linux)  BUN_PLATFORM="linux" ;;
    *)      echo "Unsupported platform: $PLATFORM"; exit 1 ;;
esac

BUN_RELEASE_NAME="bun-${BUN_PLATFORM}-${BUN_ARCH}"
BUN_ZIP="${BUN_RELEASE_NAME}.zip"
BUN_URL="https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/${BUN_ZIP}"

info() { echo -e "\033[0;32m==>\033[0m $1"; }
warn() { echo -e "\033[1;33mWARNING:\033[0m $1"; }

# ==================== Step 1: Download Bun ====================

BUN_DIR="$RESOURCES_DIR/bun"

if [ -d "$BUN_DIR/bin" ] && [ -x "$BUN_DIR/bin/bun" ]; then
    info "Bundled Bun already exists at $BUN_DIR, skipping download"
else
    info "Downloading Bun v${BUN_VERSION} for ${BUN_PLATFORM}-${BUN_ARCH}..."
    DOWNLOAD_DIR="$(mktemp -d)"
    ZIPFILE="$DOWNLOAD_DIR/$BUN_ZIP"

    curl -fSL --progress-bar -o "$ZIPFILE" "$BUN_URL"

    info "Extracting Bun to $BUN_DIR..."
    rm -rf "$BUN_DIR"
    mkdir -p "$BUN_DIR/bin"

    # Bun zips extract to bun-{platform}-{arch}/bun
    unzip -q "$ZIPFILE" -d "$DOWNLOAD_DIR"
    cp "$DOWNLOAD_DIR/$BUN_RELEASE_NAME/bun" "$BUN_DIR/bin/bun"
    chmod +x "$BUN_DIR/bin/bun"

    rm -rf "$DOWNLOAD_DIR"
fi

# Verify bun binary
if [ ! -x "$BUN_DIR/bin/bun" ]; then
    echo "ERROR: Bun binary not found after extraction"
    exit 1
fi

info "Bundled Bun: $("$BUN_DIR/bin/bun" --version)"

# ==================== Step 2: Install claude-code ====================

info "Installing @anthropic-ai/claude-code via bundled Bun..."

# BUN_INSTALL controls where global packages go
export BUN_INSTALL="$BUN_DIR"

"$BUN_DIR/bin/bun" install -g @anthropic-ai/claude-code

# Verify claude binary
if [ ! -x "$BUN_DIR/bin/claude" ]; then
    echo "ERROR: claude binary not found after install"
    exit 1
fi

CLAUDE_VERSION=$("$BUN_DIR/bin/claude" --version 2>/dev/null || echo "unknown")
info "Bundled Claude CLI: $CLAUDE_VERSION"

# ==================== Step 3: Update Manifest ====================

MANIFEST="$RESOURCES_DIR/bundle-manifest.json"

if [ -f "$MANIFEST" ]; then
    info "Merging bun/claude versions into existing manifest..."
    # Use python3 to merge into existing manifest (avoid jq dependency)
    python3 -c "
import json, sys
with open('$MANIFEST') as f:
    m = json.load(f)
m['bun_version'] = '$BUN_VERSION'
m['claude_version'] = '$CLAUDE_VERSION'
m['bun_arch'] = '$BUN_ARCH'
m['bun_platform'] = '$BUN_PLATFORM'
with open('$MANIFEST', 'w') as f:
    json.dump(m, f, indent=2)
    f.write('\n')
"
else
    info "Writing new bundle manifest..."
    cat > "$MANIFEST" << EOF
{
  "bun_version": "$BUN_VERSION",
  "claude_version": "$CLAUDE_VERSION",
  "bun_platform": "$BUN_PLATFORM",
  "bun_arch": "$BUN_ARCH",
  "built_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
fi

# ==================== Summary ====================

BUN_SIZE=$(du -sh "$BUN_DIR" | cut -f1)

info "Bun bundle complete!"
echo "    Bun:     $BUN_SIZE ($BUN_DIR)"
echo "    Claude:  $CLAUDE_VERSION"
echo "    Manifest: $MANIFEST"
