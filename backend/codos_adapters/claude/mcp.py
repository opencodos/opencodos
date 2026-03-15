"""Adapter for the Claude CLI MCP commands."""

from __future__ import annotations

import asyncio
import logging
import os
import re
import time
from dataclasses import dataclass
from enum import Enum

from backend.codos_utils.deps import find_claude

logger = logging.getLogger(__name__)


class McpStatus(Enum):
    CONNECTED = "connected"
    NEEDS_AUTH = "needs_auth"


@dataclass(frozen=True)
class McpServer:
    name: str
    url: str
    status: McpStatus


_list_cache: tuple[dict[str, McpServer], float] | None = None
_CACHE_TTL = 10.0


async def _run(args: list[str], timeout_sec: float = 15) -> tuple[int, str]:
    claude_bin = find_claude()
    if not claude_bin:
        raise FileNotFoundError("claude CLI not found in PATH")

    proc = await asyncio.create_subprocess_exec(
        claude_bin,
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env={**os.environ, "CLAUDECODE": ""},
    )
    stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout_sec)
    return proc.returncode or 0, stdout.decode()


# claude.ai Notion: https://mcp.notion.com/mcp - ✓ Connected
# claude.ai Gmail: https://gmail.mcp.claude.com/mcp - ! Needs authentication
_LINE_RE = re.compile(r"^(.+?):\s+(https?://\S+).*?-\s+(.+)$")


def _parse_mcp_list_output(output: str) -> dict[str, McpServer]:
    servers: dict[str, McpServer] = {}
    for line in output.splitlines():
        line = line.strip()
        if not line or line.startswith("Checking"):
            continue

        match = _LINE_RE.match(line)
        if not match:
            continue

        name = match.group(1).strip()
        url = match.group(2).strip()
        raw_status = match.group(3).strip()

        status = McpStatus.NEEDS_AUTH if "Needs authentication" in raw_status else McpStatus.CONNECTED
        servers[name] = McpServer(name=name, url=url, status=status)

    return servers


def invalidate_cache() -> None:
    global _list_cache
    _list_cache = None


async def list_servers() -> dict[str, McpServer]:
    global _list_cache

    now = time.time()
    if _list_cache is not None:
        cached, cached_at = _list_cache
        if now - cached_at < _CACHE_TTL:
            return cached

    try:
        _, stdout = await _run(["mcp", "list"])
    except (TimeoutError, FileNotFoundError, OSError) as exc:
        logger.warning("claude mcp list failed: %s", exc)
        return {}

    result = _parse_mcp_list_output(stdout)
    _list_cache = (result, now)
    return result
