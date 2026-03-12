"""Locate external CLI dependencies."""

from __future__ import annotations

import shutil
from pathlib import Path


def find_bun() -> str | None:
    """Find the bun executable via PATH or ~/.bun/bin/bun."""
    found = shutil.which("bun")
    if found:
        return found
    home_bun = Path.home() / ".bun" / "bin" / "bun"
    if home_bun.exists():
        return str(home_bun)
    return None


def find_claude() -> str | None:
    """Find the claude CLI executable with fallback paths.

    Checks: PATH, common install locations, NVM, and fnm.
    """
    found = shutil.which("claude")
    if found:
        return found

    common_paths = [
        "/usr/local/bin/claude",
        "/opt/homebrew/bin/claude",
        str(Path.home() / ".local/bin/claude"),
    ]

    for path in common_paths:
        if Path(path).exists():
            return path

    # NVM (npm global installs)
    nvm_base = Path.home() / ".nvm/versions/node"
    if nvm_base.exists():
        for version_dir in sorted(nvm_base.iterdir(), reverse=True):
            candidate = version_dir / "bin" / "claude"
            if candidate.exists():
                return str(candidate)

    # fnm (alternative node version manager)
    fnm_base = Path.home() / ".fnm/node-versions"
    if fnm_base.exists():
        for version_dir in sorted(fnm_base.iterdir(), reverse=True):
            candidate = version_dir / "installation/bin/claude"
            if candidate.exists():
                return str(candidate)

    return None
