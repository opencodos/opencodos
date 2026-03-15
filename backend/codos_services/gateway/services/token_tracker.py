"""Token tracking service for Claude Code sessions.

Polls tmux output to extract token usage from Claude CLI status bar.
Claude displays tokens as: ↓ 879 tokens, ↓ 1,234 tokens, ↓ 12.5k tokens
"""

import asyncio
import re
import subprocess
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

from loguru import logger

# Token parsing patterns (Claude CLI format)
# Claude CLI shows tokens in status bar as: "37720 tokens" or "↓ 879 tokens"
TOKEN_PATTERNS = [
    (re.compile(r"↓\s*([0-9,]+)\s*tokens?", re.IGNORECASE), 1),  # ↓ 879 tokens
    (re.compile(r"↓\s*([0-9.]+)k\s*tokens?", re.IGNORECASE), 1000),  # ↓ 12.5k tokens
    (re.compile(r"\s([0-9,]+)\s*tokens\s*$", re.MULTILINE), 1),  # 37720 tokens (end of line)
    (re.compile(r"\s([0-9.]+)k\s*tokens\s*$", re.MULTILINE), 1000),  # 12.5k tokens (end of line)
]


@dataclass
class TokenState:
    """Tracks token state for a session."""

    session_id: str
    tokens: int = 0
    last_updated: float = field(default_factory=time.time)


# Global token states
_token_states: dict[str, TokenState] = {}


def parse_tokens(output: str) -> int | None:
    """Parse token count from tmux pane output.

    Args:
        output: Raw tmux capture-pane output

    Returns:
        Token count as int, or None if not found
    """
    max_tokens = None

    for pattern, multiplier in TOKEN_PATTERNS:
        matches = pattern.findall(output)
        if not matches:
            continue

        # Process each match
        for match in matches:
            try:
                # Handle comma-separated numbers (1,234 -> 1234)
                clean_val = match.replace(",", "")

                # Apply multiplier (1 for normal, 1000 for "k" suffix patterns)
                tokens = int(float(clean_val) * multiplier)

                # Keep the maximum value found
                if max_tokens is None or tokens > max_tokens:
                    max_tokens = tokens

            except (ValueError, TypeError):
                continue

    return max_tokens


def capture_pane(session_id: str, lines: int = 50) -> str | None:
    """Capture tmux pane output for token parsing.

    Args:
        session_id: The Atlas session ID
        lines: Number of lines to capture from bottom

    Returns:
        Captured output or None on failure
    """
    tmux_name = f"atlas-{session_id}"

    try:
        result = subprocess.run(
            ["tmux", "capture-pane", "-t", tmux_name, "-p", "-S", f"-{lines}"],
            capture_output=True,
            text=True,
            timeout=5,
        )

        if result.returncode != 0:
            return None

        return result.stdout

    except (subprocess.TimeoutExpired, FileNotFoundError):
        return None


def poll_tokens(session_id: str) -> int | None:
    """Poll token count for a session.

    Args:
        session_id: The Atlas session ID

    Returns:
        Current token count or None if unavailable
    """
    output = capture_pane(session_id)
    if output is None:
        return None

    return parse_tokens(output)


def get_token_state(session_id: str) -> TokenState | None:
    """Get current token state for a session."""
    return _token_states.get(session_id)


def update_token_state(session_id: str, tokens: int) -> bool:
    """Update token state if tokens increased (monotonic).

    Args:
        session_id: The session ID
        tokens: New token count

    Returns:
        True if state was updated, False if tokens didn't increase
    """
    current = _token_states.get(session_id)

    if current is None or tokens > current.tokens:
        _token_states[session_id] = TokenState(session_id=session_id, tokens=tokens, last_updated=time.time())
        return True

    return False


def clear_token_state(session_id: str):
    """Clear token state for a session (on disconnect/cleanup)."""
    _token_states.pop(session_id, None)


async def token_polling_loop(session_id: str, broadcast: Callable[[dict], Awaitable[None]], interval: float = 2.0):
    """Background task to poll tokens and broadcast updates.

    Args:
        session_id: The session to poll
        broadcast: Async function to send WebSocket messages
        interval: Polling interval in seconds (default 2.0)
    """
    logger.info(f"Starting token polling for session {session_id}")

    try:
        while True:
            await asyncio.sleep(interval)

            # Poll tokens from tmux
            tokens = poll_tokens(session_id)

            if tokens is None:
                continue

            # Only broadcast if tokens increased
            if update_token_state(session_id, tokens):
                try:
                    await broadcast({"type": "token_update", "tokens": tokens, "timestamp": time.time()})
                    logger.debug(f"Token update for {session_id}: {tokens}")
                except Exception as e:
                    logger.warning(f"Failed to broadcast token update: {e}")

    except asyncio.CancelledError:
        logger.info(f"Token polling cancelled for session {session_id}")
        clear_token_state(session_id)
        raise
    except Exception as e:
        logger.error(f"Token polling error for {session_id}: {e}")
        clear_token_state(session_id)
