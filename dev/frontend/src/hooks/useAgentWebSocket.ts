import { useState, useEffect, useCallback, useRef } from 'react'
import { getDesktopAtlasApiKey } from '@/lib/desktopRuntimeBootstrap'

// ==================== Types ====================

export interface HookEvent {
  type: 'hook_event'
  hookEvent: 'PreToolUse' | 'PostToolUse' | 'Notification' | 'Stop' | 'Error'
  timestamp: string
  toolUseId?: string  // Unique ID from Claude for matching Pre/PostToolUse
  toolName?: string
  toolInput?: Record<string, unknown>
  toolResponse?: unknown
  toolStatus?: 'complete' | 'error'  // Status from PostToolUse
  message?: string
  notificationType?: string
  toolCalls?: Array<{
    name: string
    input: Record<string, unknown>
    output?: unknown
    status: string
  }>
}

export interface TextChunk {
  type: 'text_chunk'
  content: string
  timestamp: number
}

export interface PermissionRequest {
  type: 'permission_request'
  toolUseId: string
  toolName: string
  toolInput: Record<string, unknown>
}

export interface ContextUsage {
  inputTokens: number
  outputTokens: number
  contextLimit: number
  model: string
}

interface ContextUpdateMessage {
  type: 'context_update'
  inputTokens: number
  outputTokens: number
  contextLimit: number
  model: string
  timestamp: number
}

export interface MessageAttachment {
  attachment_id: string
  name: string
  path: string
  mime: string
  size: number
}

interface AckMessage {
  type: 'ack'
  messageId: string
  status: 'received' | 'processing' | 'complete' | 'error'
  error?: string
}

interface TitleUpdateMessage {
  type: 'title_update'
  session_id: string
  title: string
}

type WebSocketMessage = HookEvent | TextChunk | PermissionRequest | ContextUpdateMessage | AckMessage | TitleUpdateMessage

interface OutgoingMessage {
  type: 'message'
  content: string
  attachments?: MessageAttachment[]
  agent_id?: string
  message_id: string
}

interface PermissionResponse {
  type: 'permission_response'
  tool_use_id: string
  approved: boolean
  reason?: string
}

export interface UseAgentWebSocketReturn {
  connected: boolean
  events: HookEvent[]
  textChunks: TextChunk[]
  pendingPermission: PermissionRequest | null
  contextUsage: ContextUsage | null
  sendMessage: (content: string, agentId?: string, attachments?: MessageAttachment[]) => void
  respondToPermission: (toolUseId: string, approved: boolean, reason?: string) => void
  stopAgent: () => void
  clearEvents: () => void
}

// ==================== Configuration ====================

function safeUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

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
  // In desktop mode, always use runtime-selected backend port first.
  const desktopRuntimeUrl = getDesktopRuntimeWebSocketUrl()
  if (desktopRuntimeUrl) {
    return desktopRuntimeUrl
  }

  // Check for environment variable first
  const envUrl = import.meta.env.VITE_WS_BASE_URL
  if (envUrl) {
    return envUrl
  }

  // Derive from API base URL if available
  const apiUrl = import.meta.env.VITE_API_BASE_URL
  if (apiUrl) {
    // Convert http(s) to ws(s)
    return apiUrl.replace(/^http/, 'ws')
  }

  // Default fallback
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

// ==================== Hook Implementation ====================

export function useAgentWebSocket(sessionId: string | null): UseAgentWebSocketReturn {
  const [connected, setConnected] = useState(false)
  const [events, setEvents] = useState<HookEvent[]>([])
  const [textChunks, setTextChunks] = useState<TextChunk[]>([])
  const [pendingPermission, setPendingPermission] = useState<PermissionRequest | null>(null)
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectAttemptRef = useRef(0)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sessionIdRef = useRef(sessionId)
  const pendingMessageRef = useRef<{ content: string; agentId?: string; attachments?: MessageAttachment[] } | null>(null)

  // Keep sessionId ref in sync
  useEffect(() => {
    sessionIdRef.current = sessionId
  }, [sessionId])

  // Calculate reconnect delay with exponential backoff
  const getReconnectDelay = useCallback(() => {
    const baseDelay = 1000 // 1 second
    const maxDelay = 30000 // 30 seconds
    const attempt = reconnectAttemptRef.current
    const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay)
    // Add jitter (0-25% of delay)
    return delay + Math.random() * delay * 0.25
  }, [])

  // Handle incoming WebSocket messages
  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data) as WebSocketMessage

      switch (data.type) {
        case 'hook_event':
          setEvents((prev) => [...prev, data])
          break

        case 'text_chunk':
          setTextChunks((prev) => [...prev, data])
          break

        case 'permission_request':
          setPendingPermission(data)
          break

        case 'context_update':
          setContextUsage({
            inputTokens: (data as ContextUpdateMessage).inputTokens,
            outputTokens: (data as ContextUpdateMessage).outputTokens,
            contextLimit: (data as ContextUpdateMessage).contextLimit,
            model: (data as ContextUpdateMessage).model,
          })
          break

        case 'title_update':
          // Session was auto-named — notify sidebar via custom event
          window.dispatchEvent(new CustomEvent('session-title-update', {
            detail: { sessionId: (data as TitleUpdateMessage).session_id, title: (data as TitleUpdateMessage).title }
          }))
          break

        case 'ack':
          // Ack messages can be used for debugging or tracking message delivery
          // Currently just log them
          if (data.status === 'error') {
            console.error('WebSocket message error:', data.error)
          }
          break

        default:
          console.warn('Unknown WebSocket message type:', data)
      }
    } catch (error) {
      console.error('Failed to parse WebSocket message:', error)
    }
  }, [])

  // Connect to WebSocket
  const connect = useCallback(() => {
    const currentSessionId = sessionIdRef.current
    if (!currentSessionId) return

    // Clean up existing connection
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }

    const wsUrl = withAtlasApiKey(`${getWebSocketUrl()}/ws/agent/${currentSessionId}`)
    const ws = new WebSocket(wsUrl)

    ws.onopen = () => {
      console.log('[WS Hook] WebSocket connected:', wsUrl)
      console.log('[WS Hook] Setting connected = true')
      setConnected(true)
      reconnectAttemptRef.current = 0 // Reset reconnect attempts on successful connection

      // Send any pending message
      if (pendingMessageRef.current && ws.readyState === WebSocket.OPEN) {
        const { content, agentId, attachments } = pendingMessageRef.current
        const message = {
          type: 'message',
          content,
          attachments,
          agent_id: agentId,
          message_id: safeUUID(),
        }
        console.log('[WS Hook] Sending pending message:', message)
        ws.send(JSON.stringify(message))
        pendingMessageRef.current = null
      }
    }

    ws.onclose = (event) => {
      console.log('[WS Hook] WebSocket closed:', event.code, event.reason)
      console.log('[WS Hook] Setting connected = false')
      setConnected(false)
      wsRef.current = null

      // Don't reconnect if closed cleanly (code 1000) or if session changed
      if (event.code !== 1000 && sessionIdRef.current === currentSessionId) {
        reconnectAttemptRef.current += 1
        const delay = getReconnectDelay()
        console.log(`Reconnecting in ${Math.round(delay / 1000)}s (attempt ${reconnectAttemptRef.current})`)

        reconnectTimeoutRef.current = setTimeout(() => {
          if (sessionIdRef.current === currentSessionId) {
            connect()
          }
        }, delay)
      }
    }

    ws.onerror = (error) => {
      console.error('WebSocket error:', error)
    }

    ws.onmessage = handleMessage

    wsRef.current = ws
  }, [getReconnectDelay, handleMessage])

  // Ref to track current sessionId for stable connection management
  const currentSessionRef = useRef<string | null>(null)

  // Connect on mount when sessionId is provided
  useEffect(() => {
    // Only reconnect if sessionId actually changed
    if (sessionId === currentSessionRef.current) {
      return
    }

    // Close previous connection if sessionId changed
    if (wsRef.current && currentSessionRef.current !== null) {
      console.log('[WS Hook] SessionId changed, closing old connection')
      wsRef.current.close(1000, 'Session changed')
      wsRef.current = null
    }

    currentSessionRef.current = sessionId

    if (sessionId) {
      connect()
    }

    // Cleanup on unmount only
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }
    }
  }, [sessionId, connect])

  // Separate cleanup effect for unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        console.log('[WS Hook] Component unmounting, closing WebSocket')
        wsRef.current.close(1000, 'Component unmounting')
        wsRef.current = null
      }
    }
  }, [])

  // Send a message to the agent
  const sendMessage = useCallback((content: string, agentId?: string, attachments?: MessageAttachment[]) => {
    console.log('[WS Hook] sendMessage called', { content, agentId, attachments: attachments?.length || 0, wsRef: !!wsRef.current, readyState: wsRef.current?.readyState })

    // If WebSocket not ready, queue the message for when it connects
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.log('[WS Hook] WebSocket not ready, queuing message')
      pendingMessageRef.current = { content, agentId, attachments }
      return
    }

    const message: OutgoingMessage = {
      type: 'message',
      content,
      attachments,
      agent_id: agentId,
      message_id: safeUUID(),
    }

    console.log('[WS Hook] Sending message:', message)
    wsRef.current.send(JSON.stringify(message))
    console.log('[WS Hook] Message sent successfully')
  }, [])

  // Respond to a permission request
  const respondToPermission = useCallback(
    (toolUseId: string, approved: boolean, reason?: string) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        console.error('WebSocket not connected')
        return
      }

      const response: PermissionResponse = {
        type: 'permission_response',
        tool_use_id: toolUseId,
        approved,
        reason,
      }

      wsRef.current.send(JSON.stringify(response))

      // Clear pending permission after responding
      setPendingPermission(null)
    },
    []
  )

  // Stop the currently running agent
  const stopAgent = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.warn('[WS Hook] Cannot stop - WebSocket not connected')
      return
    }

    console.log('[WS Hook] Sending stop signal')
    wsRef.current.send(JSON.stringify({ type: 'stop' }))
  }, [])

  // Clear all events and text chunks
  const clearEvents = useCallback(() => {
    setEvents([])
    setTextChunks([])
    setPendingPermission(null)
  }, [])

  return {
    connected,
    events,
    textChunks,
    pendingPermission,
    contextUsage,
    sendMessage,
    respondToPermission,
    stopAgent,
    clearEvents,
  }
}
