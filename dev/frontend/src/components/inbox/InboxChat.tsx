import { useState, useRef, useEffect, useCallback } from 'react'
import { Send, Loader2, ChevronDown, ChevronUp, MessageSquare } from 'lucide-react'
import { agentSessionsAPI, inboxAPI } from '@/lib/api'
import { useAgentWebSocket } from '@/hooks/useAgentWebSocket'

const SESSION_KEY_PREFIX = 'inbox-chat-session-'
const AGENT_ID = 'engineer'

interface InboxChatProps {
  filename: string
  chatName: string
  isOpen: boolean
  onToggle: () => void
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
}

function getStoredSessionId(filename: string): string | null {
  try {
    return localStorage.getItem(`${SESSION_KEY_PREFIX}${filename}`) || null
  } catch {
    return null
  }
}

function storeSessionId(filename: string, sessionId: string) {
  localStorage.setItem(`${SESSION_KEY_PREFIX}${filename}`, sessionId)
}

export function InboxChat({ filename, chatName, isOpen, onToggle }: InboxChatProps) {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(() => getStoredSessionId(filename))
  const [contextLoaded, setContextLoaded] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const currentAssistantIdRef = useRef<string | null>(null)
  const accumulatedContentRef = useRef<string>('')
  const initializingRef = useRef(false)
  const processedChunksRef = useRef(0)
  const processedEventsRef = useRef(0)
  const initializedRef = useRef(false)
  const contextRef = useRef<string>('')

  const {
    connected,
    textChunks,
    events,
    sendMessage: wsSendMessage,
    clearEvents,
  } = useAgentWebSocket(sessionId)

  // Reset when filename changes
  useEffect(() => {
    const stored = getStoredSessionId(filename)
    setSessionId(stored)
    setChatMessages([])
    setIsStreaming(false)
    setContextLoaded(false)
    currentAssistantIdRef.current = null
    accumulatedContentRef.current = ''
    contextRef.current = ''
    processedChunksRef.current = 0
    processedEventsRef.current = 0
    initializedRef.current = false
    initializingRef.current = false
    clearEvents()
  }, [filename, clearEvents])

  // Create session on first open if none exists
  useEffect(() => {
    if (!isOpen || sessionId || initializingRef.current) return

    initializingRef.current = true
    const createSession = async () => {
      try {
        const session = await agentSessionsAPI.createSession(`Inbox: ${chatName}`, AGENT_ID)
        if (session?.id) {
          setSessionId(session.id)
          storeSessionId(filename, session.id)
        }
      } catch (error) {
        console.error('[InboxChat] Failed to create session:', error)
      } finally {
        initializingRef.current = false
      }
    }
    createSession()
  }, [isOpen, sessionId, filename, chatName])

  // Fetch conversation context and load saved messages when opened
  useEffect(() => {
    if (!isOpen || contextLoaded) return

    const fetchContext = async () => {
      try {
        const data = await inboxAPI.getMessages(filename)
        const recent = (data.messages || []).slice(-10)
        if (recent.length > 0) {
          const lines = recent.map(m => `[${m.date} ${m.time}] ${m.sender}: ${m.text}`)
          contextRef.current = `Here are the recent messages from "${chatName}":\n\n${lines.join('\n')}\n\n`
        }
      } catch (error) {
        console.error('[InboxChat] Failed to fetch context:', error)
      }

      // Load saved chat messages from DB (handles WS disconnections where response was saved)
      if (sessionId) {
        try {
          const saved = await agentSessionsAPI.getMessages(sessionId)
          if (saved.length > 0) {
            const restored: ChatMessage[] = saved.map((m, i) => ({
              id: m.id || `restored-${i}`,
              role: m.role as 'user' | 'assistant',
              content: m.content,
            }))
            setChatMessages(restored)
            initializedRef.current = true
          }
        } catch (error) {
          console.error('[InboxChat] Failed to load saved messages:', error)
        }
      }

      setContextLoaded(true)
    }
    fetchContext()
  }, [isOpen, contextLoaded, filename, chatName, sessionId])

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [isOpen])

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [chatMessages])

  // Skip initial events on mount
  useEffect(() => {
    if (!initializedRef.current) {
      processedChunksRef.current = textChunks.length
      processedEventsRef.current = events.length
      initializedRef.current = true
    }
  }, [textChunks.length, events.length])

  // Process text chunks
  useEffect(() => {
    if (!initializedRef.current) return
    const newChunks = textChunks.slice(processedChunksRef.current)
    for (const chunk of newChunks) {
      accumulatedContentRef.current += chunk.content
      if (currentAssistantIdRef.current) {
        const content = accumulatedContentRef.current
        setChatMessages(prev => prev.map(msg =>
          msg.id === currentAssistantIdRef.current ? { ...msg, content } : msg
        ))
      }
    }
    processedChunksRef.current = textChunks.length
  }, [textChunks])

  // Process hook events (Stop/Error)
  useEffect(() => {
    if (!initializedRef.current) return
    const newEvents = events.slice(processedEventsRef.current)
    for (const event of newEvents) {
      if (event.hookEvent === 'Stop' || event.hookEvent === 'Error') {
        setIsStreaming(false)
        currentAssistantIdRef.current = null
        accumulatedContentRef.current = ''
      }
    }
    processedEventsRef.current = events.length
  }, [events])

  const handleSend = useCallback(() => {
    const trimmed = input.trim()
    if (!trimmed || isStreaming || !sessionId || !connected) return

    // First message gets conversation context prepended
    const isFirst = chatMessages.length === 0
    const content = isFirst && contextRef.current
      ? `${contextRef.current}${trimmed}`
      : trimmed

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
    }

    const assistantId = `assistant-${Date.now()}`
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
    }

    setChatMessages(prev => [...prev, userMsg, assistantMsg])
    currentAssistantIdRef.current = assistantId
    accumulatedContentRef.current = ''
    clearEvents()
    wsSendMessage(content, AGENT_ID)
    setInput('')
    setIsStreaming(true)
  }, [input, isStreaming, sessionId, connected, chatMessages.length, clearEvents, wsSendMessage])

  if (!isOpen) {
    return (
      <button
        onClick={onToggle}
        className="flex items-center gap-2 px-4 py-2 border-t border-white/10 bg-white/[0.02] hover:bg-white/[0.05] transition-colors w-full text-left"
      >
        <MessageSquare className="w-3.5 h-3.5 text-orange-400" />
        <span className="text-xs font-medium text-orange-400">Ask Codos</span>
        <ChevronUp className="w-3.5 h-3.5 text-[#737373] ml-auto" />
      </button>
    )
  }

  return (
    <div className="flex flex-col border-t border-white/10 bg-[#0a0a0f]" style={{ height: '320px' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-white/[0.02] shrink-0">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-3.5 h-3.5 text-orange-400" />
          <span className="text-xs font-medium text-[#fafafa]">Codos</span>
          {!connected && (
            <span className="text-[10px] text-red-400">disconnected</span>
          )}
        </div>
        <button onClick={onToggle} className="text-[#737373] hover:text-[#fafafa] transition-colors">
          <ChevronDown className="w-4 h-4" />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
        {chatMessages.length === 0 && (
          <p className="text-xs text-[#525252] text-center py-4">
            Ask a question about this conversation
          </p>
        )}
        {chatMessages.map(msg => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed ${
              msg.role === 'user'
                ? 'bg-orange-500/20 text-white'
                : 'bg-white/[0.05] text-gray-300'
            }`}>
              <span className="whitespace-pre-wrap">{msg.content || (isStreaming ? '...' : '')}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="px-3 py-2 border-t border-white/10 shrink-0">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
            placeholder={connected ? 'Ask about this conversation...' : 'Connecting...'}
            disabled={!connected || isStreaming}
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-[#fafafa] placeholder:text-[#525252] focus:outline-none focus:border-orange-500/30 disabled:opacity-50"
          />
          {isStreaming ? (
            <Loader2 className="w-4 h-4 text-orange-400 animate-spin shrink-0" />
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim() || !connected}
              className="p-1.5 bg-orange-500/20 hover:bg-orange-500/30 disabled:bg-white/5 disabled:text-[#525252] text-orange-400 rounded-lg transition shrink-0"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
