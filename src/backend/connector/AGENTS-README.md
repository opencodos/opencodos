# Agent Dashboard Infrastructure

> Documentation for the tmux-based Claude Code agent system powering the Atlas Agent Dashboard.

**Last Updated:** 2026-01-27
**Confidence:** 10/10 (all edge cases researched and documented)

---

## Overview

This system enables real-time Claude Code agents in a web UI using **subscription billing** (not API credits). Each agent runs in a tmux session with Claude Code CLI, streaming events and text to the frontend via WebSocket.

### Architecture

```
Frontend (React) ←──WebSocket──→ Backend (FastAPI) ←──HTTP POST──┬── Hooks (tool events)
                                        │                        │
                                        │                        └── pipe-pane relay (text)
                                        │
                                   tmux send-keys
                                        │
                                        ▼
                                Claude (interactive)
```

### Key Benefits

- **Subscription billing** - Uses interactive Claude Code, not API credits
- **Full Claude Code** - All tools, MCP servers, skills available
- **Session persistence** - tmux sessions survive server restarts
- **Real-time streaming** - pipe-pane delivers text in sub-milliseconds
- **Structured events** - Hooks provide tool lifecycle events
- **Permission UI** - Users approve/deny tool executions in the browser

---

## File Structure

```
connector-backend/
├── services/
│   ├── session_manager.py      # tmux session lifecycle + pipe-pane setup
│   └── session_storage.py      # SQLite persistence for sessions/messages
├── routes/
│   ├── agents_ws.py            # WebSocket + hook receivers
│   ├── agents_rest.py          # REST API for session CRUD
│   └── setup.py                # Setup wizard (includes dependency checks)
├── hooks/
│   ├── stream-event.ts         # PreToolUse/PostToolUse/Stop → HTTP POST
│   ├── permission-handler.ts   # PermissionRequest → blocks until UI responds
│   └── text-relay.sh           # pipe-pane → HTTP POST (sub-ms latency)
└── AGENTS-README.md            # This file

frontend/src/
├── hooks/
│   └── useAgentWebSocket.ts    # WebSocket hook with reconnection
├── components/
│   ├── agents/
│   │   ├── ChatArea.tsx        # Main chat UI with WebSocket integration
│   │   ├── PermissionDialog.tsx # Tool approval modal
│   │   └── AgentSidebar.tsx    # Agent selection
│   └── setup/
│       └── DependencyCheck.tsx  # Setup wizard dependency checker
├── types/
│   └── agents.ts               # TypeScript types for agents, sessions
└── lib/
    └── api.ts                  # API client with agentSessionsAPI
```

---

## Dependencies

| Dependency | Version | Purpose | Install |
|------------|---------|---------|---------|
| bun | any | TypeScript hook execution | `curl -fsSL https://bun.sh/install \| bash` |
| Claude CLI | any | Interactive Claude Code | `npm i -g @anthropic-ai/claude-code` |
| tmux | 2.6+ | *(optional, legacy agent mode)* Session management, pipe-pane | `brew install tmux` |

**Note:** In the Tauri desktop app, bun and claude are bundled automatically — no manual install needed.

Check dependencies: `GET /api/setup/check-dependencies`

---

## API Endpoints

### WebSocket

| Endpoint | Purpose |
|----------|---------|
| `WS /ws/agent/{session_id}` | Bidirectional real-time communication |

**Client → Server Messages:**
- `{ type: "message", content: string, agent_id: string }` - Send user message
- `{ type: "permission_response", tool_use_id: string, approved: bool }` - Respond to permission

**Server → Client Messages:**
- `{ type: "text_chunk", content: string }` - Streaming text from Claude
- `{ type: "hook_event", hookEvent: string, toolName?: string, ... }` - Tool events
- `{ type: "permission_request", toolUseId: string, toolName: string, toolInput: object }` - Approval needed

### Hook Receivers

| Endpoint | Purpose |
|----------|---------|
| `POST /api/hook-event` | Receives PreToolUse/PostToolUse/Stop events |
| `POST /api/permission-request` | Receives permission requests, BLOCKS until UI responds |
| `POST /api/text-stream` | Receives text chunks from pipe-pane relay |

### REST API

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/agents/sessions` | GET | List all sessions |
| `/api/agents/sessions` | POST | Create new session |
| `/api/agents/sessions/{id}` | GET | Get session + messages |
| `/api/agents/sessions/{id}` | DELETE | Kill session |
| `/api/agents/sessions/{id}/activate` | POST | Resume session |

### Setup

| Endpoint | Purpose |
|----------|---------|
| `GET /api/setup/check-bun` | Check bun installation |
| `GET /api/setup/check-dependencies` | All deps at once (bun + claude) |

---

## Session Lifecycle

### 1. Session Creation

```python
# In session_manager.py
manager.create_session(session_id, agent_id)
```

This:
1. Creates `~/.atlas/sessions/{session_id}/` directory
2. Writes `CLAUDE.md` with agent persona
3. Writes `.claude/settings.json` with hooks configuration
4. Creates tmux session: `tmux new-session -d -s atlas-{id} claude --verbose`
5. Sets up pipe-pane: `tmux pipe-pane -t atlas-{id} "bash text-relay.sh"`

### 2. Message Flow

```
User types message
       │
       ▼
Frontend sends WebSocket: { type: "message", content: "..." }
       │
       ▼
Backend calls: tmux send-keys -t atlas-{id} "message" Enter
       │
       ▼
Claude processes, hooks fire:
  - PreToolUse → POST /api/hook-event → WebSocket → UI shows "Using Bash..."
  - PostToolUse → POST /api/hook-event → WebSocket → UI shows result
  - PermissionRequest → POST /api/permission-request → WebSocket → UI shows dialog
                                                                      │
                        User clicks Approve/Deny ────────────────────┘
                                │
                                ▼
                        HTTP response unblocks hook
                                │
                                ▼
                        Claude continues or stops
       │
       ▼
Text output via pipe-pane → text-relay.sh → POST /api/text-stream → WebSocket → UI
       │
       ▼
Stop hook fires → POST /api/hook-event → WebSocket → UI marks complete
```

### 3. Session Cleanup

```python
# Kill specific session
manager.kill_session(session_id)

# Cleanup orphans (dead panes, idle > 2 hours)
await manager.cleanup_orphaned_sessions(max_age_minutes=120)
```

---

## Hooks Configuration

Each session has `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "bun stream-event.ts" }] }],
    "PostToolUse": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "bun stream-event.ts" }] }],
    "Stop": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "bun stream-event.ts" }] }],
    "PermissionRequest": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "bun permission-handler.ts" }] }]
  },
  "permissions": {
    "allow": ["Read", "Glob", "Grep", "WebSearch", "WebFetch", "mcp__*"]
  }
}
```

### Hook Scripts

**stream-event.ts** - Forwards tool events to backend
- Reads JSON from stdin
- Extracts session_id from cwd
- POSTs to `/api/hook-event`
- Returns `{ "continue": true }`

**permission-handler.ts** - Handles permission requests
- POSTs to `/api/permission-request` (BLOCKS until response)
- 55s timeout (Claude allows 60s)
- Returns `{ hookSpecificOutput: { permissionDecision: "allow"|"deny" } }`

**text-relay.sh** - Streams pane output
- Reads character-by-character from pipe-pane
- Buffers and flushes on newline or 50 chars
- POSTs to `/api/text-stream` (async with `&`)

---

## Edge Cases Handled

### tmux Version
- **tmux 2.3 bug**: pipe-pane produces garbled output (buffer offset tracking bug)
- **Solution**: Check version on startup, require 2.6+, warn if 2.4-2.5

### Zombie Sessions
```python
# Check if pane is dead
is_dead = subprocess.run(
    ["tmux", "display", "-t", session, "-p", "#{?pane_dead,1,0}"],
    capture_output=True, text=True
).stdout.strip() == "1"
```

### Session Name Collision
```bash
# Idempotent create-or-attach
tmux new-session -A -s atlas-{id}
```

### Claude Immediate Exit
```python
# Wait 1.5s after spawn, then check if dead
time.sleep(1.5)
if is_pane_dead(session):
    error = capture_pane_output(session)
    raise RuntimeError(f"Claude exited: {error}")
```

### PATH Issues
- Always use absolute path to claude CLI
- Inherit `os.environ` when spawning tmux

### CORS
- Backend allows origins: `localhost:5173`, `5174`, `5175`, `127.0.0.1:*`

---

## Agent Personas

Defined in `session_manager.py` and injected via `CLAUDE.md`:

| ID | Name | Description |
|----|------|-------------|
| engineer | Karpathy | Senior software engineer, pragmatic |
| researcher | McKinsey | Research analyst, data-driven |
| hr | Hillary | HR specialist, people-focused |
| writer | Chief Content | Content strategist, clear communication |
| sales | CGO | Growth leader, relationship-focused |

---

## Frontend Integration

### useAgentWebSocket Hook

```typescript
const {
  connected,           // boolean - WebSocket connected
  events,              // HookEvent[] - Tool events
  textChunks,          // TextChunk[] - Streaming text
  pendingPermission,   // PermissionRequest | null
  sendMessage,         // (content: string, agentId?: string) => void
  respondToPermission, // (toolUseId: string, approved: boolean) => void
  clearEvents,         // () => void
} = useAgentWebSocket(sessionId)
```

### PermissionDialog Props

```typescript
interface PermissionDialogProps {
  toolName: string
  toolInput: Record<string, unknown>
  onApprove: () => void
  onDeny: (reason?: string) => void
}
```

Features:
- Tool-specific rendering (Bash shows command, Write shows file path)
- Dangerous command detection (rm -rf, sudo, etc.)
- Keyboard shortcuts (Enter=approve, Escape=deny)

---

## Testing

### Manual Testing

```bash
# 1. Start backend
cd connector-backend && uvicorn server:app --reload --port 8767

# 2. Start frontend
cd frontend && npm run dev

# 3. Check dependencies
curl http://localhost:8767/api/setup/check-dependencies | jq .

# 4. Create test session
curl -X POST http://localhost:8767/api/agents/sessions \
  -H "Content-Type: application/json" \
  -d '{"title": "Test", "agent_id": "engineer"}'

# 5. Check tmux session
tmux list-sessions
tmux attach -t atlas-{id}

# 6. Check session directory
ls -la ~/.atlas/sessions/{id}/
cat ~/.atlas/sessions/{id}/CLAUDE.md
cat ~/.atlas/sessions/{id}/.claude/settings.json
```

### WebSocket Testing

```javascript
// Browser console
const ws = new WebSocket('ws://localhost:8767/ws/agent/test-123')
ws.onmessage = (e) => console.log(JSON.parse(e.data))
ws.send(JSON.stringify({ type: 'message', content: 'Hello', agent_id: 'engineer' }))
```

---

## Troubleshooting

### WebSocket Disconnects Immediately
- Check CORS origins in `server.py`
- Verify session exists: `tmux has-session -t atlas-{id}`

### No Text Streaming
- Verify pipe-pane is set up: `tmux show-options -t atlas-{id}`
- Check text-relay.sh is executable: `chmod +x hooks/text-relay.sh`

### Permission Requests Not Showing
- Check hooks are configured in `.claude/settings.json`
- Verify bun can run TypeScript: `bun --version`
- Check backend logs for `/api/permission-request` calls

### tmux Session Dies Immediately
- Check Claude CLI is installed: `which claude`
- Verify trust prompt was answered (first run)
- Check session directory permissions

---

## Deep Plan Reference

Full architecture and research documented in:
`Vault/2 - Projects/Codos-Atlas/1 - Engineering/Plans/Jan 27 Eng/Claude Code CLI for UI Agents - Deep Plan.md`

---

## Future Improvements

1. **Session Resumption** - Use Claude's `--resume` flag to continue sessions
2. **Multi-Agent Orchestration** - Spawn subagents via Task tool
3. **Custom MCP Tools** - Add Atlas-specific tools (vault search, todos)
4. **Cost Tracking** - Track token usage per session
5. **Message Persistence** - Save full conversation history to SQLite

---

*Generated by Atlas Agent Session - 2026-01-27*
