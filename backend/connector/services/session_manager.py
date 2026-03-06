"""Manages tmux sessions for Claude Code agents.

This module provides robust tmux session management for running Claude Code
CLI instances with real-time text streaming via pipe-pane and structured
events via hooks.

Key features:
- Idempotent session creation (tmux new-session -A pattern)
- Zombie session detection and cleanup
- Version validation (2.4+ required, 2.6+ recommended)
- pipe-pane for sub-millisecond text streaming
- Session-specific CLAUDE.md with agent personas
- Hooks for tool events (PreToolUse, PostToolUse, Stop, etc.)
"""

import json
import os
import re
import shutil
import subprocess
import time
from pathlib import Path

from loguru import logger
from ..settings import SESSIONS_DIR, settings

from .agent_loader import build_session_prompt, parse_agent

# Session storage
HOOKS_DIR = Path(__file__).parent.parent / "hooks"


def check_tmux_version(tmux_path: str = "tmux") -> tuple[bool, str]:
    """Check if tmux version is sufficient for pipe-pane streaming.

    Args:
        tmux_path: Path to tmux executable (default: "tmux" uses PATH)

    Returns:
        tuple[bool, str]: (is_ok, message)
        - is_ok: True if tmux >= 2.4, False otherwise
        - message: Human-readable status or error message

    Version requirements:
    - Minimum: tmux 2.4+ (April 2017) - contains critical pipe-pane buffer fix
    - Recommended: tmux 2.6+ (October 2017) - adds data flushing + escape timeout

    Known issue: tmux < 2.4 has garbled pipe-pane output due to buffer offset bug.
    """
    try:
        result = subprocess.run([tmux_path, "-V"], capture_output=True, text=True, timeout=5)

        if result.returncode != 0:
            return False, "tmux command failed. Is tmux installed?"

        version_str = result.stdout.strip()  # e.g., "tmux 3.3a" or "tmux next-3.3"

        # Extract version number using regex
        match = re.search(r"(\d+)\.(\d+)", version_str)
        if not match:
            return False, f"Could not parse tmux version: {version_str}"

        major, minor = int(match.group(1)), int(match.group(2))

        if major < 2 or (major == 2 and minor < 4):
            return False, (
                f"tmux {major}.{minor} detected. Version 2.6+ recommended (2.4+ required).\n"
                f"Known issue: pipe-pane produces garbled output in tmux < 2.4.\n"
                f"Please upgrade:\n"
                f"  macOS: brew install tmux\n"
                f"  Ubuntu: apt install tmux\n"
                f"  Or from source: https://github.com/tmux/tmux/releases"
            )

        if major == 2 and minor < 6:
            return True, (
                f"tmux {major}.{minor} detected. Works but 2.6+ recommended for better stability.\n"
                f"Consider upgrading for improved data flushing and escape sequence handling."
            )

        return True, f"tmux {major}.{minor} detected. OK"

    except FileNotFoundError:
        return False, (
            "tmux not found in PATH. Please install:\n"
            "  macOS: brew install tmux\n"
            "  Ubuntu/Debian: apt install tmux\n"
            "  Fedora: dnf install tmux\n"
            "  Or from source: https://github.com/tmux/tmux/releases"
        )
    except subprocess.TimeoutExpired:
        return False, "tmux -V command timed out"
    except Exception as e:
        return False, f"Error checking tmux version: {e}"


def _find_claude_cli() -> str:
    """Find the claude CLI executable with fallback paths.

    Returns:
        str: Absolute path to claude CLI

    Raises:
        RuntimeError: If claude CLI cannot be found
    """
    # Check bundled claude from Tauri app
    bundled = settings.atlas_bundled_claude
    if bundled and Path(bundled).exists():
        return bundled

    # First, try shutil.which (uses PATH)
    claude_path = shutil.which("claude")
    if claude_path:
        return claude_path

    # Check common installation locations
    common_paths = [
        "/usr/local/bin/claude",
        "/opt/homebrew/bin/claude",
        str(Path.home() / ".local/bin/claude"),
    ]

    for path in common_paths:
        if Path(path).exists():
            return path

    # Check NVM paths (for npm global installs)
    nvm_base = Path.home() / ".nvm/versions/node"
    if nvm_base.exists():
        # Find all node versions and check for claude
        for version_dir in sorted(nvm_base.iterdir(), reverse=True):
            candidate = version_dir / "bin" / "claude"
            if candidate.exists():
                return str(candidate)

    # Check fnm paths (alternative node version manager)
    fnm_base = Path.home() / ".fnm/node-versions"
    if fnm_base.exists():
        for version_dir in sorted(fnm_base.iterdir(), reverse=True):
            candidate = version_dir / "installation/bin/claude"
            if candidate.exists():
                return str(candidate)

    raise RuntimeError(
        "claude CLI not found in PATH or common locations.\nPlease install: npm install -g @anthropic-ai/claude-code"
    )


def _find_bun_cli() -> str | None:
    """Find the bun executable (bundled or system)."""
    bundled = settings.atlas_bundled_bun
    if bundled and Path(bundled).exists():
        return bundled
    bun_path = shutil.which("bun")
    if bun_path:
        return bun_path
    home_bun = Path.home() / ".bun" / "bin" / "bun"
    if home_bun.exists():
        return str(home_bun)
    return None


def _find_tmux() -> str:
    """Find the tmux executable with fallback paths.

    Returns:
        str: Absolute path to tmux

    Raises:
        RuntimeError: If tmux cannot be found
    """
    # First, try shutil.which (uses PATH)
    tmux_path = shutil.which("tmux")
    if tmux_path:
        return tmux_path

    # Check common installation locations
    common_paths = [
        "/opt/homebrew/bin/tmux",  # macOS Apple Silicon
        "/usr/local/bin/tmux",  # macOS Intel / manual install
        "/usr/bin/tmux",  # Linux system install
        "/home/linuxbrew/.linuxbrew/bin/tmux",  # Linuxbrew
    ]

    for path in common_paths:
        if os.path.isfile(path) and os.access(path, os.X_OK):
            return path

    raise RuntimeError(
        "tmux not found in PATH or common locations.\n"
        "Please install:\n"
        "  macOS: brew install tmux\n"
        "  Ubuntu/Debian: apt install tmux\n"
        "  Fedora: dnf install tmux"
    )


class SessionManager:
    """Manages Claude Code tmux sessions with robust error handling.

    This class handles:
    - Creating tmux sessions with Claude Code CLI
    - Setting up CLAUDE.md with agent personas
    - Configuring hooks for event streaming
    - Setting up pipe-pane for real-time text output
    - Detecting and cleaning up zombie sessions
    - Handling edge cases (immediate exit, PATH issues, etc.)
    """

    def __init__(self):
        """Initialize the session manager.

        Creates the sessions directory and validates tmux installation.

        Raises:
            RuntimeError: If tmux is not installed or version is insufficient
        """
        SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
        HOOKS_DIR.mkdir(parents=True, exist_ok=True)

        # Find and cache tmux path
        try:
            self._tmux_path = _find_tmux()
            logger.info(f"Using tmux at: {self._tmux_path}")
        except RuntimeError as e:
            logger.error(f"tmux not found: {e}")
            raise

        # Validate tmux version
        is_ok, message = check_tmux_version(self._tmux_path)
        if not is_ok:
            logger.error(f"tmux version check failed: {message}")
            raise RuntimeError(message)

        logger.info(message)

        # Cache claude and bun CLI paths
        self._bun_path = _find_bun_cli()
        try:
            self._claude_path = _find_claude_cli()
            logger.info(f"Using claude CLI at: {self._claude_path}")
        except RuntimeError as e:
            logger.warning(f"Claude CLI not found during init: {e}")
            self._claude_path = None

    def _is_session_dead(self, tmux_name: str) -> bool:
        """Check if a tmux session's pane is dead (zombie).

        Args:
            tmux_name: The tmux session name (e.g., "atlas-abc123")

        Returns:
            bool: True if the pane is dead, False if alive or session doesn't exist
        """
        result = subprocess.run(
            [self._tmux_path, "display", "-t", tmux_name, "-p", "#{?pane_dead,1,0}"], capture_output=True, text=True
        )
        return result.stdout.strip() == "1"

    def _capture_pane_output(self, tmux_name: str, lines: int = 50) -> str:
        """Capture output from a tmux pane.

        Args:
            tmux_name: The tmux session name
            lines: Number of lines to capture

        Returns:
            str: Captured output or empty string on failure
        """
        result = subprocess.run(
            [self._tmux_path, "capture-pane", "-t", tmux_name, "-p", "-S", f"-{lines}"], capture_output=True, text=True
        )
        return result.stdout if result.returncode == 0 else ""

    def create_session(self, session_id: str, agent_id: str = "engineer") -> dict:
        """Create a new tmux session with Claude Code.

        This method handles edge cases:
        - Reuses existing healthy sessions (idempotent)
        - Detects and kills zombie sessions before recreating
        - Detects if claude exits immediately (1.5s delay check)
        - Uses absolute path to claude CLI
        - Sets up pipe-pane for text streaming

        Args:
            session_id: Unique identifier for the session
            agent_id: Agent type for persona selection (default: 'engineer')

        Returns:
            dict: Session info with keys:
                - session_id: The session ID
                - tmux_name: The tmux session name (atlas-{session_id})
                - cwd: Working directory path
                - agent_id: The selected agent
                - reused: True if existing session was reused

        Raises:
            RuntimeError: If session creation fails
        """
        tmux_name = f"atlas-{session_id}"
        session_dir = SESSIONS_DIR / session_id

        # 1. Check for existing session
        has_session = (
            subprocess.run([self._tmux_path, "has-session", "-t", tmux_name], capture_output=True).returncode == 0
        )

        if has_session:
            # Check if pane is dead (zombie session)
            if self._is_session_dead(tmux_name):
                logger.info(f"Found zombie session {tmux_name}, killing it")
                subprocess.run([self._tmux_path, "kill-session", "-t", tmux_name])
                has_session = False
            else:
                # Session is alive - reuse it
                logger.info(f"Reusing existing session {tmux_name}")
                return {
                    "session_id": session_id,
                    "tmux_name": tmux_name,
                    "cwd": str(session_dir),
                    "agent_id": agent_id,
                    "reused": True,
                }

        # 2. Setup session directory
        session_dir.mkdir(exist_ok=True)

        # Create CLAUDE.md with agent persona (loaded from agents/ config)
        claude_md = session_dir / "CLAUDE.md"
        claude_md.write_text(build_session_prompt(agent_id, session_id))

        # Create .claude/settings.json with hooks configuration
        claude_dir = session_dir / ".claude"
        claude_dir.mkdir(exist_ok=True)

        hooks_dir_str = str(HOOKS_DIR.resolve())
        bundled_bun = settings.atlas_bundled_bun
        bun_cmd = bundled_bun if bundled_bun and Path(bundled_bun).exists() else "bun"
        agent_config = parse_agent(agent_id)
        agent_permissions = (
            agent_config.permissions
            if agent_config and agent_config.permissions
            else ["Read", "Glob", "Grep", "WebSearch", "WebFetch", "mcp__*"]
        )
        settings = {
            "hooks": {
                "PreToolUse": [
                    {
                        "matcher": "*",
                        "hooks": [{"type": "command", "command": f"{bun_cmd} {hooks_dir_str}/stream-event.ts"}],
                    }
                ],
                "PostToolUse": [
                    {
                        "matcher": "*",
                        "hooks": [{"type": "command", "command": f"{bun_cmd} {hooks_dir_str}/stream-event.ts"}],
                    }
                ],
                "Notification": [
                    {
                        "matcher": "*",
                        "hooks": [{"type": "command", "command": f"{bun_cmd} {hooks_dir_str}/stream-event.ts"}],
                    }
                ],
                "Stop": [
                    {
                        "matcher": "*",
                        "hooks": [{"type": "command", "command": f"{bun_cmd} {hooks_dir_str}/stream-event.ts"}],
                    }
                ],
                "PermissionRequest": [
                    {
                        "matcher": "*",
                        "hooks": [{"type": "command", "command": f"{bun_cmd} {hooks_dir_str}/permission-handler.ts"}],
                    }
                ],
            },
            "permissions": {"allow": agent_permissions},
        }

        (claude_dir / "settings.json").write_text(json.dumps(settings, indent=2))

        # 3. Find claude CLI path
        if self._claude_path is None:
            try:
                self._claude_path = _find_claude_cli()
            except RuntimeError as e:
                raise RuntimeError(f"Cannot create session: {e}")

        # 4. Create tmux session with explicit environment
        env = os.environ.copy()

        # Load VAULT_PATH and CODOS_PATH from .env file
        env_file = settings.get_env_file_path()
        if env_file.exists():
            with open(env_file) as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        key, value = line.split("=", 1)
                        if key in ("VAULT_PATH", "CODOS_PATH"):
                            env[key] = value
                            logger.info(f"Injected {key}={value} into session env")

        # Use --permission-mode=bypassPermissions to skip the workspace trust dialog
        # This is the approach used by vibecraft and other Claude Code wrappers
        try:
            subprocess.run(
                [
                    self._tmux_path,
                    "new-session",
                    "-d",  # Detached
                    "-s",
                    tmux_name,  # Session name
                    "-c",
                    str(session_dir),  # Working directory
                    self._claude_path,
                    "--permission-mode=bypassPermissions",  # Skip trust dialog
                    "--verbose",
                ],
                env=env,
                check=True,
                capture_output=True,
            )
        except subprocess.CalledProcessError as e:
            error_msg = e.stderr.decode() if e.stderr else str(e)
            raise RuntimeError(f"Failed to create tmux session: {error_msg}")

        # 5. Handle the bypass permissions warning prompt
        # Wait for the warning dialog to appear (needs enough time for Claude to start)
        time.sleep(1.0)

        # Navigate down to option 2 ("Yes, I accept") and press Enter
        # The dialog uses vim-style navigation (j/k), not arrow keys
        # Send j to move to option 2, then Enter to confirm
        subprocess.run([self._tmux_path, "send-keys", "-t", tmux_name, "j"], capture_output=True)
        time.sleep(0.3)
        subprocess.run([self._tmux_path, "send-keys", "-t", tmux_name, "Enter"], capture_output=True)

        logger.info(f"Accepted bypass permissions warning for session {session_id}")

        # Give Claude time to start up and clear the warning
        time.sleep(2.0)

        if self._is_session_dead(tmux_name):
            # Capture error output before killing
            error_output = self._capture_pane_output(tmux_name, 50)
            subprocess.run([self._tmux_path, "kill-session", "-t", tmux_name])

            # Clean up session directory
            logger.error(f"Claude exited immediately. Output: {error_output[:500]}")
            raise RuntimeError(
                f"Claude exited immediately after start.\n"
                f"Output: {error_output[:500] if error_output else 'No output captured'}"
            )

        # 6. Setup pipe-pane for text streaming
        # First, clear any existing pipe
        subprocess.run([self._tmux_path, "pipe-pane", "-t", tmux_name], capture_output=True)

        # Then setup the new pipe
        text_relay_path = HOOKS_DIR / "text-relay.ts"
        if text_relay_path.exists():
            bundled_bun = settings.atlas_bundled_bun
            pipe_bun = bundled_bun if bundled_bun and Path(bundled_bun).exists() else "bun"
            subprocess.run(
                [
                    self._tmux_path,
                    "pipe-pane",
                    "-t",
                    tmux_name,
                    f"ATLAS_SESSION_ID={session_id} {pipe_bun} {text_relay_path}",
                ]
            )
            logger.info(f"Setup pipe-pane for session {session_id}")
        else:
            logger.warning(f"text-relay.ts not found at {text_relay_path}")

        logger.info(f"Created session {tmux_name} with agent {agent_id}")

        return {
            "session_id": session_id,
            "tmux_name": tmux_name,
            "cwd": str(session_dir),
            "agent_id": agent_id,
            "reused": False,
        }

    def _format_conversation(self, history: list[dict], current_message: str) -> str:
        """Format conversation history with current message for Claude.

        Args:
            history: List of message dicts with 'role' and 'content' keys
            current_message: The new user message to append

        Returns:
            str: Formatted conversation string
        """
        if not history:
            return current_message

        # Build conversation history section
        history_lines = []
        for msg in history:
            role = msg.get("role", "user")
            content = msg.get("content", "")

            # Truncate long messages
            if len(content) > 2000:
                content = content[:2000] + "... [truncated]"

            role_label = "[User]" if role == "user" else "[Assistant]"
            history_lines.append(f"{role_label}: {content}")

        history_text = "\n".join(history_lines)

        return f"""<conversation_history>
{history_text}
</conversation_history>

[User]: {current_message}"""

    def send_message(self, session_id: str, message: str, history: list[dict] | None = None) -> bool:
        """Send a message to the Claude session using send-keys.

        Uses send-keys -l for literal text input, which works better with
        Claude Code's terminal input handler than paste-buffer.

        Args:
            session_id: The session ID
            message: The message text to send
            history: Optional conversation history (list of {role, content} dicts)

        Returns:
            bool: True if send succeeded, False otherwise
        """
        tmux_name = f"atlas-{session_id}"

        # Format message with conversation history if provided
        formatted_message = self._format_conversation(history, message) if history else message

        try:
            # Use send-keys with -l (literal) flag
            # This sends the text literally without interpreting special keys
            result = subprocess.run(
                [self._tmux_path, "send-keys", "-t", tmux_name, "-l", formatted_message], capture_output=True
            )

            if result.returncode != 0:
                logger.warning(f"Failed to send keys: {result.stderr}")
                return False

            # Small delay then send Enter to submit
            time.sleep(0.1)
            result = subprocess.run([self._tmux_path, "send-keys", "-t", tmux_name, "Enter"], capture_output=True)

            success = result.returncode == 0
            if not success:
                logger.warning(f"Failed to send Enter to {tmux_name}: {result.stderr}")

            return success

        except Exception as e:
            logger.error(f"Error sending message to {tmux_name}: {e}")
            return False

    def get_output(self, session_id: str, lines: int = 100) -> str:
        """Capture current pane output.

        Args:
            session_id: The session ID
            lines: Number of lines to capture (default: 100)

        Returns:
            str: Captured output or empty string on failure
        """
        tmux_name = f"atlas-{session_id}"
        return self._capture_pane_output(tmux_name, lines)

    def session_exists(self, session_id: str) -> bool:
        """Check if a session exists and is alive.

        Args:
            session_id: The session ID

        Returns:
            bool: True if session exists and is not dead
        """
        tmux_name = f"atlas-{session_id}"

        # Check if session exists
        result = subprocess.run([self._tmux_path, "has-session", "-t", tmux_name], capture_output=True)

        if result.returncode != 0:
            return False

        # Check if it's a zombie
        return not self._is_session_dead(tmux_name)

    def kill_session(self, session_id: str) -> bool:
        """Kill a session.

        Args:
            session_id: The session ID

        Returns:
            bool: True if kill succeeded or session didn't exist
        """
        tmux_name = f"atlas-{session_id}"

        result = subprocess.run([self._tmux_path, "kill-session", "-t", tmux_name], capture_output=True)

        if result.returncode == 0:
            logger.info(f"Killed session {tmux_name}")

        return result.returncode == 0

    def list_sessions(self) -> list[dict]:
        """List all atlas sessions with their status.

        Returns:
            list[dict]: List of session info dicts with keys:
                - session_id: The session ID
                - tmux_name: The tmux session name
                - alive: True if session is not dead
                - last_activity: Unix timestamp of last activity
        """
        result = subprocess.run(
            [self._tmux_path, "list-sessions", "-F", "#{session_name} #{session_activity} #{?pane_dead,dead,alive}"],
            capture_output=True,
            text=True,
        )

        sessions = []
        if result.returncode != 0:
            return sessions

        for line in result.stdout.strip().split("\n"):
            if not line or not line.startswith("atlas-"):
                continue

            parts = line.split()
            if len(parts) < 3:
                continue

            tmux_name = parts[0]
            session_id = tmux_name.replace("atlas-", "")
            last_activity = int(parts[1]) if parts[1].isdigit() else 0
            is_alive = parts[2] == "alive"

            sessions.append(
                {"session_id": session_id, "tmux_name": tmux_name, "alive": is_alive, "last_activity": last_activity}
            )

        return sessions

    def cleanup_orphaned_sessions(self, max_age_minutes: int = 120):
        """Kill sessions that have been idle or dead for too long.

        This method should be called periodically (e.g., every 15 minutes)
        to clean up abandoned sessions.

        Args:
            max_age_minutes: Kill sessions idle longer than this (default: 120 min)
        """
        sessions = self.list_sessions()
        current_time = time.time()
        cleaned = 0

        for session in sessions:
            session_id = session["session_id"]
            is_alive = session.get("alive", True)
            last_activity = session.get("last_activity", current_time)

            age_minutes = (current_time - last_activity) / 60

            should_kill = (
                not is_alive  # Dead session
                or age_minutes > max_age_minutes  # Idle too long
            )

            if should_kill:
                reason = "dead" if not is_alive else f"idle {age_minutes:.0f}min"
                logger.info(f"Cleaning up orphan session {session_id}: {reason}")
                self.kill_session(session_id)
                cleaned += 1

        if cleaned > 0:
            logger.info(f"Cleaned up {cleaned} orphaned sessions")

        return cleaned


# Singleton instance
_manager: SessionManager | None = None


def get_session_manager() -> SessionManager:
    """Get or create the session manager singleton.

    Returns:
        SessionManager: The singleton instance

    Raises:
        RuntimeError: If session manager cannot be initialized (e.g., tmux not found)
    """
    global _manager
    if _manager is None:
        _manager = SessionManager()
    return _manager
