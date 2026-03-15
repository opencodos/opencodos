#!/usr/bin/env bash
# Sign all embedded binaries and create a DMG with "drag to Applications" installer
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TAURI_DIR="$(dirname "$SCRIPT_DIR")/src-tauri"
APP_DIR="$TAURI_DIR/target/release/bundle/macos/Codos.app"
DMG_DIR="$TAURI_DIR/target/release/bundle/dmg"
ENTITLEMENTS="$TAURI_DIR/Entitlements.plist"

if [[ ! -d "$APP_DIR" ]]; then
    echo "ERROR: App bundle not found at $APP_DIR"
    exit 1
fi

# Read signing identity from tauri.conf.json
SIGNING_IDENTITY=$(grep '"signingIdentity"' "$TAURI_DIR/tauri.conf.json" | head -1 | sed 's/.*: "//;s/".*//')
if [[ -z "$SIGNING_IDENTITY" ]]; then
    echo "ERROR: signingIdentity not found in tauri.conf.json"
    exit 1
fi

# ── Step 1: Sign all embedded binaries ──────────────────────────────
echo "Signing embedded binaries in $APP_DIR ..."

RESOURCES_DIR="$APP_DIR/Contents/Resources"
SIGNED_COUNT=0

while IFS= read -r -d '' binary; do
    if file "$binary" | grep -q "Mach-O"; then
        codesign --force --options runtime --timestamp \
            --entitlements "$ENTITLEMENTS" \
            --sign "$SIGNING_IDENTITY" "$binary" && {
            SIGNED_COUNT=$((SIGNED_COUNT + 1))
        } || {
            echo "  WARNING: Failed to sign: $binary"
        }
    fi
done < <(find "$RESOURCES_DIR" -type f \( -name "*.so" -o -name "*.dylib" -o -name "python" -o -name "python3" -o -name "python3.*" -o -name "bun" -o -perm +111 \) -print0)

if [[ "$SIGNED_COUNT" -eq 0 ]]; then
    echo "ERROR: No binaries were signed. Something is wrong with the find pattern."
    exit 1
fi
echo "Signed $SIGNED_COUNT embedded binaries"

# ── Step 2: Re-sign the app bundle ─────────────────────────────────
echo "Re-signing the app bundle..."
codesign --force --options runtime --timestamp \
    --entitlements "$ENTITLEMENTS" \
    --sign "$SIGNING_IDENTITY" "$APP_DIR"

echo "Verifying signature..."
codesign --verify --deep --strict --verbose=2 "$APP_DIR" 2>&1 || {
    echo "ERROR: App signature verification failed"
    exit 1
}

# ── Step 3: Create the DMG ─────────────────────────────────────────
if ! command -v create-dmg &>/dev/null; then
    echo "Installing create-dmg via Homebrew..."
    brew install create-dmg
fi

mkdir -p "$DMG_DIR"

VERSION=$(grep '"version"' "$TAURI_DIR/tauri.conf.json" | head -1 | sed 's/.*: "//;s/".*//')
ARCH=$(uname -m)
DMG_NAME="Codos_${VERSION}_${ARCH}-not-notarized.dmg"
DMG_FILE="$DMG_DIR/$DMG_NAME"

rm -f "$DMG_FILE"

echo "Creating DMG: $DMG_FILE"

# Window size and icon positions match tauri.conf.json dmg settings — keep in sync with notarize.sh
create-dmg \
    --volname "Codos" \
    --window-pos 200 120 \
    --window-size 660 400 \
    --icon-size 80 \
    --icon "Codos.app" 180 170 \
    --hide-extension "Codos.app" \
    --app-drop-link 480 170 \
    --no-internet-enable \
    "$DMG_FILE" \
    "$APP_DIR"

echo "Done. DMG: $DMG_FILE"
