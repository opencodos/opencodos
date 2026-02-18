#!/usr/bin/env python3
"""FastAPI server wrapping Telegram-agent for UI integration.

Architecture:
  - Server NEVER holds a persistent Telegram connection.
  - Auth endpoints use temporary clients that disconnect after auth completes.
  - Wizard endpoints (conversations, folders) connect on-demand via _ensure_connected()
    and disconnect after the wizard finishes (POST /telegram/config).
  - All syncs go through agent.py sync subprocess — same code path as the cron job.
  - An fcntl-based lock prevents the wizard and cron from overlapping on the session.
"""

import asyncio
import base64
import fcntl
import io
import os
import signal
import sys
from contextlib import asynccontextmanager
from pathlib import Path

import qrcode
from fastapi import FastAPI, HTTPException
from loguru import logger
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Writable data directory: ATLAS_DATA_DIR (set by Tauri) or ~/.codos/
_DATA_DIR = os.environ.get("ATLAS_DATA_DIR", str(Path.home() / ".codos"))

# Telegram data dir for config, session, and checkpoint files
_TELEGRAM_DATA_DIR = Path(_DATA_DIR) / "config" / "telegram"
_TELEGRAM_DATA_DIR.mkdir(parents=True, exist_ok=True)

# Source tree root (for dev-mode fallbacks only)
_SOURCE_DIR = Path(__file__).parent

from .src.config import load_config, save_selected_conversations

# Config file path — used by all load_config() calls
_CONFIG_PATH = str(_TELEGRAM_DATA_DIR / "config.yaml")
from .src.telegram_client import APP_VERSION, DEVICE_MODEL, TelegramClientWrapper

# Shared lock file — must match the path used by agent.py sync
_LOCK_PATH = Path.home() / ".codos" / ".telegram.lock"


# Global state
telegram_client: TelegramClientWrapper | None = None
_lock_fd = None
auth_state = {
    "status": "not_started",  # not_started, pending, needs_2fa, authenticated, error
    "username": None,
    "user_id": None,
    "qr_image": None,
    "message": None,
}

# Phone auth state: phone_number -> {phone_code_hash, client, timestamp}
phone_auth_state: dict[str, dict] = {}


async def _ensure_connected() -> TelegramClientWrapper:
    """Connect to Telegram on-demand for wizard endpoints.

    Acquires an flock so cron sync won't overlap while the wizard is active.
    """
    global telegram_client, _lock_fd

    if telegram_client and telegram_client._client:
        try:
            if telegram_client._client.is_connected():
                return telegram_client
        except Exception:
            pass
        # Stale/disconnected client object: drop and reconnect cleanly.
        await _disconnect_client()

    if auth_state["status"] != "authenticated":
        raise HTTPException(status_code=401, detail="Not authenticated")

    # Acquire session lock (non-blocking)
    _lock_fd = open(_LOCK_PATH, "w")
    try:
        fcntl.flock(_lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        _lock_fd.close()
        _lock_fd = None
        raise HTTPException(
            status_code=503,
            detail="Telegram session busy (sync in progress). Try again in 30s.",
        )

    config = load_config(_CONFIG_PATH, require_anthropic=False)
    telegram_client = TelegramClientWrapper(
        config.telegram.api_id,
        config.telegram.api_hash,
        config.base_path,
    )
    try:
        await telegram_client.connect()
    except Exception as e:
        # Session expired or invalid — reset auth state
        telegram_client = None
        fcntl.flock(_lock_fd, fcntl.LOCK_UN)
        _lock_fd.close()
        _lock_fd = None
        auth_state["status"] = "not_started"
        auth_state["username"] = None
        auth_state["user_id"] = None
        raise HTTPException(status_code=401, detail=f"Session expired: {e}")

    return telegram_client


async def _disconnect_client():
    """Disconnect wizard client and release the session lock."""
    global telegram_client, _lock_fd

    if telegram_client:
        try:
            await telegram_client.disconnect()
        except Exception:
            pass
        telegram_client = None

    if _lock_fd:
        try:
            fcntl.flock(_lock_fd, fcntl.LOCK_UN)
            _lock_fd.close()
        except Exception:
            pass
        _lock_fd = None


async def _spawn_sync():
    """Spawn backend telegram-agent sync as a subprocess with logging."""
    try:
        codos_root = _SOURCE_DIR.parent.parent.parent
        venv_python = codos_root / ".venv" / "bin" / "python"
        python = str(venv_python) if venv_python.exists() else sys.executable
        log_dir = _SOURCE_DIR / "logs"
        log_dir.mkdir(exist_ok=True)
        log_file = open(log_dir / "first-sync.log", "w")
        env = {**os.environ, "PYTHONPATH": str(codos_root / "src")}
        await asyncio.create_subprocess_exec(
            python, "-m", "backend", "telegram-agent", "sync",
            cwd=str(codos_root),
            env=env,
            stdout=log_file,
            stderr=log_file,
        )
    except Exception as e:
        logger.warning("Failed to spawn sync subprocess: %s", e)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Handle startup/shutdown.

    Does NOT connect to Telegram — cron handles sync, wizard connects on-demand.
    """
    config_path = Path(_CONFIG_PATH)
    if not config_path.exists():
        # Create minimal config — env vars (TELEGRAM_API_ID, etc.) override these
        config_path.parent.mkdir(parents=True, exist_ok=True)
        config_path.write_text(
            "telegram:\n  api_id: 0\n  api_hash: placeholder\n"
            "obsidian:\n  vault_path: ~/vault\n"
            "sync:\n  initial_lookback_days: 7\n"
            "conversations:\n  selected: []\n"
        )

    # Check if already authenticated by looking for session file (no Telegram connection)
    try:
        config = load_config(_CONFIG_PATH, require_anthropic=False)
        session_path = config.base_path / "session.string"
        if session_path.exists() and session_path.read_text().strip():
            auth_state["status"] = "authenticated"
    except Exception as e:
        logger.warning("Failed to load config: %s", e)

    yield

    # Cleanup
    await _disconnect_client()


app = FastAPI(title="Telegram Agent API", lifespan=lifespan)

# CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class TwoFARequest(BaseModel):
    password: str


class PhoneSendCodeRequest(BaseModel):
    phone_number: str


class PhoneVerifyCodeRequest(BaseModel):
    phone_number: str
    code: str
    phone_code_hash: str | None = None
    password: str | None = None  # For 2FA


class ConversationInfo(BaseModel):
    id: str
    name: str
    type: str


class ConfigRequest(BaseModel):
    include_conversations: list[str]
    lookback_days: int = 14
    # Optional: pass full conversation details to avoid re-fetching
    conversation_details: list[ConversationInfo] | None = None


@app.get("/telegram/auth/status")
async def get_auth_status():
    """Get current authentication status."""
    return auth_state


@app.post("/telegram/auth/initiate")
async def initiate_auth(force: bool = False):
    """Start QR code authentication flow."""
    global auth_state

    try:
        config = load_config(_CONFIG_PATH, require_anthropic=False)
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Guard against accidental session reset from repeated UI mounts.
    # Use force=true explicitly when user wants to restart auth.
    session_path = config.base_path / "session.string"
    has_session = session_path.exists() and bool(session_path.read_text().strip()) if session_path.exists() else False
    if not force:
        if auth_state["status"] == "authenticated" and has_session:
            return {
                "status": "authenticated",
                "username": auth_state["username"],
                "user_id": auth_state["user_id"],
                "qr_image": None,
                "message": "Already authenticated",
            }
        if auth_state["status"] == "pending" and auth_state["qr_image"]:
            return auth_state
        if auth_state["status"] == "needs_2fa":
            return auth_state

    # Always start fresh: disconnect existing wizard client and delete old session
    await _disconnect_client()

    if session_path.exists():
        session_path.unlink()

    auth_state["status"] = "not_started"
    auth_state["username"] = None
    auth_state["user_id"] = None
    auth_state["qr_image"] = None
    auth_state["message"] = None

    # Create fresh client for login
    from telethon import TelegramClient
    from telethon.sessions import StringSession

    client = TelegramClient(
        StringSession(),
        config.telegram.api_id,
        config.telegram.api_hash,
        device_model=DEVICE_MODEL,
        app_version=APP_VERSION,
    )

    await client.connect()

    try:
        # Get QR login token
        qr_login = await client.qr_login()

        # Generate QR code image
        qr = qrcode.QRCode(version=1, box_size=10, border=4)
        qr.add_data(qr_login.url)
        qr.make(fit=True)

        img = qr.make_image(fill_color="black", back_color="white")
        buffer = io.BytesIO()
        img.save(buffer, format="PNG")
        qr_base64 = base64.b64encode(buffer.getvalue()).decode()

        auth_state["status"] = "pending"
        auth_state["qr_image"] = qr_base64
        auth_state["message"] = "Scan QR code with Telegram app"

        # Store client and qr_login for polling
        app.state.login_client = client
        app.state.qr_login = qr_login

        # Start background task to wait for login
        asyncio.create_task(_wait_for_qr_login(client, qr_login, config))

        return {
            "status": "pending",
            "qr_image": qr_base64,
            "message": "Scan QR code with Telegram app",
        }

    except Exception as e:
        auth_state["status"] = "error"
        auth_state["message"] = str(e)
        await client.disconnect()
        raise HTTPException(status_code=500, detail=str(e))


async def _wait_for_qr_login(client, qr_login, config):
    """Background task to wait for QR login completion."""
    global auth_state

    try:
        # Wait for user to scan QR (timeout 120 seconds)
        await asyncio.wait_for(qr_login.wait(), timeout=120)

        # Save session
        session_string = client.session.save()
        session_path = config.base_path / "session.string"
        session_path.write_text(session_string)

        # Get user info
        me = await client.get_me()

        auth_state["status"] = "authenticated"
        auth_state["username"] = me.username or me.first_name
        auth_state["user_id"] = me.id
        auth_state["message"] = "Login successful"

        # Disconnect the auth client — wizard endpoints will use _ensure_connected()
        await client.disconnect()

    except TimeoutError:
        # Don't overwrite if already authenticated (race with 2FA completion)
        if auth_state["status"] not in ("authenticated", "needs_2fa"):
            auth_state["status"] = "expired"
            auth_state["message"] = "QR code expired"
        await client.disconnect()
    except Exception as e:
        if "2FA" in str(e) or "password" in str(e).lower():
            auth_state["status"] = "needs_2fa"
            auth_state["message"] = "Two-factor authentication required"
            # Keep client connected for 2FA
        else:
            auth_state["status"] = "error"
            auth_state["message"] = str(e)
            await client.disconnect()


@app.post("/telegram/auth/2fa")
async def submit_2fa(request: TwoFARequest):
    """Submit 2FA password."""
    global auth_state

    if auth_state["status"] != "needs_2fa":
        raise HTTPException(status_code=400, detail="2FA not required")

    client = getattr(app.state, "login_client", None)
    if not client:
        raise HTTPException(status_code=400, detail="No active login session")

    try:
        await client.sign_in(password=request.password)

        config = load_config(_CONFIG_PATH, require_anthropic=False)

        # Save session
        session_string = client.session.save()
        session_path = config.base_path / "session.string"
        session_path.write_text(session_string)

        # Get user info
        me = await client.get_me()

        auth_state["status"] = "authenticated"
        auth_state["username"] = me.username or me.first_name
        auth_state["user_id"] = me.id
        auth_state["message"] = "Login successful"

        # Disconnect the auth client — wizard endpoints will use _ensure_connected()
        await client.disconnect()

        return {"status": "authenticated", "username": auth_state["username"], "user_id": auth_state["user_id"]}

    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid password: {e}")


# ==================== Phone-based Authentication ====================


@app.post("/telegram/phone/send-code")
async def phone_send_code(request: PhoneSendCodeRequest):
    """Send verification code to phone number for login."""
    global phone_auth_state

    config = load_config(_CONFIG_PATH, require_anthropic=False)

    # Create fresh client for this phone login
    from telethon import TelegramClient
    from telethon.sessions import StringSession

    client = TelegramClient(
        StringSession(),
        config.telegram.api_id,
        config.telegram.api_hash,
        device_model=DEVICE_MODEL,
        app_version=APP_VERSION,
    )

    await client.connect()

    try:
        # Send the code request
        sent_code = await client.send_code_request(request.phone_number)

        # Store state for verification
        import time

        phone_auth_state[request.phone_number] = {
            "phone_code_hash": sent_code.phone_code_hash,
            "client": client,
            "timestamp": time.time(),
        }

        return {
            "success": True,
            "phone_code_hash": sent_code.phone_code_hash,
            "message": "Verification code sent to your Telegram app",
        }

    except Exception as e:
        await client.disconnect()
        raise HTTPException(status_code=400, detail=f"Failed to send code: {e}")


@app.post("/telegram/phone/verify-code")
async def phone_verify_code(request: PhoneVerifyCodeRequest):
    """Verify the code and complete phone-based login."""
    global phone_auth_state, auth_state

    # Get stored state
    state = phone_auth_state.get(request.phone_number)
    if not state:
        raise HTTPException(status_code=400, detail="No pending login for this phone. Send code first.")

    client = state["client"]
    phone_code_hash = request.phone_code_hash or state["phone_code_hash"]

    config = load_config(_CONFIG_PATH, require_anthropic=False)

    try:
        from telethon.errors import SessionPasswordNeededError

        try:
            # Try to sign in with the code
            await client.sign_in(
                phone=request.phone_number,
                code=request.code,
                phone_code_hash=phone_code_hash,
            )
        except SessionPasswordNeededError:
            # 2FA is enabled
            if request.password:
                # User provided password, try to sign in with it
                await client.sign_in(password=request.password)
            else:
                # Need password from user
                return {
                    "success": False,
                    "needs_2fa": True,
                    "message": "Two-factor authentication required. Please provide your password.",
                }

        # Success! Save the session
        session_string = client.session.save()
        session_path = config.base_path / "session.string"
        session_path.write_text(session_string)

        # Get user info
        me = await client.get_me()

        # Update global auth state
        auth_state["status"] = "authenticated"
        auth_state["username"] = me.username or me.first_name
        auth_state["user_id"] = me.id
        auth_state["message"] = "Login successful"

        # Disconnect the auth client — wizard endpoints will use _ensure_connected()
        await client.disconnect()

        # Clean up phone auth state
        del phone_auth_state[request.phone_number]

        return {
            "success": True,
            "session_created": True,
            "username": auth_state["username"],
            "user_id": auth_state["user_id"],
            "message": "Login successful",
        }

    except Exception as e:
        error_msg = str(e).lower()
        if "invalid" in error_msg and "code" in error_msg:
            raise HTTPException(status_code=401, detail="Invalid verification code")
        if "password" in error_msg:
            raise HTTPException(status_code=401, detail="Invalid 2FA password")
        raise HTTPException(status_code=400, detail=f"Login failed: {e}")


@app.get("/telegram/folders")
async def list_folders():
    """List all Telegram folders (dialog filters)."""
    client = await _ensure_connected()

    try:
        # Use fast metadata method that doesn't fetch all dialogs
        folders = await client.get_folder_metadata()
        return [{"id": f.id, "title": f.title, "count": f.count} for f in folders]
    except Exception:
        # Folders may not be supported - return empty list
        return []


@app.get("/telegram/conversations")
async def list_conversations(
    limit: int = 100,
    offset: int = 0,
    folder_id: int | None = None,
):
    """List Telegram conversations with pagination."""
    client = await _ensure_connected()

    try:
        # Fetch enough conversations for pagination (offset + limit + buffer)
        fetch_limit = offset + limit + 50  # Buffer for accurate has_more
        all_conversations = await client.get_conversations(
            limit=fetch_limit,
            folder_id=folder_id,
        )

        # Apply pagination
        total = len(all_conversations)
        paginated = all_conversations[offset : offset + limit]
        has_more = offset + limit < total

        return {
            "conversations": [
                {
                    "id": conv.id,
                    "name": conv.name,
                    "type": conv.type,
                    "unread_count": conv.unread_count,
                    "last_message_date": getattr(conv, "last_message_date", None),
                }
                for conv in paginated
            ],
            "has_more": has_more,
            "total": total,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/telegram/config")
async def get_config():
    """Get current conversation whitelist from config.yaml."""
    try:
        config = load_config(_CONFIG_PATH, require_anthropic=False)
        whitelist_ids = [str(c["id"]) for c in config.conversations.whitelist]
        return {
            "whitelist_ids": whitelist_ids,
            "lookback_days": config.sync.initial_lookback_days,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/telegram/last-sync")
async def get_last_sync():
    """Get the timestamp of the last successful sync from checkpoint.json."""
    import json

    checkpoint_path = _TELEGRAM_DATA_DIR / "checkpoint.json"

    if not checkpoint_path.exists():
        return {"last_sync": None, "last_sync_iso": None}

    try:
        with open(checkpoint_path) as f:
            data = json.load(f)

        if not data:
            return {"last_sync": None, "last_sync_iso": None}

        # Find the most recent timestamp across all conversations
        max_ts = max((v.get("latest_timestamp", 0) for v in data.values()), default=0)

        if max_ts == 0:
            return {"last_sync": None, "last_sync_iso": None}

        from datetime import datetime

        dt = datetime.fromtimestamp(max_ts)
        return {
            "last_sync": max_ts,
            "last_sync_iso": dt.isoformat(),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/telegram/disconnect")
async def disconnect():
    """Disconnect from Telegram - log out and clear session."""
    global auth_state

    try:
        # If wizard client is connected, use it to revoke the session server-side
        if telegram_client and telegram_client._client:
            try:
                await telegram_client._client.log_out()
            except Exception:
                pass  # May fail if already disconnected

        await _disconnect_client()

        # Delete session file
        config = load_config(_CONFIG_PATH, require_anthropic=False)
        session_path = config.base_path / "session.string"
        if session_path.exists():
            session_path.unlink()

        # Also delete any .session files
        for session_file in config.base_path.glob("*.session"):
            session_file.unlink()

        # Reset auth state
        auth_state["status"] = "not_started"
        auth_state["username"] = None
        auth_state["user_id"] = None
        auth_state["qr_image"] = None
        auth_state["message"] = None

        return {"success": True, "message": "Disconnected from Telegram"}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to disconnect: {e}")


@app.post("/telegram/config")
async def save_config(request: ConfigRequest):
    """Save conversation selection to config.yaml."""
    if auth_state["status"] != "authenticated":
        raise HTTPException(status_code=401, detail="Not authenticated")

    try:
        # Use passed conversation details if available (fast path)
        if request.conversation_details:
            selected = [{"id": int(c.id), "name": c.name, "type": c.type} for c in request.conversation_details]
        else:
            # Fallback: fetch from Telegram (slow)
            client = await _ensure_connected()
            conversations = await client.get_conversations()
            conv_map = {str(c.id): c for c in conversations}

            selected = []
            for conv_id in request.include_conversations:
                if conv_id in conv_map:
                    c = conv_map[conv_id]
                    selected.append(
                        {
                            "id": c.id,
                            "name": c.name,
                            "type": c.type,
                        }
                    )

        # Save to config.yaml
        save_selected_conversations(_CONFIG_PATH, selected)

        # Wizard is done — disconnect and release lock so cron can resume.
        # Do NOT spawn sync here — it would grab the lock and block the UI
        # if it navigates back to conversation listing. Cron handles sync.
        await _disconnect_client()

        return {"success": True, "saved_count": len(selected)}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class SendMessageRequest(BaseModel):
    chat_id: int
    message: str


@app.post("/telegram/send")
async def send_message(request: SendMessageRequest):
    """Send a message to a Telegram chat."""
    client = await _ensure_connected()
    try:
        await client.send_message(request.chat_id, request.message)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to send message: {e}")
    finally:
        await _disconnect_client()


@app.post("/telegram/sync")
async def run_sync():
    """Trigger a sync by spawning agent.py sync as a subprocess.

    This avoids session conflicts — server never holds a Telegram connection
    for sync. Same code path as the cron job.
    """
    if auth_state["status"] != "authenticated":
        raise HTTPException(status_code=401, detail="Not authenticated")

    # Disconnect wizard client if active — sync needs the session lock
    await _disconnect_client()

    try:
        codos_root = _SOURCE_DIR.parent.parent.parent
        venv_python = codos_root / ".venv" / "bin" / "python"
        python = str(venv_python) if venv_python.exists() else sys.executable
        env = {**os.environ, "PYTHONPATH": str(codos_root / "src")}
        proc = await asyncio.create_subprocess_exec(
            python, "-m", "backend", "telegram-agent", "sync",
            cwd=str(codos_root),
            env=env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=300)

        if proc.returncode == 0:
            return {"success": True, "message": "Sync completed"}
        else:
            error = stderr.decode().strip() if stderr else "Unknown error"
            return {"success": False, "message": f"Sync failed: {error}"}

    except asyncio.TimeoutError:
        proc.kill()
        return {"success": False, "message": "Sync timed out (5 min)"}
    except Exception as e:
        return {"success": False, "message": f"Failed to run sync: {e}"}


def _read_lock_pid() -> int | None:
    """Read the PID from the lock file, or None if missing/invalid."""
    try:
        with open(_LOCK_PATH, "r") as f:
            return int(f.read().strip())
    except (FileNotFoundError, ValueError, OSError):
        return None


def _is_process_alive(pid: int) -> bool:
    """Check if a process is still running."""
    try:
        os.kill(pid, 0)
        return True
    except (ProcessLookupError, PermissionError):
        return False


def _is_sync_running() -> bool:
    """Check if a sync subprocess holds the lock."""
    fd = None
    try:
        fd = open(_LOCK_PATH, "w")
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        # Lock acquired — nobody is holding it
        fcntl.flock(fd, fcntl.LOCK_UN)
        return False
    except BlockingIOError:
        return True
    except FileNotFoundError:
        return False
    finally:
        if fd:
            fd.close()


@app.get("/telegram/sync/status")
async def get_sync_status():
    """Check whether a Telegram sync subprocess is currently running."""
    running = _is_sync_running()
    pid = _read_lock_pid() if running else None
    alive = _is_process_alive(pid) if pid else False

    return {
        "running": running and alive,
        "pid": pid if alive else None,
    }


@app.post("/telegram/sync/cancel")
async def cancel_sync():
    """Kill a running sync subprocess so the wizard can use the session."""
    pid = _read_lock_pid()
    if pid is None:
        return {"success": False, "message": "No sync PID found in lock file"}

    if not _is_process_alive(pid):
        return {"success": False, "message": "Sync process already exited"}

    try:
        os.kill(pid, signal.SIGTERM)
        # Wait briefly for process to exit and release flock
        for _ in range(10):
            await asyncio.sleep(0.1)
            if not _is_process_alive(pid):
                return {"success": True, "message": "Sync cancelled"}
        # Still alive after 1s — force kill
        os.kill(pid, signal.SIGKILL)
        await asyncio.sleep(0.1)
        return {"success": True, "message": "Sync force-killed"}
    except ProcessLookupError:
        return {"success": True, "message": "Sync already exited"}
    except PermissionError:
        return {"success": False, "message": "Permission denied killing sync process"}


if __name__ == "__main__":
    import uvicorn

    from backend.lib.log import configure_logging

    configure_logging("telegram-agent")

    bind_host = os.getenv("TELEGRAM_AGENT_HOST", "127.0.0.1")
    bind_port = int(os.getenv("TELEGRAM_AGENT_PORT", "8768"))
    uvicorn.run(app, host=bind_host, port=bind_port, log_config=None)
