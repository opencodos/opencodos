"""REST endpoints for Telegram Inbox — reads directly from Vault markdown files."""

from __future__ import annotations

import json
import os
import re
from pathlib import Path

import httpx
import yaml
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..auth import require_api_key
from ..settings import settings

router = APIRouter(
    prefix="/api/inbox",
    tags=["inbox"],
    dependencies=[Depends(require_api_key)],
)

TELEGRAM_SUBDIR = "1 - Inbox (Last 7 days)/Telegram"


def _vault_telegram_dir() -> Path:
    return settings.get_vault_path() / TELEGRAM_SUBDIR


def _parse_frontmatter(text: str) -> dict:
    """Extract YAML frontmatter from markdown text."""
    if not text.startswith("---"):
        return {}
    end = text.find("---", 3)
    if end == -1:
        return {}
    try:
        return yaml.safe_load(text[3:end]) or {}
    except yaml.YAMLError:
        return {}


def _extract_heading(text: str) -> str | None:
    """Extract the first # heading from markdown (after frontmatter)."""
    for line in text.split("\n"):
        line = line.strip()
        if line.startswith("# ") and not line.startswith("##"):
            return line[2:].strip()
    return None


def _extract_last_message(text: str) -> str:
    """Get most recent message text as a preview snippet (files are newest-first)."""
    matches = list(re.finditer(r"^### \d{2}:\d{2} - .+$", text, re.MULTILINE))
    if not matches:
        return ""
    first_match = matches[0]
    rest = text[first_match.end():].strip()
    # Take first non-empty line of the message body (skip date headers)
    for line in rest.split("\n"):
        line = line.strip()
        if line and not line.startswith("## 20"):
            return line[:120]
    return ""


_MY_PATTERNS = tuple(
    p.strip().lower()
    for p in os.getenv("OWNER_PATTERNS", "").split(",")
    if p.strip()
)


def _extract_last_sender(text: str) -> str:
    """Extract the sender of the most recent message (files are newest-first)."""
    matches = list(re.finditer(r"^### \d{2}:\d{2} - (.+)$", text, re.MULTILINE))
    if not matches:
        return ""
    return matches[0].group(1).strip()


def _needs_reply(last_sender: str) -> bool:
    """True if the last message is from someone else (not me)."""
    if not last_sender:
        return False
    lower = last_sender.lower()
    return not any(p in lower for p in _MY_PATTERNS)


def _count_messages(text: str) -> int:
    """Count message blocks (### HH:MM - Sender)."""
    return len(re.findall(r"^### \d{2}:\d{2} - ", text, re.MULTILINE))


def _parse_messages(text: str) -> list[dict]:
    """Parse all messages from markdown into structured data."""
    messages = []
    current_date = ""

    lines = text.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i]

        # Date header: ## YYYY-MM-DD
        date_match = re.match(r"^## (\d{4}-\d{2}-\d{2})", line)
        if date_match:
            current_date = date_match.group(1)
            i += 1
            continue

        # Message header: ### HH:MM - Sender
        msg_match = re.match(r"^### (\d{2}:\d{2}) - (.+)$", line)
        if msg_match:
            time = msg_match.group(1)
            sender = msg_match.group(2).strip()

            # Collect message body (all lines until next heading or end)
            body_lines = []
            i += 1
            while i < len(lines):
                if lines[i].startswith("## ") or lines[i].startswith("### "):
                    break
                body_lines.append(lines[i])
                i += 1

            body = "\n".join(body_lines).strip()
            sender_lower = sender.lower()
            messages.append({
                "time": time,
                "sender": sender,
                "text": body,
                "date": current_date,
                "is_me": any(p in sender_lower for p in _MY_PATTERNS) if _MY_PATTERNS else False,
            })
            continue

        i += 1

    return messages


@router.get("/suggestions")
async def get_suggestions():
    """Return AI-generated inbox suggestions from .inbox-suggestions.json."""
    tg_dir = _vault_telegram_dir()
    suggestions_file = tg_dir / ".inbox-suggestions.json"
    if not suggestions_file.exists():
        return {"suggestions": [], "generated": None}
    try:
        return json.loads(suggestions_file.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, Exception):
        return {"suggestions": [], "generated": None}


@router.get("/conversations")
async def list_conversations():
    """List all Telegram conversations from Vault markdown files."""
    tg_dir = _vault_telegram_dir()
    if not tg_dir.exists():
        return {"conversations": [], "total": 0}

    conversations = []
    for md_file in sorted(tg_dir.glob("*.md")):
        # Skip directories (like Daily Summary/)
        if not md_file.is_file():
            continue

        try:
            text = md_file.read_text(encoding="utf-8")
        except Exception:
            continue

        fm = _parse_frontmatter(text)
        chat_name = _extract_heading(text) or md_file.stem
        preview = _extract_last_message(text)
        message_count = _count_messages(text)
        last_sender = _extract_last_sender(text)

        conversations.append({
            "filename": md_file.name,
            "chat_name": chat_name,
            "type": fm.get("type", "private"),
            "last_synced": fm.get("last_synced", ""),
            "last_message_id": fm.get("last_message_id", 0),
            "matched_contact_name": fm.get("matched_contact_name"),
            "telegram_id": fm.get("telegram_id"),
            "message_count": message_count,
            "preview": preview,
            "last_sender": last_sender,
            "needs_reply": _needs_reply(last_sender),
            "unread_count": fm.get("unread_count", 0),
        })

    # Sort by last_synced descending
    conversations.sort(key=lambda c: c["last_synced"] or "", reverse=True)

    return {"conversations": conversations, "total": len(conversations)}


@router.get("/conversations/{filename}/messages")
async def get_conversation_messages(filename: str, since_id: int | None = None):
    """Get parsed messages from a specific Vault markdown file."""
    tg_dir = _vault_telegram_dir()
    md_file = tg_dir / filename

    if not md_file.exists() or not md_file.is_file():
        raise HTTPException(status_code=404, detail=f"Conversation file not found: {filename}")

    # Prevent path traversal
    if md_file.resolve().parent != tg_dir.resolve():
        raise HTTPException(status_code=400, detail="Invalid filename")

    try:
        text = md_file.read_text(encoding="utf-8")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read file: {e}")

    fm = _parse_frontmatter(text)
    messages = _parse_messages(text)

    return {
        "messages": messages,
        "filename": filename,
        "chat_name": _extract_heading(text) or md_file.stem,
        "type": fm.get("type", "private"),
        "last_message_id": fm.get("last_message_id", 0),
    }


class SendMessageRequest(BaseModel):
    chat_id: int
    message: str
    reply_to_message_id: int | None = None


@router.post("/send")
async def send_telegram_message(request: SendMessageRequest):
    """Send a message to a Telegram chat via the telegram-agent server."""
    telegram_url = settings.telegram_agent_url
    payload: dict = {"chat_id": request.chat_id, "message": request.message}
    if request.reply_to_message_id is not None:
        payload["reply_to_message_id"] = request.reply_to_message_id
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{telegram_url}/telegram/send",
                json=payload,
            )
            if resp.status_code != 200:
                detail = resp.json().get("detail", resp.text) if resp.headers.get("content-type", "").startswith("application/json") else resp.text
                raise HTTPException(status_code=resp.status_code, detail=detail)
            return resp.json()
    except httpx.ConnectError:
        raise HTTPException(status_code=503, detail="Telegram agent not reachable")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
