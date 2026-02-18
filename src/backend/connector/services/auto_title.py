"""Auto-generate session titles using Claude Code CLI (Haiku)."""

import asyncio
import os

from loguru import logger
from .session_storage import get_messages, get_session, update_session_title

# Track sessions already being titled to avoid duplicate calls
_titling_in_progress: set[str] = set()


async def generate_title(first_prompt: str) -> str | None:
    """Call claude -p --model haiku to generate a 3-5 word session title."""
    prompt = (
        "Generate a concise 3-5 word title for this chat session. "
        "Return ONLY the title, no quotes, no punctuation at the end, no explanation.\n\n"
        f"First message: {first_prompt[:500]}"
    )

    env = {**os.environ}
    env.pop("ANTHROPIC_API_KEY", None)  # Force CC subscription

    try:
        proc = await asyncio.create_subprocess_exec(
            "claude",
            "-p",
            prompt,
            "--model",
            "haiku",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=15)

        if proc.returncode != 0:
            logger.warning(f"[auto_title] claude CLI failed ({proc.returncode}): {stderr.decode()[:200]}")
            return None

        title = stdout.decode().strip()
        if not title or len(title) > 80:
            return None
        return title

    except TimeoutError:
        logger.warning("[auto_title] claude CLI timed out")
        return None
    except Exception as e:
        logger.warning(f"[auto_title] Error: {e}")
        return None


async def auto_title_session(session_id: str, websocket=None) -> None:
    """Check if session needs a title, generate one, update DB, notify frontend."""
    if session_id in _titling_in_progress:
        return
    _titling_in_progress.add(session_id)

    try:
        session = get_session(session_id)
        if not session or session["title"] != "New Chat":
            return

        messages = get_messages(session_id)
        user_messages = [m for m in messages if m["role"] == "user"]
        if not user_messages:
            return

        first_prompt = user_messages[0]["content"]
        if not first_prompt or not first_prompt.strip():
            return

        title = await generate_title(first_prompt)
        if not title:
            return

        update_session_title(session_id, title)
        logger.info(f"[auto_title] Named session {session_id[:8]}: {title}")

        # Notify frontend via WebSocket
        if websocket:
            try:
                await websocket.send_json(
                    {
                        "type": "title_update",
                        "session_id": session_id,
                        "title": title,
                    }
                )
            except Exception:
                pass  # WebSocket may be closed

    except Exception as e:
        logger.warning(f"[auto_title] Error for {session_id[:8]}: {e}")
    finally:
        _titling_in_progress.discard(session_id)
