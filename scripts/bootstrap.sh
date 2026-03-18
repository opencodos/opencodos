#!/usr/bin/env bash
set -Eeuo pipefail
trap 'echo -e "\033[0;31mERROR:\033[0m Script failed at line $LINENO: $BASH_COMMAND" >&2' ERR

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="$ROOT_DIR/dev/frontend"
# Log dir matches settings.get_log_dir() (~/.codos/logs/)
LOG_DIR="$HOME/.codos/logs"
mkdir -p "$LOG_DIR"

# Python version to use
PYTHON_VERSION="3.13"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

info() { echo -e "${GREEN}==>${NC} $1"; }
warn() { echo -e "${YELLOW}WARNING:${NC} $1"; }
error() { echo -e "${RED}ERROR:${NC} $1"; }

# Generate Claude Code MCP config from paths.json (merge, don't overwrite)
generate_mcp_config() {
  local CODOS_PATHS="$HOME/.codos/paths.json"
  local MCP_CONFIG="$HOME/.claude/.mcp.json"

  # Get CODOS_PATH from paths.json or use ROOT_DIR as fallback
  local CODOS_PATH="$ROOT_DIR"
  if [ -f "$CODOS_PATHS" ]; then
    CODOS_PATH=$(grep -o '"codos_path"[[:space:]]*:[[:space:]]*"[^"]*"' "$CODOS_PATHS" | cut -d'"' -f4 || true)
    if [ -z "$CODOS_PATH" ]; then
      CODOS_PATH="$ROOT_DIR"
    fi
  fi

  # Ensure .claude directory exists
  mkdir -p "$HOME/.claude"

  # Merge telegram server into existing config (preserves user-added servers)
  python3 - "$MCP_CONFIG" "$CODOS_PATH" << 'PY'
import json, sys, os

mcp_path, codos_path = sys.argv[1], sys.argv[2]

config = {"mcpServers": {}}
if os.path.exists(mcp_path):
    try:
        with open(mcp_path) as f:
            config = json.load(f)
        if "mcpServers" not in config:
            config["mcpServers"] = {}
    except (json.JSONDecodeError, OSError):
        config = {"mcpServers": {}}

config["mcpServers"]["telegram"] = {
    "command": codos_path + "/backend/.venv/bin/python",
    "args": ["main.py"],
    "cwd": codos_path + "/backend/codos_services/telegram_mcp"
}

with open(mcp_path, "w") as f:
    json.dump(config, f, indent=2)
    f.write("\n")
PY

  info "Updated $MCP_CONFIG (merged telegram server, preserved existing)"
}

# Ensure API key exists for backend auth and frontend usage
generate_api_key() {
  python3 - << 'PY'
import secrets
print(secrets.token_hex(32))
PY
}

ensure_api_key() {
  local SECRETS_JSON="$HOME/.codos/secrets.json"
  local FRONTEND_ENV="$ROOT_DIR/dev/frontend/.env.local"
  local key=""

  # Read existing key from secrets.json (canonical source)
  # Use uv run — venv may not exist yet on first install
  if [ -f "$SECRETS_JSON" ]; then
    key=$(uv run python -c "import json,sys; s=json.load(open('$SECRETS_JSON')); print(s.get('secrets',{}).get('ATLAS_API_KEY',''))" 2>/dev/null)
  fi

  if [ -z "$key" ] && [ -f "$FRONTEND_ENV" ]; then
    key=$(grep -E "^VITE_ATLAS_API_KEY=" "$FRONTEND_ENV" | tail -1 | cut -d'=' -f2-)
  fi

  if [ -z "$key" ]; then
    key="$(generate_api_key)"
  fi

  # Write to secrets.json (where the backend's Settings reads from)
  mkdir -p "$(dirname "$SECRETS_JSON")"
  uv run python -c "
import json, pathlib, os, tempfile
p = pathlib.Path('$SECRETS_JSON')
envelope = json.loads(p.read_text()) if p.exists() else {}
secrets = envelope.get('secrets', {})
secrets['ATLAS_API_KEY'] = '$key'
envelope['secrets'] = secrets
fd, tmp = tempfile.mkstemp(dir=str(p.parent), prefix='.secrets_', suffix='.tmp')
os.fchmod(fd, 0o600)
os.write(fd, (json.dumps(envelope, indent=2) + '\n').encode())
os.close(fd)
os.rename(tmp, str(p))
"

  # Write to frontend .env.local (Vite build-time requirement)
  mkdir -p "$(dirname "$FRONTEND_ENV")"
  if [ -f "$FRONTEND_ENV" ] && grep -q "^VITE_ATLAS_API_KEY=" "$FRONTEND_ENV"; then
    perl -pi -e "s/^VITE_ATLAS_API_KEY=.*/VITE_ATLAS_API_KEY=$key/" "$FRONTEND_ENV"
  else
    echo "VITE_ATLAS_API_KEY=$key" >> "$FRONTEND_ENV"
  fi
}

# Parse arguments
INSTALL_DEPS=true
START_SERVICES=false
OPEN_BROWSER=true
REMOTE_MODE=false

show_help() {
  echo "Codos Setup Script"
  echo ""
  echo "Usage: $0 [OPTIONS]"
  echo ""
  echo "Options:"
  echo "  --start       Install deps and start all services (first-time setup)"
  echo "  --quick       Skip dep installation, just start services (daily use)"
  echo "  --remote      VPS mode: build frontend, install systemd services"
  echo "  --no-browser  Don't open browser automatically"
  echo "  --help        Show this help"
  echo ""
  echo "Examples:"
  echo "  $0 --start           # First time: install everything + start"
  echo "  $0 --quick           # Daily use: just start services"
  echo "  $0 --start --remote  # VPS deployment via SSH tunnel"
  echo "  $0                   # Just install deps, don't start"
}

for arg in "$@"; do
  case $arg in
    --start)
      START_SERVICES=true
      ;;
    --quick)
      INSTALL_DEPS=false
      START_SERVICES=true
      ;;
    --remote)
      REMOTE_MODE=true
      OPEN_BROWSER=false
      ;;
    --no-browser)
      OPEN_BROWSER=false
      ;;
    --help|-h)
      show_help
      exit 0
      ;;
    *)
      error "Unknown option: $arg"
      show_help
      exit 1
      ;;
  esac
done

# Check Node.js version (need 20.19+ or 22.12+)
check_node_version() {
  if ! command -v node >/dev/null 2>&1; then
    return 1
  fi
  node -e "const v=process.versions.node.split('.').map(Number);const ok=(v[0]>22||(v[0]==22&&v[1]>=12))||(v[0]==20&&v[1]>=19);process.exit(ok?0:1)" 2>/dev/null
}

# Setup nvm and install correct Node version
setup_node_via_nvm() {
  local NVM_DIR="${HOME}/.nvm"

  # Install nvm if not present
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    info "Installing nvm..."
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
  fi

  # Source nvm
  export NVM_DIR="$NVM_DIR"
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

  # Handle .npmrc prefix conflict with nvm
  if [ -f "$HOME/.npmrc" ] && grep -q "prefix" "$HOME/.npmrc" 2>/dev/null; then
    warn "Found .npmrc with prefix setting (conflicts with nvm)"
    local NPMRC_BAK="$HOME/.npmrc.bak.$$"
    mv "$HOME/.npmrc" "$NPMRC_BAK"
    trap 'mv "$NPMRC_BAK" "$HOME/.npmrc" 2>/dev/null || true' EXIT
  fi

  # Install and use Node 22
  info "Installing Node 22 via nvm..."
  nvm install 22
  nvm use 22
}

# Setup uv (replaces pyenv + poetry)
setup_uv() {
  if command -v uv &>/dev/null; then
    return 0
  fi

  # Check common install locations
  if [ -x "$HOME/.local/bin/uv" ]; then
    export PATH="$HOME/.local/bin:$PATH"
    return 0
  fi
  if [ -x "$HOME/.cargo/bin/uv" ]; then
    export PATH="$HOME/.cargo/bin:$PATH"
    return 0
  fi

  info "Installing uv..."
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
}

# Install Python deps for a project using uv
install_python_deps() {
  local project_dir=$1
  local project_name=$2

  info "Installing $project_name deps..."
  cd "$project_dir"

  # uv sync creates .venv and installs from pyproject.toml
  uv sync --project backend --python "$PYTHON_VERSION"
}

# Helper: kill any process on a port
kill_port() {
  local port=$1
  local pids
  pids=$(lsof -ti ":$port" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "    Killing existing process on port $port..."
    echo "$pids" | xargs kill -9 2>/dev/null || true
    sleep 1
  fi
}

# Helper: wait for a service to be healthy
wait_for_health() {
  local url=$1
  local name=$2
  local max_attempts=30
  local attempt=0

  echo -n "    Waiting for $name..."
  while [ $attempt -lt $max_attempts ]; do
    if curl -s "$url" > /dev/null 2>&1; then
      echo " ready!"
      return 0
    fi
    sleep 1
    attempt=$((attempt + 1))
    echo -n "."
  done
  echo " FAILED (timeout after ${max_attempts}s)"
  return 1
}

# ==================== Prerequisites Check ====================

# Verify file ownership — archive extracts may be owned by a different user
repo_owner=$(stat -f%Su "$ROOT_DIR" 2>/dev/null || stat -c%U "$ROOT_DIR" 2>/dev/null)
if [ "$repo_owner" != "$(whoami)" ]; then
  error "Repository owned by '$repo_owner', not '$(whoami)'"
  echo "  Fix:  sudo chown -R $(whoami):$(id -gn) \"$ROOT_DIR\""
  exit 1
fi

info "Checking prerequisites..."

# Ensure lsof is available (needed for port checks)
if ! command -v lsof >/dev/null 2>&1; then
  if [[ "$OSTYPE" == "linux"* ]]; then
    if command -v apt-get >/dev/null 2>&1; then
      info "Installing lsof..."
      sudo apt-get install -y lsof 2>/dev/null || warn "Could not install lsof (port checks may fail)"
    elif command -v yum >/dev/null 2>&1; then
      info "Installing lsof..."
      sudo yum install -y lsof 2>/dev/null || warn "Could not install lsof (port checks may fail)"
    else
      warn "lsof not found — port checks may fail. Install it manually."
    fi
  fi
fi

# Check/install Homebrew (macOS only)
if [[ "$OSTYPE" == "darwin"* ]] && ! command -v brew >/dev/null 2>&1; then
  if [ ! -t 0 ]; then
    # Non-interactive (piped) mode — install Homebrew unattended
    info "Non-interactive mode: installing Homebrew automatically..."
    NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  else
    info "Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  fi

  # Add brew to PATH for Apple Silicon or Intel
  if [[ -f "/opt/homebrew/bin/brew" ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [[ -f "/usr/local/bin/brew" ]]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
fi

# Setup uv (replaces pyenv + poetry)
setup_uv
UV_VERSION=$(uv --version 2>/dev/null || echo "unknown")
info "Found uv $UV_VERSION"

# Check Node.js version
if ! check_node_version; then
  NODE_VERSION=$(node --version 2>/dev/null || echo "not installed")
  warn "Node $NODE_VERSION is too old or not installed. Need 20.19+ or 22.12+"

  if [ ! -t 0 ] || [ "$REMOTE_MODE" = true ]; then
    # Non-interactive or remote mode — auto-accept
    info "Installing Node 22 via nvm automatically..."
    setup_node_via_nvm
  else
    read -p "Install Node 22 via nvm? [Y/n] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Nn]$ ]]; then
      setup_node_via_nvm
    else
      error "Please install Node 20.19+ or 22.12+ manually"
      exit 1
    fi
  fi
fi

NODE_VERSION=$(node --version)
info "Found Node $NODE_VERSION"

# Check Bun (required for TypeScript sync scripts)
if ! command -v bun >/dev/null 2>&1; then
  # Check if bun is in ~/.bun/bin but not in PATH
  if [ -x "$HOME/.bun/bin/bun" ]; then
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"
  else
    # Bun installer requires unzip
    if ! command -v unzip >/dev/null 2>&1; then
      if command -v apt-get >/dev/null 2>&1; then
        info "Installing unzip (required by Bun installer)..."
        sudo apt-get install -y unzip
      elif command -v yum >/dev/null 2>&1; then
        info "Installing unzip (required by Bun installer)..."
        sudo yum install -y unzip
      fi
    fi
    info "Installing Bun (required for sync scripts)..."
    curl -fsSL https://bun.sh/install | bash
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"
  fi
fi

BUN_VERSION=$(bun --version 2>/dev/null || echo "unknown")
info "Found Bun $BUN_VERSION"

# Check/install Claude Code (official CLI)
if ! command -v claude >/dev/null 2>&1; then
  info "Installing Claude Code..."
  if curl -fsSL https://claude.ai/install.sh | bash; then
    # Add to PATH for this session
    if [ -x "$HOME/.claude/local/bin/claude" ]; then
      export PATH="$HOME/.claude/local/bin:$PATH"
    fi
  else
    warn "Claude Code install failed (continuing without it)"
  fi
fi

# Google Workspace: Gmail, Calendar, Drive via claude.ai Connectors
# No CLI install needed — set up at claude.ai/settings/connectors
info "Google Workspace: connect via claude.ai Settings > Connectors"

# Ensure auth key exists before installs or startup
ensure_api_key

# ==================== Install Dependencies ====================

if [ "$INSTALL_DEPS" = true ]; then
  # Install all Python deps using uv (single root venv)
  install_python_deps "$ROOT_DIR" "codos"

  info "Installing frontend deps..."
  cd "$FRONTEND_DIR"
  bun install

  info "Dependencies installed!"

  # Generate MCP config for Claude Code
  info "Generating Claude Code MCP config..."
  generate_mcp_config
else
  info "Skipping dependency installation (--quick mode)"

  # Verify root venv exists for quick mode
  if [ ! -d "$ROOT_DIR/backend/.venv" ]; then
    error "Backend venv not found. Run without --quick first: $0 --start"
    exit 1
  fi
fi

# ==================== Start Services ====================

# ── Start: shared setup ────────────────────────────────────────────────────
seed_paths_json() {
  PATHS_JSON="$HOME/.codos/paths.json"
  if [ ! -f "$PATHS_JSON" ]; then
    mkdir -p "$HOME/.codos"
    cat > "$PATHS_JSON" <<SEED
{
  "codos_path": "$ROOT_DIR",
  "vault_path": "$HOME/codos_vault"
}
SEED
    info "Seeded $PATHS_JSON (will be updated by setup wizard)"
  fi
}

# ── Start: remote / VPS mode ──────────────────────────────────────────────
start_remote() {
  # Build frontend (served by gateway as static files)
  info "Building frontend for remote mode..."
  cd "$FRONTEND_DIR"
  bun run build

  # Install systemd services instead of background processes
  info "Installing systemd services..."
  bash "$ROOT_DIR/scripts/codos" install-service

  # Wait for gateway to come up
  echo "  Checking services..."
  wait_for_health "http://127.0.0.1:8767/health" "Gateway" || {
    error "Gateway failed to start. Check: journalctl --user -u codos-gateway"
    exit 1
  }
  wait_for_health "http://127.0.0.1:8768/telegram/auth/status" "Telegram agent" || {
    warn "Telegram agent not responding (continuing anyway)"
  }

  # Detect server IP for SSH instructions
  # Prefer public IP via external lookup; fall back to placeholder
  SERVER_IP=$(curl -4 -s --max-time 3 https://ifconfig.me 2>/dev/null || echo "<your-server-ip>")

  echo ""
  info "Codos is running on this server!"
  echo ""
  echo "    Gateway:        http://127.0.0.1:8767 (API + frontend)"
  echo "    Telegram agent: http://127.0.0.1:8768"
  echo ""
  echo "    Logs: journalctl --user -u codos-gateway -f"
  echo ""
  echo "  To access from your local machine, open an SSH tunnel:"
  echo ""
  echo "    ssh -L 8767:localhost:8767 $(whoami)@${SERVER_IP}"
  echo ""
  echo "  Then open: http://localhost:8767"
  echo ""
  echo "  Services will keep running after you disconnect."
  echo "  To stop:  codos stop"
}

# ── Start: local / desktop mode ───────────────────────────────────────────
start_local() {
  # Start backend (python -m backend <subcommand> from src/ directory)
  echo "  Starting backend (port 8767)..."
  cd "$ROOT_DIR"
  "$ROOT_DIR/backend/.venv/bin/python" -m backend gateway > "$LOG_DIR/codos-backend.log" 2>&1 &
  BACKEND_PID=$!

  # Start Telegram agent
  echo "  Starting Telegram agent (port 8768)..."
  cd "$ROOT_DIR"
  "$ROOT_DIR/backend/.venv/bin/python" -m backend telegram-agent server > "$LOG_DIR/codos-telegram.log" 2>&1 &
  TELEGRAM_PID=$!

  # Start frontend
  echo "  Starting frontend (port 5174)..."
  cd "$FRONTEND_DIR"
  bun run dev -- --host 127.0.0.1 --port 5174 > "$LOG_DIR/codos-frontend.log" 2>&1 &
  FRONTEND_PID=$!

  # Trap Ctrl+C to clean up
  cleanup() {
    echo ""
    info "Shutting down services..."
    kill $BACKEND_PID $TELEGRAM_PID $FRONTEND_PID 2>/dev/null || true
    exit 0
  }
  trap cleanup INT TERM

  # Wait for services to be ready
  echo "  Checking services..."
  wait_for_health "http://127.0.0.1:8767/health" "Backend" || {
    error "Backend failed to start. Check $LOG_DIR/codos-backend.log"
    tail -20 "$LOG_DIR/codos-backend.log"
    exit 1
  }
  wait_for_health "http://127.0.0.1:8768/telegram/auth/status" "Telegram agent" || {
    warn "Telegram agent not responding (continuing anyway)"
  }
  wait_for_health "http://127.0.0.1:5174" "Frontend" || {
    error "Frontend failed to start. Check $LOG_DIR/codos-frontend.log"
    tail -20 "$LOG_DIR/codos-frontend.log"
    exit 1
  }

  # Determine landing page: skip wizard if setup already completed
  LANDING_PAGE="setup"
  SETUP_STATUS=$(curl -s "http://127.0.0.1:8767/api/setup/status" 2>/dev/null || echo "")
  if echo "$SETUP_STATUS" | grep -q '"setup_completed"[[:space:]]*:[[:space:]]*true'; then
    LANDING_PAGE="agents"
  fi

  echo ""
  info "All services running!"
  echo "    Dashboard:      http://127.0.0.1:5174"
  echo "    Backend:        http://127.0.0.1:8767"
  echo "    Telegram agent: http://127.0.0.1:8768"
  echo ""
  echo "    Logs: $LOG_DIR/"
  echo ""

  # Open browser
  if [ "$OPEN_BROWSER" = true ]; then
    if [[ "$OSTYPE" == "darwin"* ]]; then
      open "http://127.0.0.1:5174/#/$LANDING_PAGE"
    elif command -v xdg-open >/dev/null 2>&1; then
      xdg-open "http://127.0.0.1:5174/#/$LANDING_PAGE"
    fi
  fi

  echo "Press Ctrl+C to stop all services..."
  wait
}

# ==================== Start Services ====================

if [ "$START_SERVICES" = true ]; then
  info "Starting services..."

  # Clean up ports first
  echo "  Cleaning up ports..."
  kill_port 8767
  kill_port 8768
  kill_port 5174

  seed_paths_json

  if [ "$REMOTE_MODE" = true ]; then
    start_remote
  else
    start_local
  fi
fi
