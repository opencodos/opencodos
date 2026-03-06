#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TAURI_DIR="$ROOT_DIR/src-tauri"
CONFIG_FILE="$TAURI_DIR/tauri.conf.json"
export PATH="$HOME/.cargo/bin:$PATH"

echo "== Codos Desktop release preflight =="

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "ERROR: macOS is required for desktop release builds."
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node is not installed."
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: npm is not installed."
  exit 1
fi
if ! command -v cargo >/dev/null 2>&1; then
  echo "ERROR: cargo is not installed or not on PATH."
  exit 1
fi
if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "ERROR: Xcode command line tools are missing."
  exit 1
fi
if ! xcodebuild -version >/dev/null 2>&1; then
  echo "ERROR: full Xcode is required for release builds (not only CommandLineTools)."
  echo "Install Xcode and set: sudo xcode-select -s /Applications/Xcode.app/Contents/Developer"
  exit 1
fi

echo "Node: $(node -v)"
echo "npm: $(npm -v)"
echo "cargo: $(cargo --version)"
echo "xcodebuild: $(xcodebuild -version | head -n 1)"

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "ERROR: missing tauri config: $CONFIG_FILE"
  exit 1
fi

if ! grep -q '"identifier"' "$CONFIG_FILE"; then
  echo "ERROR: tauri identifier is missing in $CONFIG_FILE"
  exit 1
fi

echo "Checking desktop dependencies..."
if [[ ! -d "$ROOT_DIR/node_modules" ]]; then
  echo "ERROR: missing dev/desktop/node_modules. Run: npm --prefix dev/desktop install"
  exit 1
fi
if [[ ! -d "$ROOT_DIR/../frontend/node_modules" ]]; then
  echo "ERROR: missing dev/frontend/node_modules. Run: npm --prefix dev/frontend install"
  exit 1
fi

echo "Rust compile check..."
cargo check --manifest-path "$TAURI_DIR/Cargo.toml" >/dev/null

echo "Python syntax sanity checks for managed services..."
python3 -m py_compile \
  "$ROOT_DIR/../../backend/connector/server.py" \
  "$ROOT_DIR/../../backend/telegram_agent/server.py"

echo "Preflight OK."
echo "Next: npm --prefix dev/desktop run build:macos"
