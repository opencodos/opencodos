#!/usr/bin/env bash
set -euo pipefail

# Bundle a standalone Python interpreter + service source code into
# src-tauri/resources/ so the Tauri app can run without bootstrap.sh.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TAURI_DIR="$DESKTOP_DIR/src-tauri"
RESOURCES_DIR="$TAURI_DIR/resources"
CODOS_ROOT="$(cd "$DESKTOP_DIR/../.." && pwd)"

PYTHON_VERSION="3.13.12"
PLATFORM="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

# Map architecture names to python-build-standalone naming
case "$ARCH" in
    x86_64)  PBS_ARCH="x86_64" ;;
    arm64)   PBS_ARCH="aarch64" ;;
    aarch64) PBS_ARCH="aarch64" ;;
    *)       echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

case "$PLATFORM" in
    darwin) PBS_PLATFORM="apple-darwin" ;;
    linux)  PBS_PLATFORM="unknown-linux-gnu" ;;
    *)      echo "Unsupported platform: $PLATFORM"; exit 1 ;;
esac

PBS_RELEASE="20260203"
PBS_FILENAME="cpython-${PYTHON_VERSION}+${PBS_RELEASE}-${PBS_ARCH}-${PBS_PLATFORM}-install_only_stripped.tar.gz"
PBS_URL="https://github.com/astral-sh/python-build-standalone/releases/download/${PBS_RELEASE}/${PBS_FILENAME}"

info() { echo -e "\033[0;32m==>\033[0m $1"; }
warn() { echo -e "\033[1;33mWARNING:\033[0m $1"; }

# ==================== Step 1: Download Python ====================

PYTHON_DIR="$RESOURCES_DIR/python"

if [ -d "$PYTHON_DIR" ] && [ -x "$PYTHON_DIR/bin/python3" ]; then
    info "Bundled Python already exists at $PYTHON_DIR, skipping download"
else
    info "Downloading python-build-standalone ($PYTHON_VERSION for $PBS_ARCH-$PBS_PLATFORM)..."
    DOWNLOAD_DIR="$(mktemp -d)"
    TARBALL="$DOWNLOAD_DIR/$PBS_FILENAME"

    curl -fSL --progress-bar -o "$TARBALL" "$PBS_URL"

    info "Extracting Python to $PYTHON_DIR..."
    rm -rf "$PYTHON_DIR"
    mkdir -p "$PYTHON_DIR"
    tar xzf "$TARBALL" -C "$RESOURCES_DIR"
    # python-build-standalone extracts to python/, which is what we want

    rm -rf "$DOWNLOAD_DIR"
fi

# Verify
if [ ! -x "$PYTHON_DIR/bin/python3" ]; then
    echo "ERROR: Python binary not found after extraction"
    exit 1
fi

info "Bundled Python: $("$PYTHON_DIR/bin/python3" --version)"

# ==================== Step 2: Install Dependencies ====================

info "Installing unified Python dependencies..."

# Check if uv is available
if command -v uv &>/dev/null; then
    UV_CMD="uv"
elif [ -x "$HOME/.local/bin/uv" ]; then
    UV_CMD="$HOME/.local/bin/uv"
elif [ -x "$HOME/.cargo/bin/uv" ]; then
    UV_CMD="$HOME/.cargo/bin/uv"
else
    info "Installing uv..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    UV_CMD="$HOME/.local/bin/uv"
fi

# Install from root pyproject.toml (unified deps)
"$UV_CMD" pip install \
    --python "$PYTHON_DIR/bin/python3" \
    --requirement "$CODOS_ROOT/pyproject.toml" \
    --quiet

# ==================== Step 3: Strip Unnecessary Files ====================

info "Stripping unnecessary files to reduce bundle size..."

find "$PYTHON_DIR" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
find "$PYTHON_DIR" -type d -name "*.dist-info" -exec rm -rf {} + 2>/dev/null || true
find "$PYTHON_DIR" -type d -name "tests" -exec rm -rf {} + 2>/dev/null || true
find "$PYTHON_DIR" -type d -name "test" -exec rm -rf {} + 2>/dev/null || true
find "$PYTHON_DIR" -name "*.pyc" -delete 2>/dev/null || true
find "$PYTHON_DIR" -name "*.pyo" -delete 2>/dev/null || true

# ==================== Step 4: Copy Unified Backend Package ====================

SERVICES_DIR="$RESOURCES_DIR/services"
rm -rf "$SERVICES_DIR"
mkdir -p "$SERVICES_DIR/backend"

info "Copying unified backend package..."
cp "$CODOS_ROOT/src/backend/__init__.py" "$SERVICES_DIR/backend/"
cp "$CODOS_ROOT/src/backend/__main__.py" "$SERVICES_DIR/backend/"

for mod in lib connector telegram_agent atlas_bot telegram_mcp; do
    rsync -a \
        --exclude '.venv' \
        --exclude '__pycache__' \
        --exclude 'tests' \
        --exclude '*.pyc' \
        "$CODOS_ROOT/src/backend/$mod" "$SERVICES_DIR/backend/"
done

# Copy skills directory (SKILL.md files + orchestrator.md)
info "Copying skills..."
rm -rf "$RESOURCES_DIR/skills"
if [ -d "$CODOS_ROOT/skills" ]; then
    rsync -a \
        --exclude '.venv' \
        --exclude '__pycache__' \
        --exclude 'node_modules' \
        "$CODOS_ROOT/skills/" "$RESOURCES_DIR/skills/"
fi

# ==================== Step 5: Write Manifest ====================

info "Writing bundle manifest..."
cat > "$RESOURCES_DIR/bundle-manifest.json" << EOF
{
  "python_version": "$PYTHON_VERSION",
  "platform": "$PBS_PLATFORM",
  "arch": "$PBS_ARCH",
  "built_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "services": [
    "backend"
  ]
}
EOF

# ==================== Summary ====================

PYTHON_SIZE=$(du -sh "$PYTHON_DIR" | cut -f1)
SERVICES_SIZE=$(du -sh "$SERVICES_DIR" | cut -f1)

info "Bundle complete!"
echo "    Python:   $PYTHON_SIZE ($PYTHON_DIR)"
echo "    Services: $SERVICES_SIZE ($SERVICES_DIR)"
echo "    Manifest: $RESOURCES_DIR/bundle-manifest.json"
