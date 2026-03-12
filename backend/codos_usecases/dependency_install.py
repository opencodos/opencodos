"""Auto-install logic for external dependencies (bun, etc.)."""

from __future__ import annotations

import os
import shutil
import subprocess
from collections.abc import Callable
from pathlib import Path
from typing import TypedDict


class InstallableDep(TypedDict):
    check: Callable[[], bool]
    cmd: list[str]
    shell_reload: bool


INSTALLABLE_DEPS: dict[str, InstallableDep] = {
    "bun": {
        "check": lambda: shutil.which("bun") is not None,
        "cmd": ["bash", "-c", "curl -fsSL https://bun.sh/install | bash"],
        "shell_reload": True,
    },
}


async def auto_install_bun() -> tuple[bool, str]:
    """Attempt to auto-install bun. Returns ``(success, message)``."""
    try:
        result = subprocess.run(
            ["bash", "-c", "curl -fsSL https://bun.sh/install | bash"],
            capture_output=True,
            text=True,
            timeout=120,
            env={**os.environ, "BUN_INSTALL": str(Path.home() / ".bun")},
        )
        if result.returncode == 0:
            return True, "Bun installed successfully"
        return False, result.stderr or "Installation failed"
    except subprocess.TimeoutExpired:
        return False, "Installation timed out"
    except Exception as e:
        return False, str(e)


def install_dependency(name: str) -> tuple[bool, str, str | None]:
    """Install a dependency by name.

    Returns ``(success, message, output)``.
    """
    if name not in INSTALLABLE_DEPS:
        return (
            False,
            f"Automatic installation not supported for '{name}'. Please install manually.",
            None,
        )

    dep_config = INSTALLABLE_DEPS[name]

    if dep_config["check"]():
        return True, f"{name} is already installed", None

    try:
        result = subprocess.run(
            dep_config["cmd"],
            capture_output=True,
            text=True,
            timeout=120,
            env={**os.environ, "BUN_INSTALL": str(Path.home() / ".bun")},
        )

        if result.returncode == 0:
            hint = ""
            if name == "bun" and dep_config.get("shell_reload"):
                bun_path = Path.home() / ".bun" / "bin" / "bun"
                if bun_path.exists():
                    hint = "\n\nNote: You may need to restart your terminal or run: source ~/.bashrc (or ~/.zshrc)"
            return True, f"{name} installed successfully!{hint}", result.stdout or result.stderr
        else:
            return (
                False,
                f"Installation failed with exit code {result.returncode}",
                result.stderr or result.stdout,
            )

    except subprocess.TimeoutExpired:
        return False, "Installation timed out after 2 minutes", None
    except Exception as e:
        return False, f"Installation error: {str(e)}", None
