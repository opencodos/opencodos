import { useState, useEffect } from 'react'
import type { Agent, Session } from '@/types'
import { agentSessionsAPI } from '@/lib/api'
import { useDashboardWebSocket } from '@/hooks/useDashboardWebSocket'
import { AgentStatusCard } from './AgentStatusCard'

// Claude Code as a hardcoded "agent" config for the dashboard grid
const CLAUDE_CODE_AGENT: Agent = {
  id: 'claude',
  name: 'Claude Code',
  role: 'General-purpose coding assistant',
  icon: 'terminal',
  color: 'orange',
  skills: [],
}

interface AgentDashboardViewProps {
  agents: Agent[]
  onNavigateToChat: (agentId: string, sessionId?: string) => void
}

export function AgentDashboardView({ agents, onNavigateToChat }: AgentDashboardViewProps) {
  const { connected, agentStates } = useDashboardWebSocket()
  const [sessions, setSessions] = useState<Session[]>([])

  // Fetch sessions on mount for lastSession data on idle agents
  useEffect(() => {
    agentSessionsAPI.getSessions().then(setSessions).catch(() => {})
  }, [])

  // Merge Claude Code first, then config agents (dedupe if backend also returns 'claude')
  const allAgents = [CLAUDE_CODE_AGENT, ...agents.filter(a => a.id !== 'claude')]

  return (
    <div className="flex-1 overflow-y-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-white">Agent Dashboard</h2>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="text-xs text-gray-400">
            {connected ? 'Live' : 'Connecting...'}
          </span>
        </div>
      </div>

      {/* Agent Grid — 2 columns max for better card width */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {allAgents.map((agent) => {
          const lastSession = sessions
            .filter(s => s.agent_id === agent.id)
            .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())[0]

          return (
            <AgentStatusCard
              key={agent.id}
              agent={agent}
              state={agentStates.get(agent.id)}
              lastSession={lastSession ? { title: lastSession.title, updated_at: lastSession.updated_at } : null}
              onNavigateToChat={onNavigateToChat}
            />
          )
        })}
      </div>
    </div>
  )
}
