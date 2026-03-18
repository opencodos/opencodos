#!/usr/bin/env bash
# Codos Installer — curl -sSL https://raw.githubusercontent.com/opencodos/opencodos/main/scripts/install.sh | bash
set -euo pipefail

# ── Config ──────────────────────────────────────────────────────────────────
CODOS_DIR="${CODOS_DIR:-$HOME/codos}"
REPO_TARBALL="https://github.com/opencodos/opencodos/archive/refs/heads/main.tar.gz"
BIN_DIR="$HOME/.local/bin"

# ── Helpers ─────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'
info()  { printf "${GREEN}==> %s${NC}\n" "$1"; }
warn()  { printf "${YELLOW}WARNING: %s${NC}\n" "$1"; }
error() { printf "${RED}ERROR: %s${NC}\n" "$1" >&2; }
die()   { error "$1"; exit 1; }

# ── Banner ──────────────────────────────────────────────────────────────────
printf "\n${BOLD}  ╔═══════════════════════════════════╗${NC}\n"
printf "${BOLD}  ║        Codos Installer             ║${NC}\n"
printf "${BOLD}  ║   AI Operating System for Work     ║${NC}\n"
printf "${BOLD}  ╚═══════════════════════════════════╝${NC}\n\n"

# ── Preflight ───────────────────────────────────────────────────────────────
command -v curl >/dev/null 2>&1 || die "curl is required but not found. Install it and retry."

# ── Check existing install ──────────────────────────────────────────────────
if [ -d "$CODOS_DIR" ]; then
  if [ -f "$CODOS_DIR/CLAUDE.md" ] && [ -d "$CODOS_DIR/scripts" ]; then
    info "Existing Codos install found at $CODOS_DIR — updating..."
  else
    die "$CODOS_DIR exists but doesn't look like a Codos install.
  Set CODOS_DIR to a different path:  CODOS_DIR=/path/to/codos curl ... | sh"
  fi
fi

# ── Download & extract ──────────────────────────────────────────────────────
info "Downloading Codos..."
TMP_TAR=$(mktemp /tmp/codos-XXXXXX.tar.gz)
trap 'rm -f "$TMP_TAR"' EXIT

curl -fsSL "$REPO_TARBALL" -o "$TMP_TAR" || die "Download failed. Check your internet connection."

info "Extracting to $CODOS_DIR..."
mkdir -p "$CODOS_DIR"
# Extract tarball — strip the top-level opencodos-main/ directory
tar xzf "$TMP_TAR" -C "$CODOS_DIR" --strip-components=1

# ── Install codos CLI ──────────────────────────────────────────────────────
info "Installing codos command..."
mkdir -p "$BIN_DIR"
chmod +x "$CODOS_DIR/scripts/codos"
ln -sf "$CODOS_DIR/scripts/codos" "$BIN_DIR/codos"

# Add ~/.local/bin to PATH in shell rc if not already there
add_to_path() {
  local rc="$1"
  if [ -f "$rc" ] && grep -q '\.local/bin' "$rc" 2>/dev/null; then
    return
  fi
  # Append to rc file (creates it if missing, e.g. fresh macOS has no .zshrc)
  printf '\n# Codos CLI\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$rc"
  info "Added ~/.local/bin to PATH in $(basename "$rc")"
}

case "${SHELL:-/bin/sh}" in
  */zsh)  add_to_path "$HOME/.zshrc" ;;
  */bash) add_to_path "$HOME/.bashrc"; add_to_path "$HOME/.bash_profile" ;;
  *)      add_to_path "$HOME/.profile" ;;
esac

# Ensure PATH is available in this session
export PATH="$BIN_DIR:$PATH"

# ── Parse flags for passthrough ────────────────────────────────────────────
EXTRA_FLAGS=""
for arg in "$@"; do
  case "$arg" in
    --remote) EXTRA_FLAGS="$EXTRA_FLAGS --remote" ;;
  esac
done

# ── Kick off bootstrap ──────────────────────────────────────────────────────
info "Starting Codos setup..."
echo ""
rm -f "$TMP_TAR"

printf "\n${BOLD}  To use 'codos' in a new terminal, restart your shell or run:${NC}\n"
printf "    export PATH=\"\$HOME/.local/bin:\$PATH\"\n\n"

exec bash "$CODOS_DIR/scripts/codos" start --full $EXTRA_FLAGS
