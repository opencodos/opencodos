"""
Shared path configuration for Codos services.

Loads paths from ~/.codos/paths.json (created during setup wizard).
Falls back to environment variables or sensible defaults.
"""

import json
import os
from pathlib import Path

VAULT_PATH = str(Path.home() / "projects" / "codos_vault")

_cached_paths: dict | None = None


def load_paths() -> dict:
    """Load paths from ~/.codos/paths.json with fallbacks."""
    global _cached_paths
    if _cached_paths:
        return _cached_paths

    config_path = Path.home() / ".codos" / "paths.json"

    # Try to load from config file
    if config_path.exists():
        try:
            with open(config_path) as f:
                config = json.load(f)
                _cached_paths = {
                    "codosPath": config.get("codosPath", str(Path.home() / "codos")),
                    "vaultPath": config.get("vaultPath", VAULT_PATH),
                }
                return _cached_paths
        except (OSError, json.JSONDecodeError) as e:
            print(f"Warning: Failed to load ~/.codos/paths.json: {e}")

    # Fallback to environment variables or defaults
    _cached_paths = {
        "codosPath": os.getenv("CODOS_PATH", str(Path.home() / "codos")),
        "vaultPath": os.getenv("VAULT_PATH", VAULT_PATH),
    }
    return _cached_paths


# Load paths on module import
_paths = load_paths()

# Codos paths
CODOS_ROOT = Path(_paths["codosPath"])
INGESTION_ROOT = CODOS_ROOT / "ingestion"  # TypeScript connectors still live here
DEV_ROOT = CODOS_ROOT / "dev"
OPS_ROOT = DEV_ROOT / "Ops"
LOGS_ROOT = DEV_ROOT / "Logs"

# Vault paths - vaultPath points to the Vault folder directly
VAULT_ROOT = Path(_paths["vaultPath"])
VAULT_INBOX = VAULT_ROOT / "1 - Inbox (Last 7 days)"
VAULT_CRM = VAULT_ROOT / "4 - CRM"
VAULT_LOGS = VAULT_ROOT / "5 - Logs"
VAULT_HEALTH_REPORTS = VAULT_ROOT / "0 - Health Reports"

# For compatibility with scripts expecting Obsidian root (parent of Vault/)
OBSIDIAN_ROOT = VAULT_ROOT.parent

# MCP runner
RUN_MCP_PATH = OPS_ROOT / "mcp" / "run-mcp.sh"


def get_node_path() -> str:
    """Get node binary path from NVM or system."""
    nvm_node = Path.home() / ".nvm" / "versions" / "node"
    if nvm_node.exists():
        versions = sorted(nvm_node.iterdir(), reverse=True)
        if versions:
            return str(versions[0] / "bin" / "node")
    return "node"


def get_bun_path() -> str:
    """Get bun binary path."""
    bun_path = Path.home() / ".bun" / "bin" / "bun"
    if bun_path.exists():
        return str(bun_path)
    return "bun"


def get_enhanced_path() -> str:
    """Get PATH with node and bun included."""
    node_dir = str(Path(get_node_path()).parent)
    bun_dir = str(Path(get_bun_path()).parent)
    current_path = os.environ.get("PATH", "/usr/bin:/bin")
    return f"{node_dir}:{bun_dir}:{current_path}"
