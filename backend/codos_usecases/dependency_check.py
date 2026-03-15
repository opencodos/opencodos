"""Check whether external CLI dependencies (Claude, Bun) are installed and functional."""

from __future__ import annotations

import json
import os
import subprocess

from loguru import logger

from backend.codos_models.exceptions import DependencyNotInstalledException
from backend.codos_models.settings import settings
from backend.codos_utils.deps import find_claude


def _resolve_claude_cmd() -> tuple[list[str], str] | None:
    """Resolve the claude CLI command prefix and path.

    Returns:
        (cmd_prefix, claude_path) or None if claude is not found.
    """
    claude_path = find_claude()

    if not claude_path:
        return None

    return [claude_path], claude_path


def get_claude_info() -> tuple[bool, str | None, str | None]:
    """Check if claude CLI is installed and get version/path."""
    resolved = _resolve_claude_cmd()
    logger.info(f"[dep-check] resolved claude cmd={resolved}")

    if not resolved:
        return False, None, None

    cmd_prefix, claude_path = resolved
    cmd = [*cmd_prefix, "--version"]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        version = result.stdout.strip() if result.returncode == 0 else None
        stderr_snippet = result.stderr[:200] if result.stderr else ""
        logger.info(f"[dep-check] claude version={version!r},returncode={result.returncode},stderr={stderr_snippet!r}")
        if result.returncode == 127:
            logger.warning("[dep-check] claude returncode 127 — interpreter (node) not found")
            return False, None, claude_path
        return True, version, claude_path
    except Exception as e:
        logger.warning(f"[dep-check] claude version check failed: {e}")
        return True, None, claude_path


def check_claude_login() -> tuple[bool, str | None, str | None]:
    """Check if Claude CLI is logged in.

    Runs ``claude auth status --json`` with CLAUDECODE unset to avoid nested session errors.

    Returns:
        (logged_in, email, debug_info) — *logged_in* is False if not authenticated,
        *email* is the account email if available, *debug_info* has diagnostic details on failure.
    """
    resolved = _resolve_claude_cmd()
    if not resolved:
        return False, None, "claude command not found"

    cmd_prefix, _ = resolved
    cmd = [*cmd_prefix, "auth", "status", "--json"]

    # Must unset CLAUDECODE to avoid "nested session" error
    env = os.environ.copy()
    env.pop("CLAUDECODE", None)

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10, env=env)
        logger.info(
            f"[dep-check] claude auth status rc={result.returncode},"
            f" stdout={result.stdout[:200]!r}, stderr={result.stderr[:200]!r}"
        )
        debug = (
            f"cmd={' '.join(cmd)}, rc={result.returncode}, "
            f"stdout={result.stdout[:300]!r}, stderr={result.stderr[:300]!r}"
        )
        # Try parsing JSON regardless of exit code — some versions return
        # non-zero even when logged in (e.g. rc=1 with valid JSON output).
        # Also check stderr — some versions write JSON there.
        for output in (result.stdout, result.stderr):
            if not output.strip():
                continue
            try:
                data = json.loads(output.strip())
                logged_in = data.get("loggedIn", False)
                email = data.get("email")
                return logged_in, email, None if logged_in else debug
            except (json.JSONDecodeError, ValueError):
                continue
        return False, None, debug
    except Exception as e:
        logger.warning(f"[dep-check] claude auth status check failed: {e}")
        # If we can't check, assume logged in to avoid blocking on transient errors
        return True, None, None


def get_bun_info() -> tuple[bool, str | None, str | None]:
    """Check if bun is installed and get version/path."""
    try:
        bun_path = settings.bun_path
    except DependencyNotInstalledException:
        return False, None, None

    result = subprocess.run([bun_path, "--version"], capture_output=True, text=True, timeout=5)
    version = result.stdout.strip() if result.returncode == 0 else None
    return True, version, bun_path
