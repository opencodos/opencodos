"""Tests for Telegram session lock behavior.

Regression tests for the bug where _spawn_sync() after auth/save_config
grabbed the session lock before the UI could list conversations (→ 503).

Fix: don't spawn sync from auth callbacks or save_config. Cron handles it.
Additional fix: sync subprocess writes PID to lock file so it can be
discovered and killed by the cancel endpoint.
"""

import fcntl
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

import pytest


@pytest.fixture
def lock_file(tmp_path):
    lock_path = tmp_path / ".telegram.lock"
    lock_path.touch()
    return lock_path


def acquire_lock_nonblocking(lock_path: Path) -> int | None:
    fd = os.open(str(lock_path), os.O_WRONLY | os.O_CREAT)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return fd
    except BlockingIOError:
        os.close(fd)
        return None


def release_lock(fd: int):
    fcntl.flock(fd, fcntl.LOCK_UN)
    os.close(fd)


def test_spawn_sync_after_auth_blocks_wizard(lock_file):
    """Regression: auth spawns sync → sync grabs lock → wizard gets 503."""
    # Sync subprocess grabs the lock right after auth
    sync_fd = acquire_lock_nonblocking(lock_file)
    assert sync_fd is not None

    # UI immediately tries to list conversations → blocked
    wizard_fd = acquire_lock_nonblocking(lock_file)
    assert wizard_fd is None, "Wizard blocked by sync — this was the bug"

    release_lock(sync_fd)


def test_no_spawn_sync_means_wizard_succeeds(lock_file):
    """Fix: without _spawn_sync(), lock is free after auth."""
    # Auth completes, no sync spawned → lock is free
    wizard_fd = acquire_lock_nonblocking(lock_file)
    assert wizard_fd is not None, "Wizard should succeed when no sync is running"
    release_lock(wizard_fd)


def test_spawn_sync_not_called_from_server():
    """Verify _spawn_sync() is never called in auth or save_config paths."""
    import ast

    server_path = Path(__file__).parent.parent / "server.py"
    tree = ast.parse(server_path.read_text())

    callers = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            func = node.func
            name = None
            if isinstance(func, ast.Name):
                name = func.id
            elif isinstance(func, ast.Attribute):
                name = func.attr
            if name == "_spawn_sync":
                callers.append(name)

    assert len(callers) == 0, (
        f"_spawn_sync() is called {len(callers)} time(s) — "
        "it should not be called anywhere to avoid lock contention"
    )


# ==================== PID-based lock tests ====================


def test_pid_written_to_lock_file(lock_file):
    """Sync subprocess writes its PID to the lock file after acquiring flock."""
    fd = os.open(str(lock_file), os.O_WRONLY | os.O_CREAT)
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)

    # Simulate what agent.py does: write PID
    os.write(fd, str(os.getpid()).encode())
    os.fsync(fd)

    # Read it back
    with open(lock_file, "r") as f:
        pid = int(f.read().strip())

    assert pid == os.getpid()

    release_lock(fd)


def test_pid_readable_while_lock_held(lock_file):
    """Lock file PID can be read even while flock is held by another fd."""
    # Acquire lock and write PID
    fd = os.open(str(lock_file), os.O_WRONLY | os.O_CREAT)
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    os.write(fd, str(os.getpid()).encode())
    os.fsync(fd)

    # Another reader can still open and read the file (flock is advisory)
    with open(lock_file, "r") as f:
        pid = int(f.read().strip())

    assert pid == os.getpid()

    release_lock(fd)


def test_killing_process_releases_flock(lock_file):
    """Killing a process that holds flock releases the lock."""
    # Spawn a subprocess that acquires the lock and sleeps
    child = subprocess.Popen(
        [
            sys.executable,
            "-c",
            f"""
import fcntl, os, time
fd = open("{lock_file}", "w")
fcntl.flock(fd, fcntl.LOCK_EX)
fd.write(str(os.getpid()))
fd.flush()
time.sleep(60)
""",
        ],
    )

    # Wait for child to acquire the lock
    for _ in range(50):
        time.sleep(0.1)
        try:
            with open(lock_file, "r") as f:
                content = f.read().strip()
                if content and int(content) == child.pid:
                    break
        except (ValueError, FileNotFoundError):
            pass
    else:
        child.kill()
        pytest.fail("Child never wrote PID to lock file")

    # Verify lock is held
    assert acquire_lock_nonblocking(lock_file) is None

    # Kill the child
    os.kill(child.pid, signal.SIGTERM)
    child.wait(timeout=5)

    # Lock should now be free
    fd = acquire_lock_nonblocking(lock_file)
    assert fd is not None, "Lock should be released after process death"
    release_lock(fd)
