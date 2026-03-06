"""Event Translator for stream-json to WebSocket format.

Maps Claude Code's stream-json events to the WebSocket format expected by
the Atlas frontend. This maintains compatibility with the existing UI.

Stream-json events:
    - {"type": "assistant", "message": {"content": [...]}}
    - {"type": "user", "message": {"content": [...]}} (tool results)
    - {"type": "result", ...}

WebSocket events (what frontend expects):
    - {"type": "text_chunk", "content": "...", "timestamp": ...}
    - {"type": "hook_event", "hookEvent": "PreToolUse", ...}
    - {"type": "hook_event", "hookEvent": "PostToolUse", ...}
    - {"type": "hook_event", "hookEvent": "Stop", ...}
"""

import time
from collections.abc import Generator

# DEBUG flag - set to True to enable verbose logging
DEBUG = False

# Track accumulated text per session to compute deltas
_accumulated_text: dict[str, str] = {}

# Track pending tool calls per session (PreToolUse without PostToolUse yet)
_pending_tools: dict[str, dict[str, dict]] = {}  # session_id -> {tool_use_id -> tool_info}

# Track all tool calls per session for Stop event
_session_tool_calls: dict[str, list] = {}

# Track context usage per session (latest snapshot from API)
_session_usage: dict[str, dict] = {}

# Model context window limits (tokens) — all current Claude models use 200k
DEFAULT_CONTEXT_LIMIT = 200000


def reset_session_state(session_id: str) -> None:
    """Reset translator state for a session (call at start of new message).

    Note: Does NOT reset _session_usage — context usage persists across messages.
    """
    _accumulated_text.pop(session_id, None)
    _pending_tools.pop(session_id, None)
    _session_tool_calls.pop(session_id, None)


def get_session_tool_calls(session_id: str) -> list:
    """Get accumulated tool calls for a session."""
    return _session_tool_calls.get(session_id, [])


def get_accumulated_text(session_id: str) -> str:
    """Get accumulated assistant text for a session."""
    return _accumulated_text.get(session_id, "")


def get_session_usage(session_id: str) -> dict:
    """Get latest context usage snapshot for a session."""
    return _session_usage.get(session_id, {})


def reset_session_usage(session_id: str) -> None:
    """Reset usage tracking for a session."""
    _session_usage.pop(session_id, None)


def translate_event(
    session_id: str,
    event: dict,
) -> Generator[dict, None, None]:
    """Translate a stream-json event to WebSocket events.

    Args:
        session_id: The session this event belongs to
        event: The stream-json event from Claude Code

    Yields:
        dict: WebSocket events for the frontend
    """
    event_type = event.get("type", "")
    timestamp = time.time()

    if event_type == "assistant":
        # Assistant message - contains text and/or tool_use
        message = event.get("message", {})
        content_blocks = message.get("content", [])

        for block in content_blocks:
            block_type = block.get("type", "")

            if block_type == "thinking":
                # Skip thinking blocks - internal reasoning not for display
                continue

            if block_type == "text":
                # Text content - compute delta to avoid duplicates
                text = block.get("text", "")
                if not text:
                    continue

                # Get previous accumulated text
                prev_text = _accumulated_text.get(session_id, "")

                # Compute delta
                if text.startswith(prev_text) and len(text) > len(prev_text):
                    # Text is extension of what we have
                    delta = text[len(prev_text) :]
                elif text == prev_text:
                    # Duplicate, skip
                    continue
                else:
                    # New text (possibly replacement)
                    delta = text

                # Update accumulator
                _accumulated_text[session_id] = text

                # Yield text chunk
                if delta:
                    yield {
                        "type": "text_chunk",
                        "content": delta,
                        "timestamp": timestamp,
                    }

            elif block_type == "tool_use":
                # Tool use starting - emit PreToolUse
                tool_id = block.get("id", "")
                tool_name = block.get("name", "")
                tool_input = block.get("input", {})

                if DEBUG:
                    print(f"[DEBUG] PreToolUse: id={tool_id}, name={tool_name}", flush=True)

                # Track pending tool
                if session_id not in _pending_tools:
                    _pending_tools[session_id] = {}

                _pending_tools[session_id][tool_id] = {
                    "name": tool_name,
                    "input": tool_input,
                    "status": "pending",
                }

                # Add to session tool calls
                if session_id not in _session_tool_calls:
                    _session_tool_calls[session_id] = []

                _session_tool_calls[session_id].append(
                    {
                        "name": tool_name,
                        "input": tool_input,
                        "output": None,
                        "status": "pending",
                    }
                )

                yield {
                    "type": "hook_event",
                    "hookEvent": "PreToolUse",
                    "toolUseId": tool_id,
                    "toolName": tool_name,
                    "toolInput": tool_input,
                    "timestamp": timestamp,
                }

        # Extract usage data for context window tracking
        # Note: with prompt caching, input_tokens is only the non-cached portion.
        # Real context usage = input_tokens + cache_creation + cache_read
        usage = message.get("usage", {})
        model = message.get("model", "")

        if usage:
            input_tokens = (
                usage.get("input_tokens", 0)
                + usage.get("cache_creation_input_tokens", 0)
                + usage.get("cache_read_input_tokens", 0)
            )
            output_tokens = usage.get("output_tokens", 0)

            # Store latest usage snapshot
            _session_usage[session_id] = {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "model": model,
            }

            context_limit = DEFAULT_CONTEXT_LIMIT

            yield {
                "type": "context_update",
                "inputTokens": input_tokens,
                "outputTokens": output_tokens,
                "model": model,
                "contextLimit": context_limit,
                "timestamp": timestamp,
            }

    elif event_type == "user":
        # User message - contains tool_result
        message = event.get("message", {})
        content_blocks = message.get("content", [])

        for block in content_blocks:
            block_type = block.get("type", "")

            if block_type == "tool_result":
                tool_use_id = block.get("tool_use_id", "")
                tool_content = block.get("content", "")

                if DEBUG:
                    pending_ids = list(_pending_tools.get(session_id, {}).keys())
                    print(f"[DEBUG] PostToolUse: tool_use_id={tool_use_id}, pending_ids={pending_ids}", flush=True)

                # Handle content that might be a list of blocks
                if isinstance(tool_content, list):
                    # Extract text from content blocks
                    text_parts = []
                    for item in tool_content:
                        if isinstance(item, dict) and item.get("type") == "text":
                            text_parts.append(item.get("text", ""))
                        elif isinstance(item, str):
                            text_parts.append(item)
                    tool_content = "\n".join(text_parts)

                # Find the matching pending tool
                tool_name = "Unknown"
                tool_input = {}

                if session_id in _pending_tools and tool_use_id in _pending_tools[session_id]:
                    tool_info = _pending_tools[session_id].pop(tool_use_id)
                    tool_name = tool_info.get("name", "Unknown")
                    tool_input = tool_info.get("input", {})
                    if DEBUG:
                        print(f"[DEBUG] Matched tool_use_id! tool_name={tool_name}", flush=True)
                else:
                    if DEBUG:
                        print(f"[DEBUG] NO MATCH for tool_use_id={tool_use_id}!", flush=True)

                # Detect error in output - only check for actual error markers
                is_error = False
                if tool_content:
                    content_str = str(tool_content)
                    # Check for explicit error markers from Claude Code
                    if "<tool_use_error>" in content_str:
                        is_error = True
                    # Check for "is_error" field in structured responses
                    elif block.get("is_error", False):
                        is_error = True

                # Update session tool calls
                if session_id in _session_tool_calls:
                    for tool_call in reversed(_session_tool_calls[session_id]):
                        if tool_call["name"] == tool_name and tool_call["status"] == "pending":
                            tool_call["output"] = tool_content
                            tool_call["status"] = "error" if is_error else "completed"
                            break

                final_status = "error" if is_error else "complete"
                if DEBUG:
                    print(
                        f"[DEBUG] Yielding PostToolUse: tool={tool_name}, status={final_status}, is_error={is_error}",
                        flush=True,
                    )
                    if is_error:
                        print(f"[DEBUG] Error content: {str(tool_content)[:200]}", flush=True)

                yield {
                    "type": "hook_event",
                    "hookEvent": "PostToolUse",
                    "toolUseId": tool_use_id,
                    "toolName": tool_name,
                    "toolInput": tool_input,
                    "toolResponse": tool_content,
                    "toolStatus": final_status,
                    "timestamp": timestamp,
                }

    elif event_type == "result":
        # Final result - emit Stop event
        result_text = event.get("result", "")
        is_error = event.get("is_error", False)
        usage = event.get("usage", {})

        # Emit final context_update from result — prefer modelUsage (has contextWindow)
        model_usage = event.get("modelUsage", {})
        if model_usage:
            # modelUsage is keyed by model name, e.g. {"claude-opus-4-6": {...}}
            model_data = next(iter(model_usage.values()), {})
            model = next(iter(model_usage.keys()), "")

            input_tokens = (
                model_data.get("inputTokens", 0)
                + model_data.get("cacheCreationInputTokens", 0)
                + model_data.get("cacheReadInputTokens", 0)
            )
            output_tokens = model_data.get("outputTokens", 0)
            context_limit = model_data.get("contextWindow", DEFAULT_CONTEXT_LIMIT)

            _session_usage[session_id] = {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "model": model,
            }

            yield {
                "type": "context_update",
                "inputTokens": input_tokens,
                "outputTokens": output_tokens,
                "model": model,
                "contextLimit": context_limit,
                "timestamp": timestamp,
            }
        elif usage:
            # Fallback to usage field (with cache tokens)
            input_tokens = (
                usage.get("input_tokens", 0)
                + usage.get("cache_creation_input_tokens", 0)
                + usage.get("cache_read_input_tokens", 0)
            )
            output_tokens = usage.get("output_tokens", 0)
            model = _session_usage.get(session_id, {}).get("model", "")

            _session_usage[session_id] = {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "model": model,
            }

            context_limit = DEFAULT_CONTEXT_LIMIT

            yield {
                "type": "context_update",
                "inputTokens": input_tokens,
                "outputTokens": output_tokens,
                "model": model,
                "contextLimit": context_limit,
                "timestamp": timestamp,
            }

        # Get final tool calls
        tool_calls = _session_tool_calls.get(session_id, [])

        # If result text differs from accumulated, yield the difference
        prev_text = _accumulated_text.get(session_id, "")
        if result_text and result_text != prev_text:
            if result_text.startswith(prev_text):
                delta = result_text[len(prev_text) :]
                if delta:
                    # Update accumulated text with full result
                    _accumulated_text[session_id] = result_text
                    yield {
                        "type": "text_chunk",
                        "content": delta,
                        "timestamp": timestamp,
                    }
            else:
                # Result is different - use result as final text
                _accumulated_text[session_id] = result_text

        yield {
            "type": "hook_event",
            "hookEvent": "Stop",
            "stopReason": "error" if is_error else "end_turn",
            "toolCalls": tool_calls,
            "usage": usage,
            "timestamp": timestamp,
        }

        # NOTE: Don't reset session state here - caller needs to retrieve
        # accumulated text and tool calls first. Caller should call
        # reset_session_state() after saving to DB.

    elif event_type == "error":
        # Error from our stream_manager
        yield {
            "type": "hook_event",
            "hookEvent": "Error",
            "message": event.get("error", "Unknown error"),
            "timestamp": timestamp,
        }

        # NOTE: Don't reset here - caller handles cleanup

    # Other event types (system, etc.) are ignored
