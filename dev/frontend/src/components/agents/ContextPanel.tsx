import { useState } from 'react'
import {
  X,
  Edit3,
  Brain,
  Target,
  FileText,
  CheckSquare,
  Calendar,
  Sparkles,
  ChevronRight,
  Wrench,
  Zap,
  Clock,
  Loader2,
  AlertTriangle,
} from 'lucide-react'
import { useContextPanel } from '@/hooks/useContextPanel'
import { VaultFileModal, type VaultFileType } from './VaultFileModal'

interface ContextPanelProps {
  onClose: () => void
}

// Helper to format date as "Jan 27" or "Today"
function formatDateLabel(dateStr: string): string {
  if (!dateStr) return ''
  const today = new Date().toISOString().split('T')[0]
  if (dateStr === today) return 'Today'

  const date = new Date(dateStr + 'T00:00:00')
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function ContextPanel({ onClose }: ContextPanelProps) {
  const { context, loading, refresh } = useContextPanel()

  const [modalState, setModalState] = useState<{
    isOpen: boolean
    fileType: VaultFileType | null
    mode: 'view' | 'edit'
  }>({
    isOpen: false,
    fileType: null,
    mode: 'view',
  })

  const openModal = (fileType: VaultFileType, mode: 'view' | 'edit') => {
    setModalState({ isOpen: true, fileType, mode })
  }

  const closeModal = () => {
    setModalState({ isOpen: false, fileType: null, mode: 'view' })
  }

  if (loading) {
    return (
      <aside className="w-80 border-l border-white/10 flex flex-col shrink-0 bg-black/40 backdrop-blur-sm noise-overlay">
        <div className="flex items-center justify-center h-full">
          <Loader2 className="w-6 h-6 animate-spin text-orange-400" />
        </div>
      </aside>
    )
  }

  // Prepare dynamic data from context
  const aboutMeItems = context ? [
    context.memory.name,
    `${context.memory.location}, ${context.memory.timezone}`,
  ] : []

  const goalsItems = context
    ? (context.memory.goals.length > 0 ? context.memory.goals.slice(0, 4) : ['No goals'])
    : []

  const todosCompleted = context?.today.todos.completed || 0
  const todosTotal = context?.today.todos.total || 0
  const todosBadge = todosTotal - todosCompleted
  const todosIsStale = context?.today.todos.is_fallback || false
  const todosDate = context?.today.todos.date || ''

  const morningBriefTime = context?.today.morning_brief_time || 'Not synced'
  const briefIsStale = context?.today.brief_is_fallback || false
  const briefDate = context?.today.morning_brief_date || ''

  const nextCalls = context?.today.next_calls || []
  const callsSublabel = nextCalls.length > 0
    ? nextCalls.slice(0, 2).map(c => `${c.time} ${c.title}`).join(', ')
    : 'No calls scheduled'

  const callsAreStale = context?.today.calls_is_fallback || false
  const callsDate = context?.today.calls_date || ''
  const callsSource = context?.today.calls_source || 'brief'

  const learnings = context?.learnings.map(l => ({
    text: l.text,
    time: l.timestamp,
  })) || []

  return (
    <aside className="w-80 border-l border-white/10 flex flex-col shrink-0 bg-black/40 backdrop-blur-sm noise-overlay">
      {/* Header */}
      <div className="h-12 border-b border-white/10 flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
          <span className="text-sm font-semibold text-white">Context</span>
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
        {/* Memory Section */}
        <section>
          <div className="section-header flex items-center gap-2 mb-4">
            <div className="p-1.5 rounded-lg bg-orange-500/20">
              <Brain className="w-4 h-4 text-orange-400" />
            </div>
            <h3 className="text-xs font-semibold text-white uppercase tracking-wider">Memory</h3>
          </div>

          <div className="space-y-3">
            <ContextCard
              icon={<Edit3 className="w-3.5 h-3.5" />}
              label="About Me"
              items={aboutMeItems}
              editable
              onClick={() => openModal('aboutMe', 'view')}
            />
            <ContextCard
              icon={<Target className="w-3.5 h-3.5" />}
              label="Goals"
              items={goalsItems}
              editable
              onClick={() => openModal('goals', 'view')}
            />
          </div>
        </section>

        {/* Separator */}
        <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

        {/* Today's Context */}
        <section>
          <div className="section-header flex items-center gap-2 mb-4">
            <div className="p-1.5 rounded-lg bg-purple-500/20">
              <Sparkles className="w-4 h-4 text-purple-400" />
            </div>
            <h3 className="text-xs font-semibold text-white uppercase tracking-wider">Today</h3>
          </div>

          <div className="space-y-2">
            <ContextLink
              icon={<FileText className="w-4 h-4" />}
              label="Morning Brief"
              sublabel={`Last: ${morningBriefTime}`}
              color="purple"
              onClick={() => openModal('morningBrief', 'view')}
              warning={briefIsStale ? formatDateLabel(briefDate) : undefined}
              warningLevel="yellow"
            />
            <ContextLink
              icon={<CheckSquare className="w-4 h-4" />}
              label="Todos"
              sublabel={`${todosCompleted}/${todosTotal} completed`}
              badge={todosBadge > 0 ? todosBadge : undefined}
              color="green"
              onClick={() => openModal('todos', 'view')}
              warning={todosIsStale ? formatDateLabel(todosDate) : undefined}
              warningLevel="yellow"
            />
            <ContextLink
              icon={<Calendar className="w-4 h-4" />}
              label="Calls"
              sublabel={callsAreStale ? `Showing past ${callsSource} schedule` : callsSublabel}
              color="blue"
              onClick={() => openModal('calls', 'view')}
              warning={callsAreStale ? formatDateLabel(callsDate) : undefined}
              warningLevel="red"
            />
          </div>
        </section>

        {/* Separator */}
        <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

        {/* Agent Context */}
        <section>
          <div className="section-header flex items-center gap-2 mb-4">
            <div className="p-1.5 rounded-lg bg-blue-500/20">
              <Wrench className="w-4 h-4 text-blue-400" />
            </div>
            <h3 className="text-xs font-semibold text-white uppercase tracking-wider">Agent</h3>
          </div>

          <div className="bg-white/[0.03] border border-white/5 rounded-2xl p-4 space-y-4">
            {/* Skills */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-gray-500 uppercase tracking-wider">Skills</span>
                <span className="text-xs text-blue-400 font-medium">5 active</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {['/plan', '/react', '/postgres', '/mcp-builder', '/frontend'].map((skill) => (
                  <span
                    key={skill}
                    className="px-2 py-1 text-xs bg-blue-500/10 text-blue-300 rounded-lg border border-blue-500/20 font-mono"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            </div>

            {/* Stats Row */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white/[0.02] rounded-xl p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Zap className="w-3.5 h-3.5 text-yellow-400" />
                  <span className="text-xs text-gray-500">Tools</span>
                </div>
                <span className="text-lg font-semibold text-white">8</span>
              </div>
              <div className="bg-white/[0.02] rounded-xl p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Clock className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="text-xs text-gray-500">Session</span>
                </div>
                <span className="text-lg font-semibold text-white">23m</span>
              </div>
            </div>
          </div>
        </section>

        {/* Separator */}
        <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

        {/* Recent Learnings */}
        <section>
          <div className="section-header flex items-center gap-2 mb-4">
            <div className="p-1.5 rounded-lg bg-green-500/20">
              <Sparkles className="w-4 h-4 text-green-400" />
            </div>
            <h3 className="text-xs font-semibold text-white uppercase tracking-wider">Learnings</h3>
          </div>

          <div className="space-y-2">
            {learnings.length > 0 ? (
              learnings.map((learning, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 p-2.5 bg-white/[0.02] rounded-xl group hover:bg-white/[0.04] transition"
                >
                  <div className="w-1.5 h-1.5 rounded-full bg-green-400 mt-1.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-300">{learning.text}</p>
                    <p className="text-xs text-gray-600 mt-0.5">{learning.time}</p>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-sm text-gray-500 text-center py-4">
                No learnings yet
              </div>
            )}
          </div>
        </section>
      </div>

      {modalState.fileType && (
        <VaultFileModal
          isOpen={modalState.isOpen}
          onClose={closeModal}
          fileType={modalState.fileType}
          mode={modalState.mode}
          onSaved={refresh}
        />
      )}
    </aside>
  )
}

interface ContextCardProps {
  icon: React.ReactNode
  label: string
  items: string[]
  editable?: boolean
  onClick?: () => void
}

function ContextCard({ icon, label, items, editable, onClick }: ContextCardProps) {
  return (
    <div onClick={onClick} className="cursor-pointer bg-white/[0.03] border border-white/5 rounded-2xl p-4 hover:bg-white/[0.05] hover:border-white/10 transition group">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-orange-500/10 text-orange-400 group-hover:bg-orange-500/20 transition">
            {icon}
          </div>
          <span className="text-sm font-semibold text-white">{label}</span>
        </div>
        {editable && (
          <button className="p-1.5 text-gray-600 hover:text-orange-400 hover:bg-orange-500/10 rounded-lg transition opacity-0 group-hover:opacity-100">
            <Edit3 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <ul className="space-y-1.5 pl-1">
        {items.map((item, i) => (
          <li key={i} className="text-sm text-gray-400 flex items-center gap-2">
            <span className="w-1 h-1 rounded-full bg-gray-600" />
            {item}
          </li>
        ))}
      </ul>
    </div>
  )
}

const LINK_COLORS = {
  orange: { bg: 'bg-orange-500/10', text: 'text-orange-400', hover: 'group-hover:bg-orange-500/20' },
  purple: { bg: 'bg-purple-500/10', text: 'text-purple-400', hover: 'group-hover:bg-purple-500/20' },
  blue: { bg: 'bg-blue-500/10', text: 'text-blue-400', hover: 'group-hover:bg-blue-500/20' },
  green: { bg: 'bg-green-500/10', text: 'text-green-400', hover: 'group-hover:bg-green-500/20' },
}

interface ContextLinkProps {
  icon: React.ReactNode
  label: string
  sublabel: string
  badge?: number
  color?: keyof typeof LINK_COLORS
  onClick?: () => void
  warning?: string  // Warning text like "Jan 27" to show staleness
  warningLevel?: 'yellow' | 'red'  // yellow for stale, red for outdated calls
}

function ContextLink({ icon, label, sublabel, badge, color = 'orange', onClick, warning, warningLevel = 'yellow' }: ContextLinkProps) {
  const colors = LINK_COLORS[color]
  const warningColors = warningLevel === 'red'
    ? 'bg-red-500/20 text-red-400 border-red-500/30'
    : 'bg-amber-500/20 text-amber-400 border-amber-500/30'

  return (
    <button onClick={onClick} className="w-full flex items-center gap-3 p-3 bg-white/[0.02] border border-white/5 rounded-2xl hover:bg-white/[0.05] hover:border-white/10 transition group card-hover">
      <div className={`p-2 rounded-xl ${colors.bg} ${colors.hover} transition`}>
        <span className={colors.text}>{icon}</span>
      </div>
      <div className="flex-1 text-left min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm text-white font-medium">{label}</p>
          {warning && (
            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded border ${warningColors}`}>
              <AlertTriangle className="w-2.5 h-2.5" />
              {warning}
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500 truncate">{sublabel}</p>
      </div>
      {badge !== undefined && (
        <span className={`px-2 py-1 text-xs ${colors.bg} ${colors.text} rounded-lg font-semibold`}>
          {badge}
        </span>
      )}
      <ChevronRight className="w-4 h-4 text-gray-600 group-hover:text-white transition" />
    </button>
  )
}
