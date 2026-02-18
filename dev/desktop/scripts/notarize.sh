#!/usr/bin/env bash
# Notarize the .app, staple it, then produce a notarized DMG.
# The non-notarized DMG from create-dmg.sh is left untouched.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TAURI_DIR="$(dirname "$SCRIPT_DIR")/src-tauri"
APP_DIR="$TAURI_DIR/target/release/bundle/macos/Codos.app"
DMG_DIR="$TAURI_DIR/target/release/bundle/dmg"

VERSION=$(grep '"version"' "$TAURI_DIR/tauri.conf.json" | head -1 | sed 's/.*: "//;s/".*//')
ARCH=$(uname -m)
DMG_BASE="Codos_${VERSION}_${ARCH}"
DMG_FINAL="$DMG_DIR/${DMG_BASE}-notarized.dmg"

if [[ ! -d "$APP_DIR" ]]; then
    echo "ERROR: App bundle not found at $APP_DIR"
    echo "Run 'tauri build' and create-dmg.sh first."
    exit 1
fi

TEMP_FILES=()
cleanup() {
    for f in "${TEMP_FILES[@]}"; do rm -f "$f"; done
}
trap cleanup EXIT

rm -f "$DMG_FINAL"

# ── Step 1: Zip the .app for notarization submission ──────────────
ZIP_FILE=$(mktemp -t codos-notarize.XXXXXX).zip
TEMP_FILES+=("$ZIP_FILE")

echo "Creating zip of app bundle for notarization..."
ditto -c -k --keepParent "$APP_DIR" "$ZIP_FILE"

# ── Step 2: Notarize the .app ────────────────────────────────────
echo "Submitting .app for notarization..."
echo "Notarization started at $(date '+%Y-%m-%d %H:%M:%S')"

SUBMIT_LOG=$(mktemp)
TEMP_FILES+=("$SUBMIT_LOG")

xcrun notarytool submit "$ZIP_FILE" --keychain-profile "Codos notarize" --wait 2>&1 | tee "$SUBMIT_LOG"

SUBMISSION_ID=$(grep '  id:' "$SUBMIT_LOG" | head -1 | awk '{print $2}')

if ! grep -q "status: Accepted" "$SUBMIT_LOG"; then
    echo "ERROR: Notarization was not accepted."
    if [[ -n "$SUBMISSION_ID" ]]; then
        echo "Fetching detailed log..."
        xcrun notarytool log "$SUBMISSION_ID" --keychain-profile "Codos notarize" || true
    fi
    exit 1
fi

# ── Step 3: Staple the .app ──────────────────────────────────────
echo "Stapling notarization ticket to .app..."
xcrun stapler staple "$APP_DIR"
xcrun stapler validate "$APP_DIR"

# ── Step 4: Create notarized DMG from stapled .app ───────────────
echo "Creating notarized DMG from stapled .app..."

if ! command -v create-dmg &>/dev/null; then
    echo "Installing create-dmg via Homebrew..."
    brew install create-dmg
fi

mkdir -p "$DMG_DIR"

# Window size and icon positions — keep in sync with create-dmg.sh
create-dmg \
    --volname "Codos" \
    --window-pos 200 120 \
    --window-size 660 400 \
    --icon-size 80 \
    --icon "Codos.app" 180 170 \
    --hide-extension "Codos.app" \
    --app-drop-link 480 170 \
    --no-internet-enable \
    "$DMG_FINAL" \
    "$APP_DIR"

# ── Step 5: Codesign the DMG ─────────────────────────────────────
SIGNING_IDENTITY=$(grep '"signingIdentity"' "$TAURI_DIR/tauri.conf.json" | head -1 | sed 's/.*: "//;s/".*//')
echo "Codesigning DMG with: $SIGNING_IDENTITY"
codesign --force --timestamp --sign "$SIGNING_IDENTITY" "$DMG_FINAL"
codesign --verify --verbose=2 "$DMG_FINAL"

# ── Step 6: Notarize and staple the DMG itself ───────────────────
echo "Submitting DMG for notarization..."

DMG_LOG=$(mktemp)
TEMP_FILES+=("$DMG_LOG")

xcrun notarytool submit "$DMG_FINAL" --keychain-profile "Codos notarize" --wait 2>&1 | tee "$DMG_LOG"

if ! grep -q "status: Accepted" "$DMG_LOG"; then
    echo "WARNING: DMG notarization failed (the .app inside is still notarized and will work)"
    DMG_SUB_ID=$(grep '  id:' "$DMG_LOG" | head -1 | awk '{print $2}')
    if [[ -n "$DMG_SUB_ID" ]]; then
        xcrun notarytool log "$DMG_SUB_ID" --keychain-profile "Codos notarize" || true
    fi
else
    echo "Stapling notarization ticket to DMG..."
    xcrun stapler staple "$DMG_FINAL"
    xcrun stapler validate "$DMG_FINAL"
fi

echo ""
echo "Done. Notarized DMG: $DMG_FINAL"
