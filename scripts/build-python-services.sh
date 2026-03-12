#!/usr/bin/env bash
# Build standalone PyInstaller binaries for Python services.
# Usage: bash scripts/build-python-services.sh [service-name]
#
# Builds: telegram-agent, codos-bot, telegram-mcp
# Output: dev/desktop/src-tauri/resources/services/<name>/<name>
#
# gateway-backend is excluded — it stays on bundled PYTHONHOME + server.py.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RESOURCES_DIR="$REPO_ROOT/dev/desktop/src-tauri/resources/services"

resolve_service() {
    local name="$1"
    case "$name" in
        telegram-agent)
            SVC_SRC_DIR="backend/codos_services/telegram_agent"
            SVC_ENTRY="main.py"
            ;;
        codos-bot)
            SVC_SRC_DIR="backend/codos_services/codos_bot"
            SVC_ENTRY="main.py"
            ;;
        telegram-mcp)
            SVC_SRC_DIR="backend/codos_services/telegram_mcp"
            SVC_ENTRY="main.py"
            ;;
        *)
            echo "Unknown service: $name"
            echo "Available: telegram-agent, codos-bot, telegram-mcp"
            return 1
            ;;
    esac
}

build_service() {
    local name="$1"
    resolve_service "$name"

    local src_dir="$REPO_ROOT/$SVC_SRC_DIR"
    local entry="$SVC_ENTRY"
    local out_dir="$RESOURCES_DIR/$name"

    echo "=== Building $name ==="
    echo "  Source: $src_dir"
    echo "  Entry:  $entry"
    echo "  Output: $out_dir/$name"

    if [ ! -d "$src_dir" ]; then
        echo "ERROR: Source directory not found: $src_dir"
        return 1
    fi

    cd "$src_dir"

    # Create isolated build venv via uv
    uv venv .build-venv --python 3.13 --quiet --clear
    uv pip install --python .build-venv/bin/python --quiet . pyinstaller

    # Service-specific PyInstaller flags
    local extra_flags=""
    case "$name" in
        telegram-agent)
            extra_flags="--hidden-import pyaes \
                --hidden-import rsa \
                --hidden-import uvicorn.logging \
                --hidden-import uvicorn.loops \
                --hidden-import uvicorn.loops.auto \
                --hidden-import uvicorn.protocols \
                --hidden-import uvicorn.protocols.http \
                --hidden-import uvicorn.protocols.http.auto \
                --hidden-import uvicorn.protocols.websockets \
                --hidden-import uvicorn.protocols.websockets.auto \
                --hidden-import uvicorn.lifespan \
                --hidden-import uvicorn.lifespan.on \
                --collect-all PIL \
                --collect-all rich \
                --exclude-module textual"
            ;;
        codos-bot)
            extra_flags="--hidden-import telegram \
                --hidden-import telegram.ext \
                --hidden-import httpx \
                --collect-all assemblyai"
            ;;
        telegram-mcp)
            extra_flags="--hidden-import pyaes \
                --hidden-import rsa \
                --hidden-import mcp \
                --hidden-import mcp.server \
                --hidden-import mcp.server.fastmcp \
                --hidden-import nest_asyncio \
                --hidden-import pythonjsonlogger \
                --collect-all mcp"
            ;;
    esac

    # Ensure lib package (shared logging/paths) is discoverable by PyInstaller
    local ingestion_dir="$REPO_ROOT/backend"

    # Build (word-splitting on extra_flags is intentional)
    # shellcheck disable=SC2086
    .build-venv/bin/pyinstaller \
        --onefile \
        --name "$name" \
        --paths "$ingestion_dir" \
        --hidden-import lib.log \
        $extra_flags \
        "$entry"

    # Copy binary to resources
    mkdir -p "$out_dir"
    cp "dist/$name" "$out_dir/$name"
    chmod +x "$out_dir/$name"

    # Clean up
    rm -rf .build-venv build dist "${name}.spec"

    echo "  Done: $out_dir/$name"
    echo ""

    cd "$REPO_ROOT"
}

# Build specific service or all
if [ $# -gt 0 ]; then
    for svc in "$@"; do
        build_service "$svc"
    done
else
    for svc in telegram-agent codos-bot telegram-mcp; do
        build_service "$svc"
    done
fi

echo "All builds complete."
