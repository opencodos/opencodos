import { useState, useEffect, useCallback, useRef } from 'react'
import type { DashboardAgentState, DashboardSessionState, DashboardAgentStatus } from '@/types/agents'
import { getDesktopAtlasApiKey } from '@/lib/desktopRuntimeBootstrap'

// ==================== Configuration ====================

function getDesktopRuntimeWebSocketUrl(): string | null {
  if (typeof window === 'undefined') {
    return null
  }

  const bootstrap = (window as unknown as Record<string, unknown>).__CODOS_DESKTOP_BOOTSTRAP__
  if (!bootstrap || typeof bootstrap !== 'object') {
    return null
  }

  const value = bootstrap as Record<string, unknown>
  const url =
    typeof value.backendWsUrl === 'string'
      ? value.backendWsUrl
      : typeof value.backend_ws_url === 'string'
        ? value.backend_ws_url
        : null

  if (!url) {
    return null
  }

  return url.endsWith('/') ? url.slice(0, -1) : url
}

function getWebSocketUrl(): string {
  const desktopRuntimeUrl = getDesktopRuntimeWebSocketUrl()
  if (desktopRuntimeUrl) {
    return desktopRuntimeUrl
  }

  const envUrl = import.meta.env.VITE_WS_BASE_URL
  if (envUrl) {
    return envUrl
  }

  const apiUrl = import.meta.env.VITE_API_BASE_URL
  if (apiUrl) {
    return apiUrl.replace(/^http/, 'ws')
  }

  return 'ws://localhost:8767'
}

function withAtlasApiKey(url: string): string {
  const atlasKey = (getDesktopAtlasApiKey() || import.meta.env.VITE_ATLAS_API_KEY || '').trim()
  if (!atlasKey) return url

  try {
    const parsed = new URL(url)
    parsed.searchParams.set('atlas_key', atlasKey)
    return parsed.toString()
  } catch {
    const separator = url.includes('?') ? '&' : '?'
    return `${url}${separator}atlas_key=${encodeURIComponent(atlasKey)}`
  }
}

// ==================== Types ====================

interface AgentStateMessage {
  type: 'agent_state'
  agents: Array<{
    agent_id: string
    status: DashboardAgentStatus
    sessions: Array<{
      session_id: string
      title: string
      status: DashboardAgentStatus
      tool_call_count: number
      current_tool: string | null
      text_preview: string
      input_tokens: number
      output_tokens: number
      started_at?: number
      recent_tool_calls: Array<{ name: string; status: string; input?: Record<string, unknown> }>
    }>
  }>
}

interface DashboardEventMessage {
  type: 'dashboard_event'
  session_id: string
  agent_id: string
  event: {
    type: string
    hookEvent?: string
    toolName?: string
    toolInput?: Record<string, unknown>
    toolStatus?: string
    content?: string
    inputTokens?: number
    outputTokens?: number
  }
}

type DashboardMessage = AgentStateMessage | DashboardEventMessage

export interface UseDashboardWebSocketReturn {
  connected: boolean
  agentStates: Map<string, DashboardAgentState>
}

// ==================== Hook Implementation ====================

export function useDashboardWebSocket(): UseDashboardWebSocketReturn {
  const [connected, setConnected] = useState(false)
  const [agentStates, setAgentStates] = useState<Map<string, DashboardAgentState>>(new Map())

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectAttemptRef = useRef(0)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Calculate reconnect delay with exponential backoff (1s -> 30s, 25% jitter)
  const getReconnectDelay = useCallback(() => {
    const baseDelay = 1000
    const maxDelay = 30000
    const attempt = reconnectAttemptRef.current
    const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay)
    return delay + Math.random() * delay * 0.25
  }, [])

  // Handle incoming WebSocket messages
  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data) as DashboardMessage

      switch (data.type) {
        case 'agent_state': {
          // Full snapshot — replace entire state
          const newMap = new Map<string, DashboardAgentState>()
          for (const agent of data.agents) {
            newMap.set(agent.agent_id, {
              agent_id: agent.agent_id,
              status: agent.status,
              sessions: agent.sessions,
            })
          }
          setAgentStates(newMap)
          break
        }

        case 'dashboard_event': {
          // Incremental update by agent_id + session_id
          setAgentStates((prev) => {
            const next = new Map(prev)
            const agentId = data.agent_id
            const sessionId = data.session_id
            const innerEvent = data.event

            let agentState = next.get(agentId)
            if (!agentState) {
              agentState = {
                agent_id: agentId,
                status: 'running',
                sessions: [],
              }
            } else {
              agentState = { ...agentState, sessions: [...agentState.sessions] }
            }

            let sessionIdx = agentState.sessions.findIndex((s) => s.session_id === sessionId)
            let session: DashboardSessionState

            if (sessionIdx === -1) {
              // Unknown session — create new entry
              session = {
                session_id: sessionId,
                title: '',
                status: 'running',
                tool_call_count: 0,
                current_tool: null,
                text_preview: '',
                input_tokens: 0,
                output_tokens: 0,
                started_at: Date.now(),
                recent_tool_calls: [],
              }
              agentState.sessions.push(session)
              sessionIdx = agentState.sessions.length - 1
            } else {
              session = { ...agentState.sessions[sessionIdx] }
              agentState.sessions[sessionIdx] = session
            }

            // Apply update based on inner event type
            if (innerEvent.type === 'hook_event') {
              if (innerEvent.hookEvent === 'PreToolUse') {
                session.current_tool = innerEvent.toolName ?? null
                session.tool_call_count += 1
                session.status = 'running'
                session.recent_tool_calls = [
                  ...session.recent_tool_calls,
                  {
                    name: innerEvent.toolName ?? 'unknown',
                    status: 'running',
                    input: innerEvent.toolInput,
                  },
                ]
              } else if (innerEvent.hookEvent === 'PostToolUse') {
                session.current_tool = null
                // Update last tool's status
                if (session.recent_tool_calls.length > 0) {
                  const updated = [...session.recent_tool_calls]
                  const lastTool = { ...updated[updated.length - 1] }
                  lastTool.status = innerEvent.toolStatus ?? 'complete'
                  updated[updated.length - 1] = lastTool
                  session.recent_tool_calls = updated
                }
              } else if (innerEvent.hookEvent === 'Stop') {
                session.status = 'completed'
                session.current_tool = null
              }
            } else if (innerEvent.type === 'text_chunk') {
              const content = innerEvent.content ?? ''
              const current = session.text_preview + content
              session.text_preview = current.slice(-200)
            } else if (innerEvent.type === 'context_update') {
              session.input_tokens = innerEvent.inputTokens ?? session.input_tokens
              session.output_tokens = innerEvent.outputTokens ?? session.output_tokens
            }

            // Derive agent-level status from sessions
            const hasRunning = agentState.sessions.some((s) => s.status === 'running')
            const hasError = agentState.sessions.some((s) => s.status === 'error')
            const allCompleted = agentState.sessions.length > 0 && agentState.sessions.every((s) => s.status === 'completed')
            if (hasRunning) {
              agentState.status = 'running'
            } else if (hasError) {
              agentState.status = 'error'
            } else if (allCompleted) {
              agentState.status = 'completed'
            } else {
              agentState.status = 'idle'
            }

            next.set(agentId, agentState)
            return next
          })
          break
        }

        default:
          console.warn('[Dashboard WS] Unknown message type:', data)
      }
    } catch (error) {
      console.error('[Dashboard WS] Failed to parse message:', error)
    }
  }, [])

  // Connect to WebSocket
  const connect = useCallback(() => {
    // Clean up existing connection
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }

    const wsUrl = withAtlasApiKey(`${getWebSocketUrl()}/ws/dashboard`)
    const ws = new WebSocket(wsUrl)

    ws.onopen = () => {
      console.log('[Dashboard WS] Connected:', wsUrl)
      setConnected(true)
      reconnectAttemptRef.current = 0
    }

    ws.onclose = (event) => {
      console.log('[Dashboard WS] Closed:', event.code, event.reason)
      setConnected(false)
      wsRef.current = null

      // Don't reconnect if closed cleanly (code 1000)
      if (event.code !== 1000) {
        reconnectAttemptRef.current += 1
        const delay = getReconnectDelay()
        console.log(`[Dashboard WS] Reconnecting in ${Math.round(delay / 1000)}s (attempt ${reconnectAttemptRef.current})`)

        reconnectTimeoutRef.current = setTimeout(() => {
          connect()
        }, delay)
      }
    }

    ws.onerror = (error) => {
      console.error('[Dashboard WS] Error:', error)
    }

    ws.onmessage = handleMessage

    wsRef.current = ws
  }, [getReconnectDelay, handleMessage])

  // Connect on mount, clean up on unmount
  useEffect(() => {
    connect()

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }
      if (wsRef.current) {
        console.log('[Dashboard WS] Unmounting, closing WebSocket')
        wsRef.current.close(1000, 'Component unmounting')
        wsRef.current = null
      }
    }
  }, [connect])

  return {
    connected,
    agentStates,
  }
}
