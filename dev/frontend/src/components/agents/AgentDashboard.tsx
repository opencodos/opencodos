import { useState, useEffect } from 'react'
import { AgentSidebar } from './AgentSidebar'
import { ChatArea } from './ChatArea'
import { AgentDashboardView } from './AgentDashboardView'
import { ContextPanel } from './ContextPanel'
import { AgentProfilePanel } from './AgentProfilePanel'
import { agentConfigAPI } from '@/lib/api'
import type { Agent } from '@/types'
import { Settings, Plus, BarChart3, Sparkles, Activity } from 'lucide-react'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8767'

const COLOR_RGB_MAP: Record<string, string> = {
  blue: '59, 130, 246',
  purple: '168, 85, 247',
  green: '34, 197, 94',
  pink: '236, 72, 153',
  cyan: '6, 182, 212',
  orange: '249, 115, 22',
}

export function AgentDashboard() {
  const [activeAgent, setActiveAgent] = useState('dashboard')
  const [rightPanelOpen, setRightPanelOpen] = useState(true)
  const [isThinking] = useState(true) // Demo: AI is working
  const [chatKeys, setChatKeys] = useState<Record<string, number>>({}) // Per-agent keys for remount
  const [healthStatus, setHealthStatus] = useState<{ healthy: boolean; failing: number } | null>(null)
  const [selectedAgentDetail, setSelectedAgentDetail] = useState<Agent | null>(null)
  const [mountedAgents, setMountedAgents] = useState<Set<string>>(new Set(['claude'])) // Lazy-mount: only mount ChatAreas for visited agents
  const [agents, setAgents] = useState<Agent[]>([])

  // Fetch agent list for rendering ChatAreas
  useEffect(() => {
    agentConfigAPI.getAgents().then(setAgents)
  }, [])

  // Lazy-mount: add agent to mounted set when first selected
  useEffect(() => {
    setMountedAgents(prev => {
      if (prev.has(activeAgent)) return prev
      return new Set([...prev, activeAgent])
    })
  }, [activeAgent])

  // Fetch agent detail when a non-claude agent is selected
  useEffect(() => {
    if (activeAgent === 'claude' || activeAgent === 'dashboard') {
      setSelectedAgentDetail(null)
      return
    }
    agentConfigAPI.getAgent(activeAgent)
      .then(setSelectedAgentDetail)
      .catch(() => setSelectedAgentDetail(null))
  }, [activeAgent])

  // Fetch health status on mount and every 30 seconds
  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/health/full`)
        if (response.ok) {
          const data = await response.json()
          setHealthStatus({
            healthy: data.summary.failing === 0,
            failing: data.summary.failing,
          })
        }
      } catch {
        setHealthStatus(null)
      }
    }

    fetchHealth()
    const interval = setInterval(fetchHealth, 30000)
    return () => clearInterval(interval)
  }, [])

  const handleNewChat = () => {
    // Clear stored session so ChatArea creates a fresh one
    localStorage.removeItem(`atlas-agent-session-${activeAgent}`)
    setChatKeys(prev => ({ ...prev, [activeAgent]: (prev[activeAgent] || 0) + 1 }))
  }

  const handleSessionSelect = (sessionId: string, agentId?: string) => {
    const targetAgent = agentId || activeAgent
    // Switch to the correct agent first
    if (targetAgent !== activeAgent) {
      setActiveAgent(targetAgent)
    }
    // Store the selected session ID so ChatArea loads it
    localStorage.setItem(`atlas-agent-session-${targetAgent}`, JSON.stringify({
      sessionId,
      agentId: targetAgent,
      timestamp: Date.now()
    }))
    setChatKeys(prev => ({ ...prev, [targetAgent]: (prev[targetAgent] || 0) + 1 }))
  }

  const refreshAgent = () => {
    if (activeAgent !== 'claude') {
      agentConfigAPI.getAgent(activeAgent)
        .then(setSelectedAgentDetail)
        .catch(() => setSelectedAgentDetail(null))
    }
  }

  const openDesktopSettings = () => {
    const targetHash = '#/desktop-settings'
    if (window.location.hash !== targetHash) {
      window.location.hash = '/desktop-settings'
      return
    }

    // Force route re-evaluation if already on the same hash.
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  }

  return (
    <div
      className="min-h-screen bg-mesh flex flex-col noise-overlay"
      style={{ '--agent-color': (selectedAgentDetail ? COLOR_RGB_MAP[selectedAgentDetail.color] : undefined) || COLOR_RGB_MAP.orange } as React.CSSProperties}
    >
      {/* Header */}
      <header className="h-14 border-b border-white/10 flex items-center justify-between px-4 shrink-0 reveal">
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-xl bg-black border border-white/10 flex items-center justify-center ${isThinking ? 'ai-active' : ''}`}>
            <span className="text-orange-500 font-mono font-bold text-xs">&gt;_</span>
          </div>
          <span className="text-white font-semibold text-lg tracking-tight">Codos</span>
          {isThinking && (
            <div className="flex items-center gap-2 px-2.5 py-1 bg-white/5 rounded-full">
              <Sparkles className="w-3.5 h-3.5 text-orange-400 animate-pulse" />
              <span className="text-xs text-gray-400">Working...</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => (window.location.hash = '/health')}
            className="flex items-center gap-2 px-3 py-1.5 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition"
            title="System Health"
          >
            <div className={`w-2 h-2 rounded-full ${
              healthStatus === null ? 'bg-gray-500' :
              healthStatus.healthy ? 'bg-green-500' : 'bg-red-500'
            }`} />
            <span className="text-sm">Health</span>
            <Activity className="w-4 h-4" />
          </button>
          <button className="p-2 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition">
            <BarChart3 className="w-5 h-5" />
          </button>
          <button
            onClick={openDesktopSettings}
            className="p-2 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition"
            title="Desktop Settings"
            aria-label="Open desktop settings"
          >
            <Settings className="w-5 h-5" />
          </button>
          <button
            onClick={handleNewChat}
            className="ml-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium rounded-xl flex items-center gap-2 transition shadow-lg shadow-orange-500/20"
          >
            <Plus className="w-4 h-4" />
            New Chat
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar */}
        <div className="reveal-delay-1">
          <AgentSidebar
            activeAgent={activeAgent}
            onAgentSelect={setActiveAgent}
            onNewChat={handleNewChat}
            onSessionSelect={handleSessionSelect}
          />
        </div>

        {/* Dashboard View */}
        {activeAgent === 'dashboard' && (
          <div className="flex-1 reveal-delay-2">
            <AgentDashboardView
              agents={agents}
              onNavigateToChat={(agentId, sessionId) => {
                setActiveAgent(agentId)
                if (sessionId) handleSessionSelect(sessionId)
              }}
            />
          </div>
        )}

        {/* Chat Areas — mounted per-agent, shown/hidden via CSS to keep WebSocket alive */}
        {[...mountedAgents].filter(id => id !== 'dashboard').map(agentId => (
          <div
            key={`${agentId}-${chatKeys[agentId] || 0}`}
            className={agentId === activeAgent ? 'flex-1 min-w-0 reveal-delay-2' : 'hidden'}
          >
            <ChatArea
              activeAgent={agentId}
              onAgentSelect={setActiveAgent}
            />
          </div>
        ))}

        {/* Right Panel */}
        {rightPanelOpen && (
          <div className="reveal-delay-3">
            {selectedAgentDetail ? (
              <AgentProfilePanel
                agent={selectedAgentDetail}
                onClose={() => setRightPanelOpen(false)}
                onSessionSelect={handleSessionSelect}
                onAgentUpdated={refreshAgent}
              />
            ) : (
              <ContextPanel onClose={() => setRightPanelOpen(false)} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
