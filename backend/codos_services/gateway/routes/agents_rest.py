"""
REST endpoints for agent session management.
Provides CRUD operations for sessions.

Sessions are always "active" (subprocess spawns on demand per message).
"""

from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel

from ..auth import require_api_key
from ..services.attachments import save_session_attachment
from ..services.session_storage import (
    create_session as db_create_session,
)
from ..services.session_storage import (
    get_messages,
    get_session,
    get_sessions,
    update_session_title,
)
from ..services.stream_manager import get_stream_manager

router = APIRouter(
    prefix="/api/agents",
    tags=["agents-rest"],
    dependencies=[Depends(require_api_key)],
)


# ==================== Pydantic Models ====================


class CreateSessionRequest(BaseModel):
    title: str = "New Chat"
    agent_id: str = "engineer"


class ActivateSessionRequest(BaseModel):
    agent_id: str = "engineer"


class SessionResponse(BaseModel):
    id: str
    title: str
    agent_id: str
    created_at: str
    updated_at: str
    active: bool
    message_count: int = 0


class SessionDetailResponse(BaseModel):
    session_id: str
    title: str
    agent_id: str
    active: bool
    messages: list[dict]


class SessionListResponse(BaseModel):
    sessions: list[SessionResponse]


class AttachmentResponse(BaseModel):
    attachment_id: str
    name: str
    path: str
    mime: str
    size: int


# ==================== Route Handlers ====================


@router.get("/sessions", response_model=SessionListResponse)
async def list_sessions():
    """List all chat sessions. All sessions are active (subprocess on demand)."""
    db_sessions = get_sessions()

    sessions = []
    for session in db_sessions:
        session_id = session["id"]
        messages = get_messages(session_id)
        sessions.append(
            SessionResponse(
                id=session_id,
                title=session["title"],
                agent_id=session.get("agent_id", "engineer"),
                created_at=session["created_at"],
                updated_at=session.get("updated_at", session["created_at"]),
                active=True,
                message_count=len(messages),
            )
        )

    return SessionListResponse(sessions=sessions)


@router.post("/sessions", response_model=SessionResponse)
async def create_new_session(request: CreateSessionRequest):
    """Create a new chat session in DB. Subprocess spawns on first message."""
    session_data = db_create_session(title=request.title, agent_id=request.agent_id)
    session_id = session_data["id"]

    return SessionResponse(
        id=session_id,
        title=session_data["title"],
        agent_id=session_data.get("agent_id", request.agent_id),
        created_at=session_data["created_at"],
        updated_at=session_data.get("updated_at", session_data["created_at"]),
        active=True,
        message_count=0,
    )


@router.get("/sessions/{session_id}", response_model=SessionDetailResponse)
async def get_session_detail(session_id: str):
    """
    Get session details and messages.
    """
    # Get session from database
    session_data = get_session(session_id)
    if not session_data:
        raise HTTPException(status_code=404, detail="Session not found")

    # Get messages
    messages = get_messages(session_id)

    return SessionDetailResponse(
        session_id=session_id,
        title=session_data["title"],
        agent_id=session_data.get("agent_id", "engineer"),
        active=True,
        messages=messages,
    )


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str):
    """Delete a session. Cleans up session state; DB record remains for history."""
    stream_mgr = get_stream_manager()
    stream_mgr.kill_session(session_id)

    return {
        "ok": True,
        "killed": True,
        "session_id": session_id,
    }


@router.post("/sessions/{session_id}/activate")
async def activate_session(session_id: str, request: ActivateSessionRequest):
    """Activate/resume an existing session. Verifies DB record exists."""
    session_data = get_session(session_id)
    if not session_data:
        raise HTTPException(status_code=404, detail="Session not found in database. Create a new session instead.")

    return {
        "ok": True,
        "active": True,
        "session_id": session_id,
    }


@router.post("/sessions/{session_id}/title")
async def update_title(session_id: str, title: str):
    """
    Update session title.
    """
    session_data = get_session(session_id)
    if not session_data:
        raise HTTPException(status_code=404, detail="Session not found")

    update_session_title(session_id, title)

    return {
        "ok": True,
        "session_id": session_id,
        "title": title,
    }


@router.get("/status")
async def get_agent_statuses():
    """Return which agents are actively processing (have a running subprocess)."""
    from ..services.stream_manager import get_stream_manager

    stream_mgr = get_stream_manager()
    running_agents: set[str] = set()

    for session_id, process in stream_mgr._running_processes.items():
        if process.returncode is None:  # subprocess still alive
            session_data = get_session(session_id)
            if session_data:
                agent_id = session_data.get("agent_id", "engineer")
                running_agents.add(agent_id)

    return {"running": list(running_agents)}


@router.post("/sessions/{session_id}/attachments", response_model=AttachmentResponse)
async def upload_session_attachment(session_id: str, file: Annotated[UploadFile, File(...)]):
    """
    Upload a session attachment.
    Files are stored in ~/.codos/sessions/<session_id>/attachments/.
    """
    session_data = get_session(session_id)
    if not session_data:
        raise HTTPException(status_code=404, detail="Session not found")

    attachment = await save_session_attachment(session_id, file)
    return AttachmentResponse(**attachment)
