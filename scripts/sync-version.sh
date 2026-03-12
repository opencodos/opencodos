#!/usr/bin/env bash
# Reads VERSION from repo root and updates all config files that embed the version.
# Run this after changing VERSION and before building.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(cat "$REPO_ROOT/VERSION" | tr -d '[:space:]')"

if [ -z "$VERSION" ]; then
  echo "ERROR: VERSION file is empty" >&2
  exit 1
fi

echo "Syncing version $VERSION..."

# 1. dev/desktop/package.json
DESKTOP_PKG="$REPO_ROOT/dev/desktop/package.json"
if [ -f "$DESKTOP_PKG" ]; then
  # Use a temp file for portable sed
  sed "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" "$DESKTOP_PKG" > "$DESKTOP_PKG.tmp"
  mv "$DESKTOP_PKG.tmp" "$DESKTOP_PKG"
  echo "  Updated $DESKTOP_PKG"
fi

# 2. dev/desktop/src-tauri/tauri.conf.json
TAURI_CONF="$REPO_ROOT/dev/desktop/src-tauri/tauri.conf.json"
if [ -f "$TAURI_CONF" ]; then
  sed "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" "$TAURI_CONF" > "$TAURI_CONF.tmp"
  mv "$TAURI_CONF.tmp" "$TAURI_CONF"
  echo "  Updated $TAURI_CONF"
fi

# 3. dev/desktop/src-tauri/Cargo.toml (only the package version line)
CARGO_TOML="$REPO_ROOT/dev/desktop/src-tauri/Cargo.toml"
if [ -f "$CARGO_TOML" ]; then
  sed "s/^version = \"[^\"]*\"/version = \"$VERSION\"/" "$CARGO_TOML" > "$CARGO_TOML.tmp"
  mv "$CARGO_TOML.tmp" "$CARGO_TOML"
  echo "  Updated $CARGO_TOML"
fi

echo "Done."
