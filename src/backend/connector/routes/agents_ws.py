"""
WebSocket routes for Agent Dashboard.
Handles real-time communication between Claude Code and the UI.

Uses subprocess with --output-format stream-json for clean JSON streaming.
"""

import asyncio
import json
import re
import time
from typing import Any

from ..auth import require_api_key, validate_websocket_api_key
from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from loguru import logger
from pydantic import BaseModel

from ..services.agent_loader import append_memory
from ..services.attachments import build_prompt_with_attachments
from ..services.auto_title import auto_title_session
from ..services.event_translator import (
    get_accumulated_text,
    get_session_tool_calls,
    reset_session_state,
    translate_event,
)
from ..services.session_storage import (
    ensure_session,
    get_session,
    save_message,
)
from ..services.stream_manager import get_stream_manager

router = APIRouter(tags=["agents-ws"])

# Active WebSocket connections: session_id -> WebSocket
active_connections: dict[str, WebSocket] = {}

# Pending permission requests: tool_use_id -> asyncio.Event
pending_permissions: dict[str, asyncio.Event] = {}

# Permission responses: tool_use_id -> {approved: bool, reason: str}
permission_responses: dict[str, dict] = {}

# Accumulated assistant content per session
assistant_content: dict[str, str] = {}
# Accumulated tool calls per session
session_tool_calls: dict[str, list] = {}

# Background stream consumers: session_id -> asyncio.Task
# When WebSocket disconnects mid-stream, these keep reading subprocess stdout
background_consumers: dict[str, asyncio.Task] = {}

# Dashboard WebSocket connections (multiple dashboards can connect)
dashboard_connections: dict[int, WebSocket] = {}  # id(ws) -> WebSocket
_dashboard_id_counter = 0

# Per-session tracking for dashboard state snapshots
# session_id -> {agent_id, status, tool_call_count, current_tool, text_preview, input_tokens, output_tokens, started_at, recent_tool_calls}
dashboard_session_state: dict[str, dict] = {}


def _build_agent_state_snapshot() -> list:
    """Build a snapshot of all agents and their sessions for the dashboard."""
    # Group sessions by agent_id
    agents: dict[str, list] = {}
    for session_id, state in dashboard_session_state.items():
        agent_id = state.get("agent_id", "engineer")
        if agent_id not in agents:
            agents[agent_id] = []
        agents[agent_id].append(
            {
                "session_id": session_id,
                "title": state.get("title", ""),
                "status": state.get("status", "idle"),
                "tool_call_count": state.get("tool_call_count", 0),
                "current_tool": state.get("current_tool"),
                "text_preview": state.get("text_preview", ""),
                "input_tokens": state.get("input_tokens", 0),
                "output_tokens": state.get("output_tokens", 0),
                "started_at": state.get("started_at"),
                "recent_tool_calls": state.get("recent_tool_calls", []),
            }
        )

    result = []
    for agent_id, sessions in agents.items():
        has_running = any(s["status"] == "running" for s in sessions)
        has_error = any(s["status"] == "error" for s in sessions)
        all_completed = len(sessions) > 0 and all(s["status"] == "completed" for s in sessions)
        if has_running:
            agent_status = "running"
        elif has_error:
            agent_status = "error"
        elif all_completed:
            agent_status = "completed"
        else:
            agent_status = "idle"
        result.append(
            {
                "agent_id": agent_id,
                "status": agent_status,
                "sessions": sessions,
            }
        )
    return result


async def _broadcast_to_dashboards(message: dict) -> None:
    """Send a message to all connected dashboard WebSockets."""
    dead = []
    for ws_id, ws in dashboard_connections.items():
        try:
            await ws.send_json(message)
        except Exception as e:
            logger.warning(f"Dashboard broadcast failed for ws {ws_id}: {e}")
            dead.append(ws_id)
    for ws_id in dead:
        dashboard_connections.pop(ws_id, None)


async def _background_consume(session_id: str, process) -> None:
    """Continue consuming subprocess output after WebSocket disconnects.

    Reads remaining stdout, accumulates text via translate_event,
    and saves the full assistant response to DB when done.
    """
    try:
        async for line in process.stdout:
            line_str = line.decode("utf-8").strip()
            if not line_str:
                continue
            try:
                event = json.loads(line_str)
                translate_event(session_id, event)
                if event.get("type") == "result":
                    break
            except json.JSONDecodeError:
                continue

        # Save accumulated response to DB
        acc_text = get_accumulated_text(session_id)
        tool_calls = get_session_tool_calls(session_id)
        if acc_text or tool_calls:
            save_message(
                session_id=session_id,
                role="assistant",
                content=acc_text,
                tool_calls=tool_calls if tool_calls else None,
            )
        reset_session_state(session_id)
        print(f"[BG] Background consumer saved response for {session_id[:8]}", flush=True)
    except Exception as e:
        print(f"[BG] Background consumer error for {session_id[:8]}: {e}", flush=True)
    finally:
        background_consumers.pop(session_id, None)


# ==================== Pydantic Models ====================


class HookEvent(BaseModel):
    sessionId: str
    hookEvent: str
    timestamp: str
    toolName: str | None = None
    toolInput: dict | None = None
    toolResponse: Any | None = None  # Can be str, dict, or list
    message: str | None = None
    notificationType: str | None = None
    transcriptPath: str | None = None
    stopReason: str | None = None

    class Config:
        extra = "allow"  # Allow extra fields from Claude Code


class PermissionRequest(BaseModel):
    sessionId: str
    toolUseId: str
    toolName: str
    toolInput: dict | None = None
    timestamp: str


class PermissionResponse(BaseModel):
    toolUseId: str
    approved: bool
    reason: str | None = None


def _strip_ansi(text: str) -> str:
    """Remove ANSI escape sequences from text."""
    text = re.sub(r"\x1b\[[0-9;?]*[a-zA-Z]", "", text)
    text = re.sub(r"\[[\d;]*[A-HJKSTfmnsulh]", "", text)
    text = re.sub(r"\d+(?:;\d+)+[mKHJsu]", "", text)
    return text.replace("\x1b", "")


# ==================== Hook Receiver Endpoints ====================


@router.post("/api/hook-event", dependencies=[Depends(require_api_key)])
async def receive_hook_event(event: HookEvent):
    """
    Receive hook events from Claude Code and relay to WebSocket.
    Called by stream-event.ts hook.
    """
    session_id = event.sessionId
    print(f"[Hook] Received {event.hookEvent} for session {session_id[:8]}...", flush=True)

    # Ensure dashboard tracking state exists for this session
    if session_id not in dashboard_session_state:
        session_data = get_session(session_id)
        dashboard_session_state[session_id] = {
            "agent_id": session_data.get("agent_id", "engineer") if session_data else "engineer",
            "title": session_data.get("title", "") if session_data else "",
            "status": "running",
            "tool_call_count": 0,
            "current_tool": None,
            "text_preview": "",
            "input_tokens": 0,
            "output_tokens": 0,
            "started_at": time.time(),
            "recent_tool_calls": [],
        }

    ds = dashboard_session_state[session_id]

    # Track tool calls in PreToolUse
    if event.hookEvent == "PreToolUse" and event.toolName:
        if session_id not in session_tool_calls:
            session_tool_calls[session_id] = []
        session_tool_calls[session_id].append(
            {
                "name": event.toolName,
                "input": event.toolInput,
                "output": None,
                "status": "pending",
            }
        )
        # Update dashboard state
        ds["current_tool"] = event.toolName
        ds["tool_call_count"] = ds.get("tool_call_count", 0) + 1
        ds["status"] = "running"
        ds["recent_tool_calls"] = ds.get("recent_tool_calls", []) + [
            {"name": event.toolName, "status": "running", "input": event.toolInput}
        ]

    # Update tool status in PostToolUse
    if event.hookEvent == "PostToolUse" and event.toolName:
        if session_id in session_tool_calls:
            tool_response = event.toolResponse
            if tool_response and isinstance(tool_response, str):
                tool_response = _strip_ansi(tool_response)

            # Find the matching pending tool call and update it
            for tool_call in reversed(session_tool_calls[session_id]):
                if tool_call["name"] == event.toolName and tool_call["status"] == "pending":
                    tool_call["output"] = tool_response
                    tool_call["status"] = "completed"
                    break
        # Update dashboard state
        ds["current_tool"] = None
        recent = ds.get("recent_tool_calls", [])
        if recent:
            recent[-1] = {**recent[-1], "status": "complete"}
            ds["recent_tool_calls"] = recent

    # On Stop event: save assistant message to DB with accumulated content and tool calls
    # Capture tool_calls before clearing so we can send them via WebSocket
    stop_tool_calls = None
    if event.hookEvent == "Stop":
        content = assistant_content.get(session_id, "")
        tool_calls = session_tool_calls.get(session_id, [])
        stop_tool_calls = tool_calls  # Capture for WebSocket payload

        # Only save if there's content or tool calls
        if content or tool_calls:
            save_message(
                session_id=session_id,
                role="assistant",
                content=content,
                tool_calls=tool_calls if tool_calls else None,
            )

        # Append to agent memory
        session_data = get_session(session_id)
        hook_agent_id = session_data.get("agent_id", "engineer") if session_data else "engineer"
        summary = content[:200].replace("\n", " ").strip()
        if summary:
            append_memory(hook_agent_id, summary)

        # Clear accumulators
        assistant_content.pop(session_id, None)
        session_tool_calls.pop(session_id, None)

        # Update dashboard state
        ds["status"] = "completed"
        ds["current_tool"] = None

        # Auto-generate title for new sessions
        ws = active_connections.get(session_id)
        asyncio.create_task(auto_title_session(session_id, websocket=ws))

    if session_id in active_connections:
        websocket = active_connections[session_id]
        try:
            relay_tool_response = event.toolResponse
            if relay_tool_response and isinstance(relay_tool_response, str):
                relay_tool_response = _strip_ansi(relay_tool_response)

            payload = {
                "type": "hook_event",
                "hookEvent": event.hookEvent,
                "timestamp": event.timestamp,
                "toolName": event.toolName,
                "toolInput": event.toolInput,
                "toolResponse": relay_tool_response,
                "message": event.message,
                "notificationType": event.notificationType,
                "transcriptPath": event.transcriptPath,
                "stopReason": event.stopReason,
            }

            # Include accumulated tool_calls on Stop event
            if event.hookEvent == "Stop":
                payload["toolCalls"] = stop_tool_calls or []

            await websocket.send_json(payload)
        except Exception as e:
            print(f"Error sending hook event to WebSocket: {e}")

    # Broadcast to dashboard WebSocket connections
    if dashboard_connections:
        dashboard_event = {
            "type": "dashboard_event",
            "session_id": session_id,
            "agent_id": ds.get("agent_id", "engineer"),
            "event": {
                "type": "hook_event",
                "hookEvent": event.hookEvent,
                "toolName": event.toolName,
                "toolInput": event.toolInput,
                "toolStatus": "complete" if event.hookEvent == "PostToolUse" else None,
            },
        }
        await _broadcast_to_dashboards(dashboard_event)

    return {"ok": True}


@router.post("/api/permission-request", dependencies=[Depends(require_api_key)])
async def receive_permission_request(request: PermissionRequest):
    """
    Receive permission request from Claude Code and wait for UI response.
    Called by permission-handler.ts hook. This endpoint BLOCKS until responded.
    """
    session_id = request.sessionId
    tool_use_id = request.toolUseId

    # Create event for waiting
    wait_event = asyncio.Event()
    pending_permissions[tool_use_id] = wait_event

    # Send permission request to UI via WebSocket
    if session_id in active_connections:
        websocket = active_connections[session_id]
        try:
            await websocket.send_json(
                {
                    "type": "permission_request",
                    "toolUseId": tool_use_id,
                    "toolName": request.toolName,
                    "toolInput": request.toolInput,
                    "timestamp": request.timestamp,
                }
            )
        except Exception as e:
            print(f"Error sending permission request to WebSocket: {e}")
            # Clean up and deny
            del pending_permissions[tool_use_id]
            return {"approved": False, "reason": f"WebSocket error: {e}"}
    else:
        # No UI connected - auto-deny
        del pending_permissions[tool_use_id]
        return {"approved": False, "reason": "No UI connected"}

    # Wait for UI response (up to 55 seconds)
    try:
        await asyncio.wait_for(wait_event.wait(), timeout=55.0)
    except TimeoutError:
        del pending_permissions[tool_use_id]
        permission_responses.pop(tool_use_id, None)
        return {"approved": False, "reason": "UI did not respond in time"}

    # Get response
    response = permission_responses.pop(tool_use_id, {"approved": False, "reason": "No response"})
    del pending_permissions[tool_use_id]

    return response


# ==================== Dashboard WebSocket Endpoint ====================


@router.websocket("/ws/dashboard")
async def dashboard_websocket(websocket: WebSocket):
    """
    WebSocket endpoint for the dashboard overview.
    Sends periodic agent_state snapshots and relays dashboard_event updates.
    """
    global _dashboard_id_counter
    is_authorized, denial_reason = validate_websocket_api_key(websocket)
    if not is_authorized:
        await websocket.close(code=1008, reason=denial_reason)
        return

    await websocket.accept()
    _dashboard_id_counter += 1
    ws_id = _dashboard_id_counter
    dashboard_connections[ws_id] = websocket
    logger.info(f"[Dashboard WS] Connected (id={ws_id}), total={len(dashboard_connections)}")

    try:
        # Send initial state snapshot
        await websocket.send_json(
            {
                "type": "agent_state",
                "agents": _build_agent_state_snapshot(),
            }
        )

        # Keep connection alive, listen for pings/close
        while True:
            try:
                data = await websocket.receive_json()
                msg_type = data.get("type")
                if msg_type == "ping":
                    await websocket.send_json({"type": "pong"})
                elif msg_type == "request_state":
                    await websocket.send_json(
                        {
                            "type": "agent_state",
                            "agents": _build_agent_state_snapshot(),
                        }
                    )
            except json.JSONDecodeError:
                continue  # Ignore non-JSON messages

    except WebSocketDisconnect:
        logger.info(f"[Dashboard WS] Disconnected (id={ws_id})")
    except Exception as e:
        logger.info(f"[Dashboard WS] Error (id={ws_id}): {e}")
    finally:
        dashboard_connections.pop(ws_id, None)


# ==================== Agent WebSocket Endpoint ====================


@router.websocket("/ws/agent/{session_id}")
async def agent_websocket(websocket: WebSocket, session_id: str):
    """
    WebSocket endpoint for agent communication.

    Messages from client:
    - {"type": "message", "content": "...", "attachments": [...], "agent_id": "...", "message_id": "..."}
    - {"type": "permission_response", "tool_use_id": "...", "approved": bool, "reason": "..."}

    Messages to client:
    - {"type": "hook_event", ...}
    - {"type": "permission_request", ...}
    - {"type": "text_chunk", ...}
    - {"type": "context_update", "inputTokens": int, "outputTokens": int, "model": str, "contextLimit": int}
    - {"type": "ack", "message_id": "..."}
    """
    logger.info(f"[WS] New WebSocket connection for session: {session_id}")
    print(f"[WS] New WebSocket connection for session: {session_id}", flush=True)
    is_authorized, denial_reason = validate_websocket_api_key(websocket)
    if not is_authorized:
        await websocket.close(code=1008, reason=denial_reason)
        return

    await websocket.accept()
    active_connections[session_id] = websocket
    logger.info(f"[WS] Connection accepted. Active connections: {list(active_connections.keys())}")
    print(f"[WS] Connection accepted. Active connections: {list(active_connections.keys())}", flush=True)

    try:
        while True:
            # Receive message from client
            data = await websocket.receive_json()
            msg_type = data.get("type")
            print(f"[WS] Received message type: {msg_type} for session: {session_id}", flush=True)

            if msg_type == "message":
                # User sent a message
                content = data.get("content", "")
                if not isinstance(content, str):
                    content = str(content) if content is not None else ""
                agent_id = data.get("agent_id", "engineer")
                message_id = data.get("message_id")
                attachments_payload = data.get("attachments", [])

                prompt_content, attachment_contexts = build_prompt_with_attachments(
                    content=content,
                    session_id=session_id,
                    attachments_payload=attachments_payload,
                )

                stored_content = content
                if attachment_contexts:
                    attachment_names = ", ".join(item["name"] for item in attachment_contexts)
                    attachment_suffix = f"[Attached files: {attachment_names}]"
                    if stored_content.strip():
                        stored_content = f"{stored_content}\n\n{attachment_suffix}"
                    else:
                        stored_content = attachment_suffix

                print(
                    f"[WS] Received message for session {session_id}: "
                    f"{content[:50]}... (attachments={len(attachment_contexts)})",
                    flush=True,
                )

                if not prompt_content.strip():
                    if message_id:
                        await websocket.send_json(
                            {
                                "type": "ack",
                                "message_id": message_id,
                                "success": False,
                            }
                        )
                    await websocket.send_json(
                        {
                            "type": "hook_event",
                            "hookEvent": "Error",
                            "message": "Message is empty and no valid attachments were found",
                            "timestamp": time.time(),
                        }
                    )
                    continue

                # Ensure DB record exists for this exact WebSocket session_id.
                # This prevents message/session ID divergence.
                ensure_session(session_id=session_id, title="New Chat", agent_id=agent_id)

                # Save user message to DB first
                save_message(
                    session_id=session_id,
                    role="user",
                    content=stored_content,
                )
                print("[WS] Saved message to DB", flush=True)

                stream_mgr = get_stream_manager()

                # Acknowledge receipt immediately
                if message_id:
                    await websocket.send_json(
                        {
                            "type": "ack",
                            "message_id": message_id,
                            "success": True,
                        }
                    )

                # Ensure dashboard tracking for this session
                if session_id not in dashboard_session_state:
                    dashboard_session_state[session_id] = {
                        "agent_id": agent_id,
                        "title": "",
                        "status": "running",
                        "tool_call_count": 0,
                        "current_tool": None,
                        "text_preview": "",
                        "input_tokens": 0,
                        "output_tokens": 0,
                        "started_at": time.time(),
                        "recent_tool_calls": [],
                    }
                else:
                    dashboard_session_state[session_id]["status"] = "running"

                # Stream events from Claude
                try:
                    async for event in stream_mgr.send_prompt(
                        session_id=session_id,
                        prompt=prompt_content,
                        agent_id=agent_id,
                    ):
                        # Translate stream-json event to WebSocket format
                        for ws_event in translate_event(session_id, event):
                            await websocket.send_json(ws_event)

                            # Broadcast to dashboard connections
                            if dashboard_connections:
                                sds = dashboard_session_state.get(session_id, {})
                                ws_type = ws_event.get("type", "")
                                if ws_type == "hook_event":
                                    hook_evt = ws_event.get("hookEvent", "")
                                    if hook_evt == "PreToolUse":
                                        sds["current_tool"] = ws_event.get("toolName")
                                        sds["tool_call_count"] = sds.get("tool_call_count", 0) + 1
                                        sds["status"] = "running"
                                        sds.setdefault("recent_tool_calls", []).append(
                                            {"name": ws_event.get("toolName", "unknown"), "status": "running"}
                                        )
                                    elif hook_evt == "PostToolUse":
                                        sds["current_tool"] = None
                                        recent = sds.get("recent_tool_calls", [])
                                        if recent:
                                            recent[-1] = {**recent[-1], "status": "complete"}
                                    elif hook_evt == "Stop":
                                        sds["status"] = "completed"
                                        sds["current_tool"] = None
                                elif ws_type == "text_chunk":
                                    chunk = ws_event.get("content", "")
                                    preview = sds.get("text_preview", "") + chunk
                                    sds["text_preview"] = preview[-200:]
                                elif ws_type == "context_update":
                                    sds["input_tokens"] = ws_event.get("inputTokens", sds.get("input_tokens", 0))
                                    sds["output_tokens"] = ws_event.get("outputTokens", sds.get("output_tokens", 0))

                                await _broadcast_to_dashboards(
                                    {
                                        "type": "dashboard_event",
                                        "session_id": session_id,
                                        "agent_id": sds.get("agent_id", agent_id),
                                        "event": ws_event,
                                    }
                                )

                            # On Stop event, save assistant message to DB
                            if ws_event.get("hookEvent") == "Stop":
                                acc_text = get_accumulated_text(session_id)
                                tool_calls = get_session_tool_calls(session_id)
                                if acc_text or tool_calls:
                                    save_message(
                                        session_id=session_id,
                                        role="assistant",
                                        content=acc_text,
                                        tool_calls=tool_calls if tool_calls else None,
                                    )
                                # Append to agent memory
                                session_data = get_session(session_id)
                                stream_agent_id = (
                                    session_data.get("agent_id", "engineer") if session_data else "engineer"
                                )
                                summary = (acc_text or "")[:200].replace("\n", " ").strip()
                                if summary:
                                    append_memory(stream_agent_id, summary)
                                # Auto-generate title for new sessions
                                asyncio.create_task(auto_title_session(session_id, websocket=websocket))
                                # Clean up translator state after saving
                                reset_session_state(session_id)
                except Exception as e:
                    print(f"[WS] Stream error for {session_id}: {e}", flush=True)
                    try:
                        await websocket.send_json(
                            {
                                "type": "hook_event",
                                "hookEvent": "Error",
                                "message": str(e),
                                "timestamp": time.time(),
                            }
                        )
                    except Exception:
                        pass  # WebSocket already closed
                    # Only reset state if subprocess is done —
                    # if still running, background consumer will handle cleanup
                    stream_mgr = get_stream_manager()
                    proc = stream_mgr._running_processes.get(session_id)
                    if not proc or proc.returncode is not None:
                        reset_session_state(session_id)

            elif msg_type == "permission_response":
                # User responded to permission request
                tool_use_id = data.get("tool_use_id")
                approved = data.get("approved", False)
                reason = data.get("reason")

                if tool_use_id in pending_permissions:
                    # Store response and signal waiting hook
                    permission_responses[tool_use_id] = {
                        "approved": approved,
                        "reason": reason,
                    }
                    pending_permissions[tool_use_id].set()

            elif msg_type == "stop":
                # Stop the running agent
                print(f"[WS] Received stop signal for session: {session_id}", flush=True)

                stream_mgr = get_stream_manager()
                stopped = await stream_mgr.stop_session(session_id)
                await websocket.send_json(
                    {
                        "type": "hook_event",
                        "hookEvent": "Stop",
                        "message": "Agent stopped by user" if stopped else "No agent running",
                        "timestamp": time.time(),
                    }
                )

            elif msg_type == "activate":
                # Activate/create session
                agent_id = data.get("agent_id", "engineer")

                # Ensure DB record exists using the exact incoming session_id.
                ensure_session(session_id=session_id, title="New Chat", agent_id=agent_id)

                await websocket.send_json(
                    {
                        "type": "activated",
                        "session_id": session_id,
                    }
                )

    except WebSocketDisconnect:
        print(f"[WS] WebSocket disconnected for session: {session_id}", flush=True)
    except Exception as e:
        print(f"[WS] WebSocket error for {session_id}: {e}", flush=True)
    finally:
        print(f"[WS] Cleaning up connection for session: {session_id}", flush=True)

        # Clean up connection (only if this websocket is the current one)
        if session_id in active_connections and active_connections[session_id] == websocket:
            del active_connections[session_id]
            print("[WS] Removed from active_connections", flush=True)

        # If subprocess is still running, spawn background consumer to save its output
        stream_mgr = get_stream_manager()
        process = stream_mgr._running_processes.get(session_id)
        if process and process.returncode is None:
            print(f"[WS] Subprocess still running for {session_id[:8]}, spawning background consumer", flush=True)
            background_consumers[session_id] = asyncio.create_task(_background_consume(session_id, process))
