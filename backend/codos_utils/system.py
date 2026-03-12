"""System-level utilities (user name, timezone)."""

from __future__ import annotations

import os
import subprocess
from pathlib import Path


def get_system_name() -> str:
    """Get the user's full name from the system.

    Falls back to the USER environment variable if `id -F` is unavailable.
    """
    try:
        result = subprocess.run(["id", "-F"], capture_output=True, text=True, timeout=5)
        if result.returncode == 0:
            return result.stdout.strip()
    except Exception:
        pass

    return os.environ.get("USER", "User")


def get_system_timezone() -> str:
    """Get the system timezone from /etc/localtime symlink.

    Falls back to the TZ environment variable, then UTC.
    """
    try:
        localtime_path = Path("/etc/localtime")
        if localtime_path.is_symlink():
            real_path = os.path.realpath(localtime_path)
            # Extract timezone from path like /var/db/timezone/zoneinfo/Asia/Bangkok
            if "zoneinfo/" in real_path:
                return real_path.split("zoneinfo/")[1]
    except Exception:
        pass

    return os.environ.get("TZ", "UTC")
