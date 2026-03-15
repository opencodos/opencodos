import { useState, useEffect, useRef, useCallback } from 'react'
import type { Agent } from '@/types'
import type { DashboardAgentState, DashboardSessionState, DashboardAgentStatus } from '@/types/agents'
import {
  Wrench,
  FlaskConical,
  User,
  PenTool,
  Briefcase,
  Bot,
  Terminal,
  ChevronRight,
  ChevronDown,
  CheckCircle2,
  Loader2,
  AlertCircle,
} from 'lucide-react'

// --- Reuse color/icon maps from AgentSidebar ---

const COLOR_MAP: Record<string, { bg: string; bgActive: string; text: string; dot: string; border: string; cardBg: string }> = {
  blue:   { bg: 'bg-blue-500/10',   bgActive: 'bg-blue-500/20',   text: 'text-blue-400',   dot: 'bg-blue-400',   border: 'border-blue-500/30',   cardBg: 'bg-blue-500/5' },
  purple: { bg: 'bg-purple-500/10', bgActive: 'bg-purple-500/20', text: 'text-purple-400', dot: 'bg-purple-400', border: 'border-purple-500/30', cardBg: 'bg-purple-500/5' },
  green:  { bg: 'bg-green-500/10',  bgActive: 'bg-green-500/20',  text: 'text-green-400',  dot: 'bg-green-400',  border: 'border-green-500/30',  cardBg: 'bg-green-500/5' },
  pink:   { bg: 'bg-pink-500/10',   bgActive: 'bg-pink-500/20',   text: 'text-pink-400',   dot: 'bg-pink-400',   border: 'border-pink-500/30',   cardBg: 'bg-pink-500/5' },
  cyan:   { bg: 'bg-cyan-500/10',   bgActive: 'bg-cyan-500/20',   text: 'text-cyan-400',   dot: 'bg-cyan-400',   border: 'border-cyan-500/30',   cardBg: 'bg-cyan-500/5' },
  orange: { bg: 'bg-orange-500/10', bgActive: 'bg-orange-500/20', text: 'text-orange-400', dot: 'bg-orange-400', border: 'border-orange-500/30', cardBg: 'bg-orange-500/5' },
}

const DEFAULT_COLOR = COLOR_MAP.orange

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  wrench: Wrench,
  'flask-conical': FlaskConical,
  user: User,
  'pen-tool': PenTool,
  briefcase: Briefcase,
  bot: Bot,
  terminal: Terminal,
}

function getAgentColor(color: string) {
  return COLOR_MAP[color] ?? DEFAULT_COLOR
}

function getAgentIcon(icon: string) {
  const IconComponent = ICON_MAP[icon] ?? Bot
  return <IconComponent className="w-4 h-4" />
}

// --- Status Indicator (matches AgentSidebar) ---

function AgentStatusIndicator({ status }: { status: DashboardAgentStatus }) {
  if (status === 'running') {
    return (
      <span className="flex items-center gap-0.5 text-orange-400" title="Running">
        <span className="w-1 h-1 rounded-full bg-orange-400 animate-bounce" style={{ animationDelay: '0ms' }} />
        <span className="w-1 h-1 rounded-full bg-orange-400 animate-bounce" style={{ animationDelay: '150ms' }} />
        <span className="w-1 h-1 rounded-full bg-orange-400 animate-bounce" style={{ animationDelay: '300ms' }} />
      </span>
    )
  }
  if (status === 'completed') {
    return (
      <span className="text-green-400" title="Completed">
        <CheckCircle2 className="w-3.5 h-3.5" />
      </span>
    )
  }
  if (status === 'error') {
    return (
      <span className="text-red-400" title="Error">
        <AlertCircle className="w-3.5 h-3.5" />
      </span>
    )
  }
  return <span className="w-2 h-2 rounded-sm bg-gray-600" title="Idle" />
}

// --- Status label ---

function statusLabel(status: DashboardAgentStatus): string {
  switch (status) {
    case 'running': return 'Running'
    case 'completed': return 'Done'
    case 'error': return 'Error'
    default: return 'Idle'
  }
}

// --- Token formatter (matches ChatArea) ---

function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

// --- Elapsed time formatter ---

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`
}

// --- Relative time formatter ---

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

// --- Tool status icon ---

function ToolStatusIcon({ status }: { status: string }) {
  if (status === 'running' || status === 'pending') {
    return <Loader2 className="w-3 h-3 animate-spin text-orange-400 shrink-0" />
  }
  if (status === 'error') {
    return <AlertCircle className="w-3 h-3 text-red-400 shrink-0" />
  }
  return <CheckCircle2 className="w-3 h-3 text-green-500 shrink-0" />
}

// --- Main Component ---

interface AgentStatusCardProps {
  agent: Agent
  state: DashboardAgentState | undefined
  lastSession?: { title: string; updated_at: string } | null
  onNavigateToChat: (agentId: string, sessionId?: string) => void
}

export function AgentStatusCard({ agent, state, lastSession, onNavigateToChat }: AgentStatusCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const agentStatus: DashboardAgentStatus = state?.status ?? 'idle'
  const color = getAgentColor(agent.color)

  // Find the latest running session (or most recent session)
  const runningSession: DashboardSessionState | undefined = state?.sessions?.find(s => s.status === 'running')
    ?? state?.sessions?.[0]

  // Elapsed timer: tick every second when running
  useEffect(() => {
    if (agentStatus !== 'running' || !runningSession?.started_at) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset timer
      setElapsed(0)
      return
    }

    const update = () => setElapsed(Date.now() - runningSession.started_at!)
    update()
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [agentStatus, runningSession?.started_at])

  // Click: toggle expanded. Double-click: navigate to chat.
  const handleClick = useCallback(() => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current)
      clickTimerRef.current = null
      // Double click
      onNavigateToChat(agent.id, runningSession?.session_id)
      return
    }
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null
      setExpanded(prev => !prev)
    }, 250)
  }, [agent.id, runningSession?.session_id, onNavigateToChat])

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current)
    }
  }, [])

  const isRunning = agentStatus === 'running'
  const isCompleted = agentStatus === 'completed'
  const isIdle = agentStatus === 'idle'
  const recentToolCalls = runningSession?.recent_tool_calls?.slice(-5) ?? []
  const totalTokens = (runningSession?.input_tokens ?? 0) + (runningSession?.output_tokens ?? 0)

  return (
    <div
      onClick={handleClick}
      className={`rounded-xl border transition-all cursor-pointer ${
        isRunning
          ? `${color.border} ${color.cardBg}`
          : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.04]'
      }`}
    >
      {/* Collapsed content (always visible) */}
      <div className="p-4">
        {/* Row 1: Icon + Name + Status + Chevron */}
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${isRunning ? color.bgActive : color.bg}`}>
            <span className={isRunning ? color.text : 'text-gray-400'}>
              {getAgentIcon(agent.icon)}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className={`text-sm font-medium ${isRunning ? 'text-white' : 'text-gray-300'}`}>
                {agent.name}
              </span>
              <AgentStatusIndicator status={agentStatus} />
              <span className={`text-[10px] font-medium uppercase tracking-wider ${
                isRunning ? 'text-orange-400' : isCompleted ? 'text-green-400' : agentStatus === 'error' ? 'text-red-400' : 'text-gray-500'
              }`}>
                {statusLabel(agentStatus)}
              </span>
            </div>
            <span className="text-xs text-gray-500 truncate block">{agent.role}</span>
          </div>
          {expanded
            ? <ChevronDown className="w-4 h-4 text-gray-500 shrink-0" />
            : <ChevronRight className="w-4 h-4 text-gray-500 shrink-0" />
          }
        </div>

        {/* Row 2: Rich collapsed info based on status */}
        {isRunning && runningSession && (
          <div className="mt-3 space-y-2">
            {runningSession.title && (
              <p className="text-xs text-gray-300 truncate italic">
                &ldquo;{runningSession.title}&rdquo;
              </p>
            )}
            {runningSession.current_tool && (
              <div className="flex items-center gap-1.5 text-xs">
                <Wrench className="w-3 h-3 text-orange-400 shrink-0" />
                <span className="text-gray-400 truncate">
                  {runningSession.current_tool}
                  {runningSession.recent_tool_calls?.length > 0 && runningSession.recent_tool_calls[runningSession.recent_tool_calls.length - 1]?.input?.file_path
                    ? ` | ${String(runningSession.recent_tool_calls[runningSession.recent_tool_calls.length - 1].input!.file_path).split('/').pop()}`
                    : ''}
                </span>
              </div>
            )}
            {/* Activity pulse bar */}
            <div className="h-1 bg-white/10 rounded-full overflow-hidden">
              <div className="h-full bg-orange-500/60 rounded-full animate-pulse" style={{ width: '60%' }} />
            </div>
            <div className="flex items-center gap-3 text-[11px] text-gray-500">
              <span className="font-mono">{formatElapsed(elapsed)}</span>
              <span className="text-gray-600">|</span>
              <span>{runningSession.tool_call_count} tools</span>
              {totalTokens > 0 && (
                <>
                  <span className="text-gray-600">|</span>
                  <span className="font-mono">{fmtTokens(totalTokens)} tokens</span>
                </>
              )}
            </div>
          </div>
        )}

        {isCompleted && runningSession && (
          <div className="mt-3 space-y-1.5">
            {runningSession.title && (
              <p className="text-xs text-gray-300 truncate italic">
                &ldquo;{runningSession.title}&rdquo;
              </p>
            )}
            <div className="flex items-center gap-3 text-[11px] text-gray-500">
              {runningSession.started_at && (
                <span>Finished {formatRelativeTime(new Date(runningSession.started_at).toISOString())}</span>
              )}
              <span className="text-gray-600">|</span>
              <span>{runningSession.tool_call_count} tools</span>
              {totalTokens > 0 && (
                <>
                  <span className="text-gray-600">|</span>
                  <span className="font-mono">{fmtTokens(totalTokens)} tokens</span>
                </>
              )}
            </div>
          </div>
        )}

        {isIdle && (
          <div className="mt-3">
            {lastSession ? (
              <p className="text-xs text-gray-500 truncate">
                Last: &ldquo;{lastSession.title}&rdquo; | {formatRelativeTime(lastSession.updated_at)}
              </p>
            ) : (
              <p className="text-xs text-gray-600">No sessions yet</p>
            )}
          </div>
        )}
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-white/5 px-4 py-3 space-y-3">
          {/* Recent tool calls */}
          {recentToolCalls.length > 0 ? (
            <div className="space-y-1.5">
              {recentToolCalls.map((tool, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <ToolStatusIcon status={tool.status} />
                  <span className={tool.status === 'running' ? 'text-gray-300' : 'text-gray-500'}>
                    {tool.name}
                  </span>
                  {tool.status === 'running' && (
                    <span className="text-orange-400/60 text-[10px]">(running)</span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-600">No active sessions</p>
          )}

          {/* Text preview */}
          {runningSession?.text_preview && (
            <div className="bg-white/5 rounded-lg px-3 py-2">
              <p className="text-xs text-gray-400 line-clamp-3">
                &ldquo;{runningSession.text_preview}&rdquo;
              </p>
            </div>
          )}

          {/* Open Chat button */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              onNavigateToChat(agent.id, runningSession?.session_id)
            }}
            className={`text-xs font-medium ${color.text} hover:underline`}
          >
            Open Chat &rarr;
          </button>
        </div>
      )}
    </div>
  )
}
