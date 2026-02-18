import { useState, useEffect, useRef } from 'react'
import { agentSessionsAPI, agentConfigAPI } from '@/lib/api'
import type { Agent, Session } from '@/types'
import {
  Wrench,
  FlaskConical,
  User,
  Users,
  PenTool,
  Briefcase,
  Bot,
  Plus,
  MessageSquare,
  ChevronDown,
  ChevronRight,
  Plug,
  BookOpen,
  Clock,
  Terminal,
  Workflow,
  Folder,
  FolderOpen,
  FileText,
  File,
  Search,
  RefreshCw,
  ArrowRightLeft,
  Loader2,
  CheckCircle2,
  LayoutDashboard,
  Inbox,
} from 'lucide-react'
import { VaultFileViewerModal } from './VaultFileViewerModal'
import { CreateAgentModal } from './CreateAgentModal'
import { API_BASE_URL } from '@/lib/api'
import { authHeaders } from '@/lib/vaultAuth'

const COLOR_MAP: Record<string, { bg: string; bgActive: string; text: string; dot: string }> = {
  blue:   { bg: 'bg-blue-500/10',   bgActive: 'bg-blue-500/20',   text: 'text-blue-400',   dot: 'bg-blue-400' },
  purple: { bg: 'bg-purple-500/10', bgActive: 'bg-purple-500/20', text: 'text-purple-400', dot: 'bg-purple-400' },
  green:  { bg: 'bg-green-500/10',  bgActive: 'bg-green-500/20',  text: 'text-green-400',  dot: 'bg-green-400' },
  pink:   { bg: 'bg-pink-500/10',   bgActive: 'bg-pink-500/20',   text: 'text-pink-400',   dot: 'bg-pink-400' },
  cyan:   { bg: 'bg-cyan-500/10',   bgActive: 'bg-cyan-500/20',   text: 'text-cyan-400',   dot: 'bg-cyan-400' },
  orange: { bg: 'bg-orange-500/10', bgActive: 'bg-orange-500/20', text: 'text-orange-400', dot: 'bg-orange-400' },
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

function AgentStatusIndicator({ status }: { status: AgentStatus }) {
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
  // idle
  return <span className="w-2 h-2 rounded-sm bg-gray-600" title="Idle" />
}

export { COLOR_MAP }

const WORKSPACE = [
  { id: 'connectors', name: 'Connectors', icon: <Plug className="w-4 h-4" />, href: '#/connectors' },
  { id: 'skills', name: 'Skills', icon: <BookOpen className="w-4 h-4" />, href: '#/skills' },
  { id: 'schedules', name: 'Schedules', icon: <Clock className="w-4 h-4" />, href: '#/schedules' },
  { id: 'workflows', name: 'Workflows', icon: <Workflow className="w-4 h-4" />, href: '#/workflows' },
  { id: 'crm', name: 'CRM', icon: <Users className="w-4 h-4" />, href: '#/crm' },
]

type VaultEntry = {
  name: string
  path: string
  kind: 'file' | 'dir'
  extension?: string | null
}

type VaultTreeResponse = {
  path: string
  vault_path?: string
  vaultPath?: string
  entries: VaultEntry[]
}

type VaultSearchResponse = {
  query: string
  vault_path?: string
  vaultPath?: string
  matches: VaultEntry[]
}


// Helper to format relative time
function timeAgo(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000)

  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  if (seconds < 172800) return 'Yesterday'
  return `${Math.floor(seconds / 86400)} days ago`
}

interface AgentSidebarProps {
  activeAgent: string
  onAgentSelect: (id: string) => void
  onNewChat?: () => void
  onSessionSelect?: (sessionId: string) => void
}

type AgentStatus = 'idle' | 'running' | 'completed'

export function AgentSidebar({ activeAgent, onAgentSelect, onNewChat, onSessionSelect }: AgentSidebarProps) {
  const [agents, setAgents] = useState<Agent[]>([])
  const [createAgentOpen, setCreateAgentOpen] = useState(false)
  const [agentsExpanded, setAgentsExpanded] = useState(true)
  const [vaultExpanded, setVaultExpanded] = useState(true)
  const [workspaceExpanded, setWorkspaceExpanded] = useState(true)
  const [historyExpanded, setHistoryExpanded] = useState(true)
  const [sessions, setSessions] = useState<Session[]>([])
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null)
  const [agentStatuses, setAgentStatuses] = useState<Record<string, AgentStatus>>({})
  const prevRunningRef = useRef<Set<string>>(new Set())
  const [vaultEntries, setVaultEntries] = useState<Record<string, VaultEntry[]>>({})
  const [vaultLoading, setVaultLoading] = useState<Record<string, boolean>>({})
  const [vaultError, setVaultError] = useState<string | null>(null)
  const [vaultRoot, setVaultRoot] = useState<string | null>(null)
  const [vaultExpandedPaths, setVaultExpandedPaths] = useState<Record<string, boolean>>({})
  const [vaultSearch, setVaultSearch] = useState('')
  const [vaultSearchResults, setVaultSearchResults] = useState<VaultEntry[]>([])
  const [vaultSearchLoading, setVaultSearchLoading] = useState(false)
  const [selectedVaultPath, setSelectedVaultPath] = useState<string | null>(null)
  const [vaultModalPath, setVaultModalPath] = useState<string | null>(null)
  const [vaultModalOpen, setVaultModalOpen] = useState(false)

  const refreshAgents = () => {
    agentConfigAPI.getAgents().then(setAgents)
  }

  // Fetch agents + sessions on mount
  useEffect(() => {
    refreshAgents()
    agentSessionsAPI.getSessions()
      .then(setSessions)
      .catch(console.error)
  }, [])

  // Listen for auto-title updates from WebSocket
  useEffect(() => {
    const handler = (e: Event) => {
      const { sessionId, title } = (e as CustomEvent).detail
      setSessions(prev => prev.map(s =>
        s.id === sessionId ? { ...s, title } : s
      ))
    }
    window.addEventListener('session-title-update', handler)
    return () => window.removeEventListener('session-title-update', handler)
  }, [])

  // Poll agent statuses every 3s
  useEffect(() => {
    const pollStatus = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/agents/status`, { headers: authHeaders() })
        if (!response.ok) return
        const data = await response.json()
        const running = new Set<string>(data.running ?? [])
        const prev = prevRunningRef.current

        setAgentStatuses((old) => {
          const next = { ...old }
          // Mark newly stopped agents as "completed" (were running, now aren't)
          for (const id of prev) {
            if (!running.has(id) && id !== activeAgent) {
              next[id] = 'completed'
            }
          }
          // Mark currently running agents
          for (const id of running) {
            next[id] = 'running'
          }
          // Clear completed when agent is no longer in prev and not running
          for (const id of Object.keys(next)) {
            if (next[id] === 'running' && !running.has(id)) {
              // Was marked running but no longer — keep completed from above or set idle
              if (!prev.has(id)) next[id] = 'idle'
            }
          }
          return next
        })

        prevRunningRef.current = running
      } catch {
        // Silently ignore polling errors
      }
    }

    pollStatus()
    const interval = setInterval(pollStatus, 3000)
    return () => clearInterval(interval)
  }, [activeAgent])

  // Clear completed status when user clicks an agent
  const handleAgentClick = (id: string) => {
    onAgentSelect(id)
    setExpandedAgent(expandedAgent === id ? null : id)
    if (agentStatuses[id] === 'completed') {
      setAgentStatuses((old) => ({ ...old, [id]: 'idle' }))
    }
  }

  const loadVaultFolder = async (path: string) => {
    if (vaultLoading[path]) return
    setVaultLoading((prev) => ({ ...prev, [path]: true }))
    setVaultError(null)
    const url = `${API_BASE_URL}/api/context/vault/tree?path=${encodeURIComponent(path)}`
    console.log('[Vault] Fetching:', url)
    try {
      const response = await fetch(url, { headers: authHeaders() })
      console.log('[Vault] Response status:', response.status, response.statusText)
      if (!response.ok) {
        const errorText = await response.text()
        console.error('[Vault] Error response:', errorText)
        throw new Error(`Failed to load vault: ${response.status}`)
      }
      const data = await response.json() as VaultTreeResponse
      console.log('[Vault] Success, entries:', data.entries?.length)
      setVaultEntries((prev) => ({ ...prev, [path]: data.entries || [] }))
      const rootPath = data.vault_path ?? data.vaultPath
      if (rootPath) setVaultRoot(rootPath)
    } catch (err) {
      console.error('[Vault] Fetch error:', err)
      setVaultError(err instanceof Error ? err.message : 'Failed to load vault')
    } finally {
      setVaultLoading((prev) => ({ ...prev, [path]: false }))
    }
  }

  const refreshVault = async () => {
    const expandedPaths = Object.keys(vaultExpandedPaths).filter((key) => vaultExpandedPaths[key])
    const pathsToRefresh = ['', ...expandedPaths]
    await Promise.all(pathsToRefresh.map((path) => loadVaultFolder(path)))
  }

  useEffect(() => {
    if (!vaultExpanded) return
    if (!vaultEntries['']) {
      void loadVaultFolder('')
    }
  }, [vaultExpanded])

  useEffect(() => {
    if (!vaultSearch.trim()) {
      setVaultSearchResults([])
      setVaultSearchLoading(false)
      return
    }

    let isCancelled = false
    const handle = setTimeout(async () => {
      setVaultSearchLoading(true)
      setVaultError(null)
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/context/vault/search?query=${encodeURIComponent(vaultSearch.trim())}`,
          { headers: authHeaders() }
        )
        if (!response.ok) throw new Error('Failed to search vault')
        const data = await response.json() as VaultSearchResponse
        if (!isCancelled) {
          setVaultSearchResults(data.matches || [])
          const rootPath = data.vault_path ?? data.vaultPath
          if (rootPath) setVaultRoot(rootPath)
        }
      } catch (err) {
        if (!isCancelled) {
          setVaultError(err instanceof Error ? err.message : 'Failed to search vault')
        }
      } finally {
        if (!isCancelled) {
          setVaultSearchLoading(false)
        }
      }
    }, 200)

    return () => {
      isCancelled = true
      clearTimeout(handle)
    }
  }, [vaultSearch])

  const toggleVaultFolder = (path: string) => {
    const isExpanded = Boolean(vaultExpandedPaths[path])
    const nextExpanded = !isExpanded
    setVaultExpandedPaths((prev) => ({ ...prev, [path]: nextExpanded }))
    if (nextExpanded && !vaultEntries[path]) {
      void loadVaultFolder(path)
    }
  }

  const openVaultFile = (path: string) => {
    setSelectedVaultPath(path)
    setVaultModalPath(path)
    setVaultModalOpen(true)
  }

  const renderVaultFileIcon = (entry: VaultEntry) => {
    const fileExtension = (entry.extension || entry.name.split('.').pop() || '').toLowerCase()
    return fileExtension === 'md'
      ? <FileText className="w-3.5 h-3.5" />
      : <File className="w-3.5 h-3.5" />
  }

  const renderVaultEntries = (path: string, depth: number) => {
    const entries = vaultEntries[path] || []

    return entries.map((entry) => {
      const isFolder = entry.kind === 'dir'
      const isExpanded = Boolean(vaultExpandedPaths[entry.path])
      const isSelected = selectedVaultPath === entry.path
      const indent = 8 + depth * 12
      return (
        <div key={entry.path}>
          <button
            onClick={() => {
              if (isFolder) {
                toggleVaultFolder(entry.path)
              } else {
                openVaultFile(entry.path)
              }
            }}
            className={`w-full flex items-center gap-2 py-1.5 rounded-md transition ${
              isSelected
                ? 'bg-white/10 text-white'
                : 'text-gray-400 hover:bg-white/5 hover:text-white'
            }`}
            style={{ paddingLeft: indent, paddingRight: 8 }}
          >
            {isFolder ? (
              isExpanded ? <ChevronDown className="w-3 h-3 text-gray-500" /> : <ChevronRight className="w-3 h-3 text-gray-500" />
            ) : (
              <span className="w-3 h-3" />
            )}
            <span className="text-gray-500">
              {isFolder ? (
                isExpanded ? <FolderOpen className="w-3.5 h-3.5" /> : <Folder className="w-3.5 h-3.5" />
              ) : (
                renderVaultFileIcon(entry)
              )}
            </span>
            <span className="truncate text-xs">{entry.name}</span>
          </button>
          {isFolder && isExpanded && (
            <div>
              {vaultLoading[entry.path] ? (
                <div className="flex items-center gap-2 py-1.5 text-xs text-gray-500" style={{ paddingLeft: indent + 16 }}>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Loading...
                </div>
              ) : (
                <>
                  {vaultEntries[entry.path]?.length ? (
                    renderVaultEntries(entry.path, depth + 1)
                  ) : (
                    <div className="py-1.5 text-xs text-gray-600" style={{ paddingLeft: indent + 16 }}>
                      No files found
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )
    })
  }

  const filteredSearchResults = vaultSearchResults.filter((entry) => entry.kind === 'file')

  return (
    <aside className="w-56 border-r border-white/10 flex flex-col shrink-0 bg-white/[0.02]">
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Inbox — top-level, above everything */}
        <a
          href="#/inbox"
          className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition ${
            window.location.hash === '#/inbox'
              ? 'bg-orange-500/20 text-orange-400'
              : 'text-gray-400 hover:bg-white/5 hover:text-white'
          }`}
        >
          <div className={`p-1.5 rounded-md transition-all ${
            window.location.hash === '#/inbox' ? 'bg-orange-500/20' : 'bg-white/5'
          }`}>
            <Inbox className="w-4 h-4" />
          </div>
          <span className="flex-1 text-left text-sm font-medium">Inbox</span>
        </a>

        {/* Separator */}
        <div className="h-px bg-white/5" />

        {/* Agents Section */}
        <div>
          <button
            onClick={() => setAgentsExpanded(!agentsExpanded)}
            className="flex items-center gap-1.5 text-xs font-medium text-gray-500 uppercase tracking-wider mb-2 hover:text-gray-400 transition w-full"
          >
            {agentsExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            Agents
          </button>
          {agentsExpanded && (
            <div className="space-y-0.5">
              {/* Dashboard button — pinned at top */}
              {(() => {
                const runningCount = Object.values(agentStatuses).filter(s => s === 'running').length
                return (
                  <button
                    onClick={() => onAgentSelect('dashboard')}
                    className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg card-hover mb-1 ${
                      activeAgent === 'dashboard'
                        ? 'bg-orange-500/20 text-orange-400'
                        : 'text-gray-400 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    <div className={`p-1.5 rounded-md transition-all ${
                      activeAgent === 'dashboard' ? 'bg-orange-500/20' : 'bg-white/5'
                    }`}>
                      <LayoutDashboard className="w-4 h-4" />
                    </div>
                    <span className="flex-1 text-left text-sm font-medium">Dashboard</span>
                    {runningCount > 0 && (
                      <span className="text-xs bg-orange-500/20 text-orange-400 px-1.5 py-0.5 rounded-full font-medium">
                        {runningCount}
                      </span>
                    )}
                  </button>
                )
              })()}
              {/* Claude Code — always first, hardcoded */}
              {(() => {
                const claudeColor = getAgentColor('orange')
                const isActive = activeAgent === 'claude'
                const claudeSessions = sessions
                  .filter(s => s.agent_id === 'claude')
                  .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
                  .slice(0, 5)
                const isExpanded = expandedAgent === 'claude'
                return (
                  <div>
                    <button
                      onClick={() => handleAgentClick('claude')}
                      className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg card-hover group ${
                        isActive
                          ? `${claudeColor.bgActive} ${claudeColor.text}`
                          : 'text-gray-400 hover:bg-white/5 hover:text-white'
                      }`}
                    >
                      <div className={`p-1.5 rounded-md transition-all ${isActive ? claudeColor.bgActive : `${claudeColor.bg}`}`}>
                        <span className={isActive ? claudeColor.text : 'text-gray-400'}>
                          <Terminal className="w-4 h-4" />
                        </span>
                      </div>
                      <span className="flex-1 text-left text-sm font-medium">Claude Code</span>
                      <AgentStatusIndicator status={agentStatuses['claude'] || 'idle'} />
                      {claudeSessions.length > 0 && (
                        isExpanded ? <ChevronDown className="w-3 h-3 text-gray-500" /> : <ChevronRight className="w-3 h-3 text-gray-500" />
                      )}
                    </button>
                    {isExpanded && claudeSessions.length > 0 && (
                      <div className="ml-6 mt-1 space-y-0.5">
                        {claudeSessions.map((session) => (
                          <button
                            key={session.id}
                            onClick={() => onSessionSelect?.(session.id)}
                            className="w-full flex items-center gap-2 px-2 py-1.5 text-gray-500 hover:text-gray-300 hover:bg-white/5 rounded-md transition text-xs"
                          >
                            <MessageSquare className="w-3 h-3 shrink-0" />
                            <span className="truncate flex-1 text-left">{session.title}</span>
                            <span className="text-gray-600 shrink-0">{timeAgo(session.updated_at)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })()}
              {/* Dynamic agents from API (exclude claude — hardcoded above) */}
              {agents.filter(a => a.id !== 'claude').map((agent) => {
                const color = getAgentColor(agent.color)
                const isActive = activeAgent === agent.id
                const isExpanded = expandedAgent === agent.id
                const agentSessions = sessions
                  .filter(s => s.agent_id === agent.id)
                  .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
                  .slice(0, 5)

                return (
                  <div key={agent.id}>
                    <button
                      onClick={() => handleAgentClick(agent.id)}
                      className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg card-hover group ${
                        isActive
                          ? `${color.bgActive} ${color.text}`
                          : 'text-gray-400 hover:bg-white/5 hover:text-white'
                      }`}
                    >
                      <div
                        className={`p-1.5 rounded-md transition-all ${
                          isActive
                            ? color.bgActive
                            : color.bg
                        }`}
                      >
                        <span className={isActive ? color.text : 'text-gray-400'}>
                          {getAgentIcon(agent.icon)}
                        </span>
                      </div>
                      <span className="flex-1 text-left text-sm font-medium">{agent.name}</span>
                      <div className="flex items-center gap-1.5">
                        <AgentStatusIndicator status={agentStatuses[agent.id] || 'idle'} />
                        {agentSessions.length > 0 && (
                          isExpanded ? <ChevronDown className="w-3 h-3 text-gray-500" /> : <ChevronRight className="w-3 h-3 text-gray-500" />
                        )}
                      </div>
                    </button>
                    {isExpanded && agentSessions.length > 0 && (
                      <div className="ml-6 mt-1 space-y-0.5">
                        {agentSessions.map((session) => (
                          <button
                            key={session.id}
                            onClick={() => onSessionSelect?.(session.id)}
                            className="w-full flex items-center gap-2 px-2 py-1.5 text-gray-500 hover:text-gray-300 hover:bg-white/5 rounded-md transition text-xs"
                          >
                            <MessageSquare className="w-3 h-3 shrink-0" />
                            <span className="truncate flex-1 text-left">{session.title}</span>
                            <span className="text-gray-600 shrink-0">{timeAgo(session.updated_at)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
              <button
                onClick={onNewChat}
                className="w-full flex items-center gap-2 px-2.5 py-2 text-gray-500 hover:text-orange-400 hover:bg-orange-500/10 rounded-lg transition text-sm"
              >
                <Plus className="w-4 h-4" />
                New Chat
              </button>
              <button
                onClick={() => setCreateAgentOpen(true)}
                className="w-full flex items-center gap-2 px-2.5 py-2 text-gray-500 hover:text-blue-400 hover:bg-blue-500/10 rounded-lg transition text-sm"
              >
                <Bot className="w-4 h-4" />
                Create Agent
              </button>
            </div>
          )}
        </div>

        {/* Separator */}
        <div className="h-px bg-white/5" />

        {/* Vault Section */}
        <div>
          <div className="flex items-center justify-between mb-2 gap-2">
            <button
              onClick={() => setVaultExpanded(!vaultExpanded)}
              className="flex items-center gap-1.5 text-xs font-medium text-gray-500 uppercase tracking-wider hover:text-gray-400 transition flex-1 text-left"
            >
              {vaultExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              Vault
            </button>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => void refreshVault()}
                className="p-1 text-gray-500 hover:text-gray-300 hover:bg-white/5 rounded-md transition"
                aria-label="Refresh vault"
              >
                <RefreshCw className={`w-3 h-3 ${vaultLoading[''] ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={() => { window.location.hash = '/desktop-settings' }}
                className="p-1 text-gray-500 hover:text-gray-300 hover:bg-white/5 rounded-md transition"
                aria-label="Switch vault"
              >
                <ArrowRightLeft className="w-3 h-3" />
              </button>
            </div>
          </div>
          {vaultExpanded && (
            <div className="space-y-2">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500" />
                <input
                  type="text"
                  placeholder="Search files"
                  value={vaultSearch}
                  onChange={(event) => setVaultSearch(event.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg pl-7 pr-2 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-orange-500/50 transition"
                />
              </div>
              {vaultRoot && (
                <div className="text-[10px] text-gray-600 px-2.5 truncate">
                  {vaultRoot}
                </div>
              )}
              {vaultError && (
                <div className="text-xs text-red-400 px-2.5">
                  {vaultError}
                </div>
              )}
              <div className="space-y-0.5">
                {vaultSearch.trim() ? (
                  vaultSearchLoading ? (
                    <div className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-gray-500">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Searching...
                    </div>
                  ) : filteredSearchResults.length ? (
                    filteredSearchResults.map((entry) => (
                      <button
                        key={entry.path}
                        onClick={() => openVaultFile(entry.path)}
                        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-gray-400 hover:bg-white/5 hover:text-white rounded-md transition"
                        title={entry.path}
                      >
                        <span className="text-gray-500">
                          {renderVaultFileIcon(entry)}
                        </span>
                        <span className="truncate text-xs flex-1 text-left">{entry.name}</span>
                        <span className="text-[10px] text-gray-600 truncate max-w-[90px]">
                          {entry.path.includes('/') ? entry.path.replace(/\/[^/]+$/, '') : 'Vault'}
                        </span>
                      </button>
                    ))
                  ) : (
                    <div className="px-2.5 py-1.5 text-xs text-gray-600">
                      No matching files
                    </div>
                  )
                ) : vaultEntries[''] ? (
                  vaultEntries[''].length ? (
                    renderVaultEntries('', 0)
                  ) : (
                    <div className="px-2.5 py-1.5 text-xs text-gray-600">
                      Vault is empty
                    </div>
                  )
                ) : vaultLoading[''] ? (
                  <div className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-gray-500">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Loading vault...
                  </div>
                ) : (
                  <div className="px-2.5 py-1.5 text-xs text-gray-600">
                    Vault not loaded
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Separator */}
        <div className="h-px bg-white/5" />

        {/* Workspace Section */}
        <div>
          <button
            onClick={() => setWorkspaceExpanded(!workspaceExpanded)}
            className="flex items-center gap-1.5 text-xs font-medium text-gray-500 uppercase tracking-wider mb-2 hover:text-gray-400 transition w-full"
          >
            {workspaceExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            Workspace
          </button>
          {workspaceExpanded && (
            <div className="space-y-0.5">
              {WORKSPACE.map((item) => (
                <a
                  key={item.id}
                  href={item.href || '#'}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 text-gray-400 hover:bg-white/5 hover:text-white rounded-lg transition"
                >
                  {item.icon}
                  <span className="text-sm">{item.name}</span>
                </a>
              ))}
            </div>
          )}
        </div>

        {/* Separator */}
        <div className="h-px bg-white/5" />

        {/* History Section - All sessions across all agents */}
        <div>
          <button
            onClick={() => setHistoryExpanded(!historyExpanded)}
            className="flex items-center gap-1.5 text-xs font-medium text-gray-500 uppercase tracking-wider mb-2 hover:text-gray-400 transition w-full"
          >
            {historyExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            History
          </button>
          {historyExpanded && (
            <div className="space-y-0.5">
              {sessions.length === 0 ? (
                <p className="text-xs text-gray-600 px-2.5 py-2">No sessions yet</p>
              ) : (
                sessions
                  .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
                  .slice(0, 10)
                  .map((session) => {
                    const agent = agents.find(a => a.id === session.agent_id)
                    const agentName = agent?.name || 'Claude Code'
                    return (
                      <button
                        key={session.id}
                        onClick={() => onSessionSelect?.(session.id)}
                        className="w-full flex items-center gap-2.5 px-2.5 py-2 text-gray-400 hover:bg-white/5 hover:text-white rounded-lg transition group"
                      >
                        <MessageSquare className="w-4 h-4 text-gray-500 group-hover:text-gray-400 shrink-0" />
                        <div className="flex-1 text-left overflow-hidden">
                          <p className="text-sm truncate">{session.title}</p>
                          <p className="text-xs text-gray-600">{agentName} · {timeAgo(session.updated_at)}</p>
                        </div>
                      </button>
                    )
                  })
              )}
            </div>
          )}
        </div>
      </div>
      <VaultFileViewerModal
        isOpen={vaultModalOpen}
        onClose={() => {
          setVaultModalOpen(false)
          setVaultModalPath(null)
        }}
        filePath={vaultModalPath}
      />
      <CreateAgentModal
        open={createAgentOpen}
        onOpenChange={setCreateAgentOpen}
        onCreated={refreshAgents}
      />
    </aside>
  )
}
