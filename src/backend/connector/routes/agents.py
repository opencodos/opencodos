"""
Agent chat routes for the Agent Dashboard.
Handles chat sessions, messages, and SSE streaming responses.
"""

from typing import Literal

from ..auth import require_api_key
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from ..services.claude_service import get_claude_service
from ..services.session_storage import (
    create_session,
    get_messages,
    get_sessions,
    save_message,
    update_session_title,
)

router = APIRouter(
    prefix="/api/chat",
    tags=["agents"],
    dependencies=[Depends(require_api_key)],
)


# ==================== Pydantic Models ====================


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str
    timestamp: str
    agent_id: str | None = None
    tool_calls: list[dict] | None = None


class ChatRequest(BaseModel):
    session_id: str
    message: str
    agent_id: str = "engineer"


class ChatSession(BaseModel):
    id: str
    title: str
    agent_id: str
    created_at: str
    message_count: int = 0


class SessionsResponse(BaseModel):
    sessions: list[ChatSession]


class MessagesResponse(BaseModel):
    messages: list[ChatMessage]


class CreateSessionRequest(BaseModel):
    title: str | None = None
    agent_id: str = "engineer"


class CreateSessionResponse(BaseModel):
    session: ChatSession


# ==================== Helper Functions ====================


import json


async def _stream_generator(session_id: str, user_message: str, agent_id: str):
    """
    Generator for SSE streaming.
    Yields SSE-formatted events for tokens, tool calls, and completion.
    """
    try:
        # Save user message
        save_message(
            session_id=session_id,
            role="user",
            content=user_message,
        )

        # Get conversation history
        messages = get_messages(session_id)

        # Convert to Claude API format
        claude_messages = [{"role": msg["role"], "content": msg["content"]} for msg in messages]

        # Get Claude service and stream response
        claude_service = get_claude_service()

        assistant_response = []
        tool_calls_made = []

        async for event in claude_service.stream_chat(
            messages=claude_messages,
            agent_id=agent_id,
        ):
            event_type = event.get("type")

            if event_type == "token":
                content = event.get("content", "")
                assistant_response.append(content)
                # Yield SSE token event (properly escaped JSON)
                yield f"data: {json.dumps({'type': 'token', 'content': content})}\n\n"

            elif event_type == "tool_input":
                # Yield partial tool input streaming
                partial = event.get("partial", "")
                yield f"data: {json.dumps({'type': 'tool_input', 'partial': partial})}\n\n"

            elif event_type == "tool_call":
                # Yield SSE tool call event
                tool_name = event.get("name", "unknown")
                tool_id = event.get("id", "")
                tool_input = event.get("input", {})
                tool_calls_made.append(
                    {
                        "id": tool_id,
                        "name": tool_name,
                        "input": tool_input,
                    }
                )
                yield f"data: {json.dumps({'type': 'tool_call', 'name': tool_name, 'id': tool_id, 'input': tool_input})}\n\n"

            elif event_type == "complete":
                # Save assistant response
                full_response = "".join(assistant_response)
                save_message(
                    session_id=session_id,
                    role="assistant",
                    content=full_response,
                    agent_id=agent_id,
                    tool_calls=tool_calls_made if tool_calls_made else None,
                )

                # Update session title from first message if needed
                if len(messages) <= 1:  # First exchange
                    # Generate title from user message (first 50 chars)
                    title = user_message[:50]
                    if len(user_message) > 50:
                        title += "..."
                    update_session_title(session_id, title)

                # Yield SSE complete event
                yield f"data: {json.dumps({'type': 'complete'})}\n\n"

            elif event_type == "error":
                error_msg = event.get("error", "Unknown error")
                yield f"data: {json.dumps({'type': 'error', 'error': error_msg})}\n\n"

    except Exception as e:
        yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"


# ==================== Route Handlers ====================


@router.post("/send")
async def send_message(request: ChatRequest):
    """
    Send a message and return SSE stream of response.

    SSE Events:
    - {"type": "token", "content": "..."}
    - {"type": "tool_call", "name": "...", "id": "..."}
    - {"type": "complete"}
    - {"type": "error", "error": "..."}
    """
    return StreamingResponse(
        _stream_generator(request.session_id, request.message, request.agent_id),
        media_type="text/event-stream",
    )


@router.get("/sessions", response_model=SessionsResponse)
async def list_sessions():
    """List all chat sessions."""
    sessions_data = get_sessions()

    # Convert to response format and add message count
    sessions = []
    for session in sessions_data:
        messages = get_messages(session["id"])
        sessions.append(
            ChatSession(
                id=session["id"],
                title=session["title"],
                agent_id=session.get("agent_id", "engineer"),
                created_at=session["created_at"],
                message_count=len(messages),
            )
        )

    return SessionsResponse(sessions=sessions)


@router.post("/sessions", response_model=CreateSessionResponse)
async def create_new_session(request: CreateSessionRequest):
    """Create a new chat session."""
    title = request.title or "New Chat"
    session_data = create_session(title=title, agent_id=request.agent_id)

    session = ChatSession(
        id=session_data["id"],
        title=session_data["title"],
        agent_id=session_data.get("agent_id", "engineer"),
        created_at=session_data["created_at"],
        message_count=0,
    )

    return CreateSessionResponse(session=session)


@router.get("/sessions/{session_id}/messages", response_model=MessagesResponse)
async def get_session_messages(session_id: str):
    """Get all messages for a session."""
    messages_data = get_messages(session_id)

    messages = [
        ChatMessage(
            role=msg["role"],
            content=msg["content"],
            timestamp=msg["created_at"],
            agent_id=msg.get("agent_id"),
            tool_calls=msg.get("tool_calls"),
        )
        for msg in messages_data
    ]

    return MessagesResponse(messages=messages)
