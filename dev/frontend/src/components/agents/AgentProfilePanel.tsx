import { useState, useEffect } from 'react'
import { agentSessionsAPI, agentConfigAPI } from '@/lib/api'
import type { Agent, Session } from '@/types'
import {
  X,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  FileText,
  Brain,
  Zap,
  Pencil,
} from 'lucide-react'
import { AgentEditModal } from './AgentEditModal'

const COLOR_MAP: Record<string, { bg: string; text: string; dot: string }> = {
  blue:   { bg: 'bg-blue-500/20',   text: 'text-blue-400',   dot: 'bg-blue-400' },
  purple: { bg: 'bg-purple-500/20', text: 'text-purple-400', dot: 'bg-purple-400' },
  green:  { bg: 'bg-green-500/20',  text: 'text-green-400',  dot: 'bg-green-400' },
  pink:   { bg: 'bg-pink-500/20',   text: 'text-pink-400',   dot: 'bg-pink-400' },
  cyan:   { bg: 'bg-cyan-500/20',   text: 'text-cyan-400',   dot: 'bg-cyan-400' },
  orange: { bg: 'bg-orange-500/20', text: 'text-orange-400', dot: 'bg-orange-400' },
}

const DEFAULT_COLOR = { bg: 'bg-orange-500/20', text: 'text-orange-400', dot: 'bg-orange-400' }

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

interface AgentProfilePanelProps {
  agent: Agent
  onClose: () => void
  onSessionSelect?: (sessionId: string) => void
  onAgentUpdated?: () => void
}

export function AgentProfilePanel({ agent, onClose, onSessionSelect, onAgentUpdated }: AgentProfilePanelProps) {
  const [promptExpanded, setPromptExpanded] = useState(true)
  const [memoryExpanded, setMemoryExpanded] = useState(true)
  const [sessionsExpanded, setSessionsExpanded] = useState(true)
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeModal, setActiveModal] = useState<'prompt' | 'memory' | null>(null)

  const color = COLOR_MAP[agent.color] ?? DEFAULT_COLOR

  useEffect(() => {
    agentSessionsAPI.getSessions()
      .then((all) => {
        const filtered = all
          .filter((s) => s.agent_id === agent.id)
          .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
          .slice(0, 10)
        setSessions(filtered)
      })
      .catch(console.error)
  }, [agent.id])

  const memoryLines = agent.memory
    ? agent.memory.split('\n').filter((line) => line.trim())
    : []

  const handleSavePrompt = async (newContent: string) => {
    await agentConfigAPI.updateAgent(agent.id, { prompt: newContent })
    onAgentUpdated?.()
  }

  const handleSaveMemory = async (newContent: string) => {
    await agentConfigAPI.updateMemory(agent.id, newContent)
    onAgentUpdated?.()
  }

  return (
    <aside className="w-80 border-l border-white/10 flex flex-col shrink-0 bg-black/40 backdrop-blur-sm noise-overlay">
      {/* Header */}
      <div className="h-12 border-b border-white/10 flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${color.dot} animate-pulse`} />
          <span className="text-sm font-semibold text-white">{agent.name}</span>
          <span className="text-xs text-gray-500">{agent.role}</span>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 text-gray-500 hover:text-white hover:bg-white/10 rounded-lg transition"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* System Prompt Section */}
        <section>
          <button
            onClick={() => setPromptExpanded(!promptExpanded)}
            className="section-header flex items-center gap-2 mb-4 w-full"
          >
            <div className={`p-1.5 rounded-lg ${color.bg}`}>
              <FileText className={`w-4 h-4 ${color.text}`} />
            </div>
            <h3 className="text-xs font-semibold text-white uppercase tracking-wider flex-1 text-left">System Prompt</h3>
            {promptExpanded ? <ChevronDown className="w-3.5 h-3.5 text-gray-500" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-500" />}
          </button>
          {promptExpanded && (
            <div
              onClick={() => setActiveModal('prompt')}
              className="bg-white/[0.03] border border-white/5 rounded-2xl p-4 cursor-pointer hover:bg-white/[0.05] hover:border-white/10 transition group"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] text-gray-600 uppercase tracking-wider">Click to edit</span>
                <Pencil className="w-3.5 h-3.5 text-gray-600 opacity-0 group-hover:opacity-100 transition" />
              </div>
              {agent.prompt ? (
                <pre className="text-sm text-gray-400 whitespace-pre-wrap font-mono leading-relaxed max-h-60 overflow-y-auto">
                  {agent.prompt}
                </pre>
              ) : (
                <p className="text-sm text-gray-600 italic">No system prompt configured</p>
              )}
            </div>
          )}
        </section>

        {/* Separator */}
        <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

        {/* Memory Section */}
        <section>
          <button
            onClick={() => setMemoryExpanded(!memoryExpanded)}
            className="section-header flex items-center gap-2 mb-4 w-full"
          >
            <div className="p-1.5 rounded-lg bg-purple-500/20">
              <Brain className="w-4 h-4 text-purple-400" />
            </div>
            <h3 className="text-xs font-semibold text-white uppercase tracking-wider flex-1 text-left">Memory</h3>
            {memoryExpanded ? <ChevronDown className="w-3.5 h-3.5 text-gray-500" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-500" />}
          </button>
          {memoryExpanded && (
            <div
              onClick={() => setActiveModal('memory')}
              className="bg-white/[0.03] border border-white/5 rounded-2xl p-4 cursor-pointer hover:bg-white/[0.05] hover:border-white/10 transition group"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] text-gray-600 uppercase tracking-wider">Click to edit</span>
                <Pencil className="w-3.5 h-3.5 text-gray-600 opacity-0 group-hover:opacity-100 transition" />
              </div>
              {memoryLines.length > 0 ? (
                <ul className="space-y-1.5">
                  {memoryLines.map((line, i) => (
                    <li key={i} className="text-sm text-gray-400 flex items-start gap-2">
                      <span className="w-1 h-1 rounded-full bg-purple-400 mt-2 shrink-0" />
                      <span>{line.replace(/^[-*]\s*/, '')}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-gray-600 italic">No memories yet</p>
              )}
            </div>
          )}
        </section>

        {/* Separator */}
        <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

        {/* Skills Section */}
        <section>
          <div className="section-header flex items-center gap-2 mb-4">
            <div className="p-1.5 rounded-lg bg-blue-500/20">
              <Zap className="w-4 h-4 text-blue-400" />
            </div>
            <h3 className="text-xs font-semibold text-white uppercase tracking-wider">Skills</h3>
            <span className="text-xs text-blue-400 font-medium ml-auto">{agent.skills.length} active</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {agent.skills.length > 0 ? (
              agent.skills.map((skill) => (
                <span
                  key={skill}
                  className="px-2 py-1 text-xs bg-blue-500/10 text-blue-300 rounded-lg border border-blue-500/20 font-mono"
                >
                  {skill}
                </span>
              ))
            ) : (
              <p className="text-sm text-gray-600 italic">No skills configured</p>
            )}
          </div>
        </section>

        {/* Separator */}
        <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

        {/* Recent Sessions */}
        <section>
          <button
            onClick={() => setSessionsExpanded(!sessionsExpanded)}
            className="section-header flex items-center gap-2 mb-4 w-full"
          >
            <div className="p-1.5 rounded-lg bg-green-500/20">
              <MessageSquare className="w-4 h-4 text-green-400" />
            </div>
            <h3 className="text-xs font-semibold text-white uppercase tracking-wider flex-1 text-left">Recent Sessions</h3>
            {sessionsExpanded ? <ChevronDown className="w-3.5 h-3.5 text-gray-500" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-500" />}
          </button>
          {sessionsExpanded && (
            <div className="space-y-1.5">
              {sessions.length > 0 ? (
                sessions.map((session) => (
                  <button
                    key={session.id}
                    onClick={() => onSessionSelect?.(session.id)}
                    className="w-full flex items-center gap-3 p-3 bg-white/[0.02] border border-white/5 rounded-2xl hover:bg-white/[0.05] hover:border-white/10 transition group card-hover"
                  >
                    <MessageSquare className="w-4 h-4 text-gray-500 group-hover:text-gray-400 shrink-0" />
                    <div className="flex-1 text-left overflow-hidden">
                      <p className="text-sm text-white font-medium truncate">{session.title}</p>
                      <p className="text-xs text-gray-500">{timeAgo(session.updated_at)}</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-600 group-hover:text-white transition" />
                  </button>
                ))
              ) : (
                <p className="text-sm text-gray-600 italic text-center py-4">No sessions yet</p>
              )}
            </div>
          )}
        </section>
      </div>

      {/* Edit Modals */}
      <AgentEditModal
        isOpen={activeModal === 'prompt'}
        onClose={() => setActiveModal(null)}
        title={`${agent.name} — System Prompt`}
        content={agent.prompt || ''}
        onSave={handleSavePrompt}
      />
      <AgentEditModal
        isOpen={activeModal === 'memory'}
        onClose={() => setActiveModal(null)}
        title={`${agent.name} — Memory`}
        content={agent.memory || ''}
        onSave={handleSaveMemory}
      />
    </aside>
  )
}
