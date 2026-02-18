import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  Save,
  Play,
  Pause,
  RefreshCw,
  FileText,
  Clock,
  AlertCircle,
  Trash2,
  Code,
} from 'lucide-react'

interface WorkflowSchedule {
  type: string
  time?: string
  day?: string
  cron?: string
  interval_minutes?: number
}

interface WorkflowInfo {
  id: string
  name: string
  description?: string
  schedule?: WorkflowSchedule
  enabled: boolean
  output_path?: string
  config_path: string
  last_run?: string
}

interface WorkflowDetail {
  workflow: WorkflowInfo
  config: Record<string, unknown>
  raw_yaml?: string | null
}

interface RunHistoryEntry {
  id?: string
  name?: string
  status?: string
  output_path?: string
  timestamp?: string
  duration_ms?: number
  error?: string
  message?: string
}

interface RunHistoryResponse {
  entries: RunHistoryEntry[]
}

type ContextSource =
  | {
      type: 'file'
      path: string
      title?: string
      max_chars?: number
    }
  | {
      type: 'glob'
      pattern: string
      title?: string
      max_files?: number
      max_chars_per_file?: number
    }
  | {
      type: 'text'
      text: string
      title?: string
    }

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8767'

const SCHEDULE_TYPES = [
  { value: 'manual', label: 'Manual' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'interval', label: 'Interval' },
  { value: 'cron', label: 'Cron' },
]

const WEEK_DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

const RUNNER_MODELS = ['opus', 'sonnet', 'haiku']

interface WorkflowFormState {
  name: string
  description: string
  schedule: WorkflowSchedule
  context: ContextSource[]
  prompt: string
  output: { path: string; overwrite: boolean }
  runner: { model: string; timeout_sec: number; unset_api_key: boolean }
}

const EMPTY_CONFIG: WorkflowFormState = {
  name: '',
  description: '',
  schedule: { type: 'manual' },
  context: [] as ContextSource[],
  prompt: '',
  output: { path: 'Vault/3 - Todos/Workflow Outputs/{DATE}.md', overwrite: false },
  runner: { model: 'opus', timeout_sec: 1200, unset_api_key: true },
}

function relativeTime(dateString?: string): string {
  if (!dateString) return 'Never'
  const date = new Date(dateString)
  if (Number.isNaN(date.getTime())) return 'Unknown'

  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d ago`
}

function formatDuration(durationMs?: number): string {
  if (!durationMs) return '-'
  if (durationMs < 1000) return `${durationMs}ms`
  const seconds = Math.round(durationMs / 1000)
  if (seconds < 60) return `${seconds}s`
  const mins = Math.round(seconds / 60)
  return `${mins}m`
}

function formatSchedule(schedule: WorkflowSchedule): string {
  if (schedule.type === 'manual') return 'Manual'
  if (schedule.type === 'daily') return `Daily at ${schedule.time || '??:??'}`
  if (schedule.type === 'weekly') {
    const day = schedule.day ? schedule.day[0].toUpperCase() + schedule.day.slice(1) : 'Unknown day'
    return `Weekly on ${day} at ${schedule.time || '??:??'}`
  }
  if (schedule.type === 'interval') {
    const mins = schedule.interval_minutes ?? 0
    if (mins >= 60 && mins % 60 === 0) {
      const hours = mins / 60
      return `Every ${hours} hour${hours === 1 ? '' : 's'}`
    }
    return `Every ${mins} min`
  }
  if (schedule.type === 'cron') return `Cron: ${schedule.cron || ''}`
  return schedule.type
}

function buildConfigFromState(state: WorkflowFormState) {
  const schedule = { ...state.schedule }
  const context = state.context
    .map((source) => {
      if (source.type === 'file' && source.path.trim()) {
        return { ...source, path: source.path.trim() }
      }
      if (source.type === 'glob' && source.pattern.trim()) {
        return { ...source, pattern: source.pattern.trim() }
      }
      if (source.type === 'text' && source.text.trim()) {
        return { ...source, text: source.text }
      }
      return null
    })
    .filter(Boolean) as ContextSource[]

  return {
    name: state.name.trim(),
    description: state.description.trim(),
    schedule,
    context,
    prompt: state.prompt,
    output: state.output,
    runner: state.runner,
  }
}

export function WorkflowEditorPage({ workflowId }: { workflowId: string | null }) {
  const isNew = workflowId === null
  const [activeTab, setActiveTab] = useState<'schedule' | 'trigger' | 'prompt' | 'yaml'>('schedule')
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [toggling, setToggling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<RunHistoryEntry[]>([])
  const [rawYaml, setRawYaml] = useState('')
  const [useRawYaml, setUseRawYaml] = useState(false)
  const [workflowMeta, setWorkflowMeta] = useState<WorkflowInfo | null>(null)
  const [formState, setFormState] = useState<WorkflowFormState>(EMPTY_CONFIG)
  const [newId, setNewId] = useState('')

  const schedule = formState.schedule

  const scheduleSummary = useMemo(() => formatSchedule(schedule), [schedule])
  const isManualSchedule = (workflowMeta?.schedule?.type ?? schedule.type) === 'manual'

  const loadWorkflow = async () => {
    if (!workflowId) return
    try {
      setError(null)
      const response = await fetch(`${API_BASE_URL}/api/workflows/${workflowId}`)
      if (!response.ok) throw new Error('Failed to load workflow')
      const data = await response.json() as WorkflowDetail

      setWorkflowMeta(data.workflow)
      setRawYaml(data.raw_yaml || '')
      setUseRawYaml(false)

      const config = data.config || {}
      const scheduleConfig = (config.schedule as Partial<WorkflowSchedule> | undefined) || {}
      const schedule: WorkflowSchedule = {
        ...scheduleConfig,
        type: scheduleConfig.type || 'manual',
      }
      const output = { path: 'Vault/3 - Todos/Workflow Outputs/{DATE}.md', overwrite: false, ...(config.output as { path?: string; overwrite?: boolean } || {}) }
      const runner = {
        model: 'opus',
        timeout_sec: 1200,
        unset_api_key: true,
        ...(config.runner as { model?: string; timeout_sec?: number; unset_api_key?: boolean } || {}),
      }
      setFormState({
        name: String(config.name || ''),
        description: String(config.description || ''),
        schedule,
        context: (Array.isArray(config.context) ? config.context : []) as ContextSource[],
        prompt: String(config.prompt || ''),
        output,
        runner,
      })
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'Failed to load workflow')
    }
  }

  const loadHistory = async (id: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/workflows/${id}/history`)
      if (!response.ok) return
      const data = await response.json() as RunHistoryResponse
      setHistory(Array.isArray(data.entries) ? data.entries : [])
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (workflowId) {
      loadWorkflow()
      loadHistory(workflowId)
      setNewId('')
    } else {
      setWorkflowMeta(null)
      setFormState(EMPTY_CONFIG)
      setRawYaml('')
      setUseRawYaml(false)
      setHistory([])
      setActiveTab('schedule')
      setNewId('')
    }
  }, [workflowId])

  const handleSave = async (activate: boolean) => {
    try {
      setSaving(true)
      setError(null)

      if (isNew && !newId.trim()) {
        setError('Workflow ID is required')
        return
      }

      const id = isNew ? newId.trim() : workflowId
      if (!id) return

      const payload = useRawYaml && rawYaml.trim()
        ? { raw_yaml: rawYaml }
        : { config: buildConfigFromState(formState) }

      const response = await fetch(`${API_BASE_URL}/api/workflows${isNew ? '' : `/${id}`}`,
        {
          method: isNew ? 'POST' : 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, id: isNew ? id : undefined }),
        },
      )

      if (!response.ok) {
        const detail = await response.text()
        throw new Error(detail || 'Failed to save workflow')
      }

      if (isNew) {
        window.location.hash = `#/workflows/${id}`
        return
      }

      if (activate) {
        await fetch(`${API_BASE_URL}/api/workflows/${id}/enable`, { method: 'POST' })
      }

      await loadWorkflow()
      await loadHistory(id)
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'Failed to save workflow')
    } finally {
      setSaving(false)
    }
  }

  const handleRun = async () => {
    if (!workflowId) return
    try {
      setRunning(true)
      setError(null)
      const response = await fetch(`${API_BASE_URL}/api/workflows/${workflowId}/run`, { method: 'POST' })
      if (!response.ok) throw new Error('Failed to run workflow')
      setTimeout(() => loadHistory(workflowId), 1500)
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'Failed to run workflow')
    } finally {
      setRunning(false)
    }
  }

  const handleToggle = async () => {
    if (!workflowId || !workflowMeta) return
    try {
      setToggling(true)
      const endpoint = workflowMeta.enabled ? 'disable' : 'enable'
      const response = await fetch(`${API_BASE_URL}/api/workflows/${workflowId}/${endpoint}`, { method: 'POST' })
      if (!response.ok) throw new Error('Failed to update workflow status')
      await loadWorkflow()
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'Failed to update workflow status')
    } finally {
      setToggling(false)
    }
  }

  const handleDelete = async () => {
    if (!workflowId) return
    if (!window.confirm('Delete this workflow?')) return
    try {
      const response = await fetch(`${API_BASE_URL}/api/workflows/${workflowId}`, { method: 'DELETE' })
      if (!response.ok) throw new Error('Failed to delete workflow')
      window.location.hash = '#/workflows'
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'Failed to delete workflow')
    }
  }

  const updateSchedule = (updates: Partial<WorkflowSchedule>) => {
    setFormState((prev) => ({ ...prev, schedule: { ...prev.schedule, ...updates } }))
    setUseRawYaml(false)
  }

  const updateContextSource = (index: number, updates: Partial<ContextSource>) => {
    setFormState((prev) => {
      const next = [...prev.context]
      next[index] = { ...next[index], ...updates } as ContextSource
      return { ...prev, context: next }
    })
    setUseRawYaml(false)
  }

  const addContextSource = (type: ContextSource['type']) => {
    setFormState((prev) => ({
      ...prev,
      context: [
        ...prev.context,
        type === 'file'
          ? { type: 'file', path: '', title: '' }
          : type === 'glob'
          ? { type: 'glob', pattern: '', title: '' }
          : { type: 'text', text: '', title: '' },
      ],
    }))
    setUseRawYaml(false)
  }

  const removeContextSource = (index: number) => {
    setFormState((prev) => {
      const next = [...prev.context]
      next.splice(index, 1)
      return { ...prev, context: next }
    })
    setUseRawYaml(false)
  }

  const handleFieldChange = (field: keyof typeof EMPTY_CONFIG, value: unknown) => {
    setFormState((prev) => ({ ...prev, [field]: value }))
    setUseRawYaml(false)
  }

  return (
    <div className="min-h-screen bg-black">
      <header className="h-14 border-b border-white/10 flex items-center gap-4 px-4">
        <a
          href="#/workflows"
          className="p-2 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition"
        >
          <ArrowLeft className="w-5 h-5" />
        </a>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-orange-500/20">
            <FileText className="w-5 h-5 text-orange-400" />
          </div>
          <div>
            <h1 className="text-white font-medium">
              {isNew ? 'New Workflow' : workflowMeta?.name || 'Workflow Editor'}
            </h1>
            <p className="text-xs text-gray-500">{scheduleSummary}</p>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {!isNew && (
            <button
              onClick={handleRun}
              disabled={running}
              className="flex items-center gap-2 px-3 py-1.5 text-xs text-white bg-white/10 border border-white/10 rounded-lg hover:bg-white/20 transition disabled:opacity-60"
            >
              <Play className="w-3.5 h-3.5" />
              {running ? 'Running...' : 'Run'}
            </button>
          )}
          {!isNew && (
            <button
              onClick={handleToggle}
              disabled={toggling || isManualSchedule}
              className={`flex items-center gap-2 px-3 py-1.5 text-xs border rounded-lg transition disabled:opacity-60 ${
                workflowMeta?.enabled
                  ? 'bg-red-500/10 text-red-200 border-red-500/20 hover:bg-red-500/20'
                  : 'bg-green-500/10 text-green-200 border-green-500/20 hover:bg-green-500/20'
              }`}
            >
              {workflowMeta?.enabled ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              {workflowMeta?.enabled ? 'Disable' : 'Enable'}
            </button>
          )}
          <button
            onClick={() => handleSave(false)}
            disabled={saving}
            className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-100 bg-white/10 border border-white/10 rounded-lg hover:bg-white/20 transition disabled:opacity-60"
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? 'Saving...' : 'Save'}
          </button>
          {!isNew && (
            <button
              onClick={() => handleSave(true)}
              disabled={saving || isManualSchedule}
              className="flex items-center gap-2 px-3 py-1.5 text-xs text-orange-100 bg-orange-500/20 border border-orange-500/30 rounded-lg hover:bg-orange-500/30 transition disabled:opacity-60"
            >
              <Clock className="w-3.5 h-3.5" />
              Save & Activate
            </button>
          )}
        </div>
      </header>

      <div className="max-w-6xl mx-auto p-6">
        {error && (
          <div className="mb-6 flex items-center gap-2 text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        )}

        {isNew && (
          <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Workflow ID</label>
              <input
                value={newId}
                onChange={(event) => setNewId(event.target.value)}
                placeholder="my-workflow"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500/50"
              />
              <p className="text-xs text-gray-500 mt-1">Lowercase letters, numbers, and dashes only.</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">
          <div>
            <div className="flex items-center gap-2 mb-4">
              {(['schedule', 'trigger', 'prompt', 'yaml'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                    activeTab === tab
                      ? 'bg-orange-500/20 text-orange-200 border border-orange-500/30'
                      : 'bg-white/5 text-gray-400 border border-white/5 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  {tab === 'schedule' && 'Schedule'}
                  {tab === 'trigger' && 'Trigger'}
                  {tab === 'prompt' && 'Prompt'}
                  {tab === 'yaml' && 'YAML'}
                </button>
              ))}
            </div>

            {activeTab === 'schedule' && (
              <div className="bg-white/[0.03] border border-white/10 rounded-xl p-4 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Name</label>
                    <input
                      value={formState.name}
                      onChange={(event) => handleFieldChange('name', event.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500/50"
                      placeholder="Workflow name"
                    />
                    <p className="text-[11px] text-gray-500 mt-1">Shown in the list and header.</p>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Description</label>
                    <input
                      value={formState.description}
                      onChange={(event) => handleFieldChange('description', event.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500/50"
                      placeholder="Short summary"
                    />
                    <p className="text-[11px] text-gray-500 mt-1">One-line summary. Put full instructions in the Prompt tab.</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Frequency</label>
                    <select
                      value={schedule.type}
                      onChange={(event) => updateSchedule({ type: event.target.value })}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500/50"
                    >
                      {SCHEDULE_TYPES.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {(schedule.type === 'daily' || schedule.type === 'weekly') && (
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Time (HH:MM)</label>
                      <input
                        value={schedule.time || ''}
                        onChange={(event) => updateSchedule({ time: event.target.value })}
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500/50"
                        placeholder="02:00"
                      />
                    </div>
                  )}

                  {schedule.type === 'weekly' && (
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Day</label>
                      <select
                        value={schedule.day || ''}
                        onChange={(event) => updateSchedule({ day: event.target.value })}
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500/50"
                      >
                        <option value="">Select day</option>
                        {WEEK_DAYS.map((day) => (
                          <option key={day} value={day}>{day}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {schedule.type === 'interval' && (
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Interval Minutes</label>
                      <input
                        type="number"
                        value={schedule.interval_minutes ?? ''}
                        onChange={(event) => {
                          const value = event.target.value
                          updateSchedule({ interval_minutes: value ? Number(value) : undefined })
                        }}
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500/50"
                        placeholder="60"
                      />
                    </div>
                  )}

                  {schedule.type === 'cron' && (
                    <div className="md:col-span-2">
                      <label className="block text-xs text-gray-400 mb-1">Cron Expression</label>
                      <input
                        value={schedule.cron || ''}
                        onChange={(event) => updateSchedule({ cron: event.target.value })}
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500/50"
                        placeholder="0 2 * * *"
                      />
                      <p className="text-xs text-gray-500 mt-1">Minute and hour required. No ranges or steps.</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'trigger' && (
              <div className="bg-white/[0.03] border border-white/10 rounded-xl p-4">
                <div className="text-sm text-white mb-2">Trigger</div>
                <p className="text-sm text-gray-400">
                  Triggers are currently limited to manual runs or scheduled runs. Choose a schedule
                  in the Schedule tab to activate automation.
                </p>
              </div>
            )}

            {activeTab === 'prompt' && (
              <div className="space-y-4">
                <div className="bg-white/[0.03] border border-white/10 rounded-xl p-4">
                  <label className="block text-xs text-gray-400 mb-2">Prompt</label>
                  <textarea
                    value={formState.prompt}
                    onChange={(event) => handleFieldChange('prompt', event.target.value)}
                    className="w-full min-h-[220px] bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500/50"
                    placeholder="Write instructions here..."
                  />
                </div>

                <div className="bg-white/[0.03] border border-white/10 rounded-xl p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm text-white">Context Sources</div>
                      <p className="text-xs text-gray-500">Optional files or inline data to inject before the prompt.</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => addContextSource('file')}
                        className="text-xs text-gray-300 bg-white/5 border border-white/10 px-2 py-1 rounded-lg hover:bg-white/10"
                      >
                        + File
                      </button>
                      <button
                        onClick={() => addContextSource('glob')}
                        className="text-xs text-gray-300 bg-white/5 border border-white/10 px-2 py-1 rounded-lg hover:bg-white/10"
                      >
                        + Glob
                      </button>
                      <button
                        onClick={() => addContextSource('text')}
                        className="text-xs text-gray-300 bg-white/5 border border-white/10 px-2 py-1 rounded-lg hover:bg-white/10"
                      >
                        + Text
                      </button>
                    </div>
                  </div>

                  {formState.context.length === 0 && (
                    <div className="text-xs text-gray-500">No context sources yet.</div>
                  )}

                  {formState.context.map((source, index) => (
                    <div key={`${source.type}-${index}`} className="border border-white/10 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs text-gray-400 uppercase">{source.type}</span>
                        <button
                          onClick={() => removeContextSource(index)}
                          className="text-xs text-red-300 hover:text-red-200"
                        >
                          Remove
                        </button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">Title</label>
                          <input
                            value={source.title || ''}
                            onChange={(event) => updateContextSource(index, { title: event.target.value })}
                            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-orange-500/50"
                          />
                        </div>

                        {source.type === 'file' && (
                          <div>
                            <label className="block text-xs text-gray-400 mb-1">Path</label>
                            <input
                              value={source.path}
                              onChange={(event) => updateContextSource(index, { path: event.target.value })}
                              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-orange-500/50"
                              placeholder="Vault/..."
                            />
                          </div>
                        )}

                        {source.type === 'glob' && (
                          <div>
                            <label className="block text-xs text-gray-400 mb-1">Glob Pattern</label>
                            <input
                              value={source.pattern}
                              onChange={(event) => updateContextSource(index, { pattern: event.target.value })}
                              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-orange-500/50"
                              placeholder="Vault/1 - Inbox/**/*.md"
                            />
                          </div>
                        )}

                        {source.type === 'text' && (
                          <div className="md:col-span-2">
                            <label className="block text-xs text-gray-400 mb-1">Text</label>
                            <textarea
                              value={source.text}
                              onChange={(event) => updateContextSource(index, { text: event.target.value })}
                              className="w-full min-h-[80px] bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-orange-500/50"
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="bg-white/[0.03] border border-white/10 rounded-xl p-4 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Output Path</label>
                      <input
                        value={formState.output.path}
                        onChange={(event) =>
                          handleFieldChange('output', { ...formState.output, path: event.target.value })
                        }
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-orange-500/50"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Runner Model</label>
                      <select
                        value={formState.runner.model}
                        onChange={(event) =>
                          handleFieldChange('runner', { ...formState.runner, model: event.target.value })
                        }
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-orange-500/50"
                      >
                        {RUNNER_MODELS.map((model) => (
                          <option key={model} value={model}>{model}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Timeout (sec)</label>
                      <input
                        type="number"
                        value={formState.runner.timeout_sec ?? ''}
                        onChange={(event) =>
                          handleFieldChange('runner', {
                            ...formState.runner,
                            timeout_sec: event.target.value
                              ? Number(event.target.value)
                              : formState.runner.timeout_sec,
                          })
                        }
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-orange-500/50"
                      />
                    </div>
                    <div className="flex items-center gap-2 mt-6">
                      <input
                        type="checkbox"
                        checked={formState.output.overwrite}
                        onChange={(event) =>
                          handleFieldChange('output', { ...formState.output, overwrite: event.target.checked })
                        }
                        className="h-4 w-4"
                      />
                      <span className="text-xs text-gray-400">Overwrite existing output</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'yaml' && (
              <div className="bg-white/[0.03] border border-white/10 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm text-white flex items-center gap-2">
                      <Code className="w-4 h-4" />
                      Raw YAML
                    </div>
                    <p className="text-xs text-gray-500">
                      Editing YAML overwrites form fields and removes formatting/comments.
                    </p>
                  </div>
                  <button
                    onClick={() => setUseRawYaml(!useRawYaml)}
                    className={`text-xs px-3 py-1 rounded-lg border transition ${
                      useRawYaml
                        ? 'bg-orange-500/20 text-orange-200 border-orange-500/30'
                        : 'bg-white/5 text-gray-300 border-white/10'
                    }`}
                  >
                    {useRawYaml ? 'YAML Editing Enabled' : 'Enable YAML Editing'}
                  </button>
                </div>

                <textarea
                  value={rawYaml}
                  onChange={(event) => {
                    setRawYaml(event.target.value)
                    setUseRawYaml(true)
                  }}
                  className="w-full min-h-[320px] bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-orange-500/50"
                  placeholder="YAML will appear after first save."
                  readOnly={!useRawYaml}
                />
              </div>
            )}
          </div>

          <aside className="bg-white/[0.03] border border-white/10 rounded-xl p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-sm text-white">Past Executions</div>
              {!isNew && (
                <button
                  onClick={() => workflowId && loadHistory(workflowId)}
                  className="text-xs text-gray-400 hover:text-white flex items-center gap-1"
                >
                  <RefreshCw className="w-3 h-3" />
                  Refresh
                </button>
              )}
            </div>

            {history.length === 0 && (
              <div className="text-xs text-gray-500">No runs yet.</div>
            )}

            {history.map((entry, index) => (
              <div key={`${entry.timestamp}-${index}`} className="border border-white/10 rounded-lg p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-300">{entry.status || 'unknown'}</span>
                  <span className="text-[11px] text-gray-500">{relativeTime(entry.timestamp)}</span>
                </div>
                <div className="text-[11px] text-gray-500">Duration: {formatDuration(entry.duration_ms)}</div>
                {entry.output_path && (
                  <div className="text-[11px] text-gray-400 mt-1 break-all">{entry.output_path}</div>
                )}
                {entry.error && (
                  <div className="text-[11px] text-red-300 mt-1 break-all">{entry.error}</div>
                )}
              </div>
            ))}

            {!isNew && (
              <button
                onClick={handleDelete}
                className="mt-3 w-full flex items-center justify-center gap-2 text-xs text-red-200 border border-red-500/20 bg-red-500/10 rounded-lg py-2 hover:bg-red-500/20"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete Workflow
              </button>
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}
