import { useEffect, useState } from 'react'
import {
  ArrowLeft,
  Workflow as WorkflowIcon,
  Play,
  Pause,
  RefreshCw,
  FileText,
  Clock,
  AlertCircle,
  Plus,
  Pencil,
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

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8767'

function formatSchedule(schedule?: WorkflowSchedule): string {
  if (!schedule || schedule.type === 'manual') return 'Manual'

  if (schedule.type === 'daily') {
    return `Daily at ${schedule.time || '??:??'}`
  }

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

  if (schedule.type === 'cron') {
    return `Cron: ${schedule.cron || ''}`
  }

  return schedule.type
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

export function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<WorkflowInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [runningId, setRunningId] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const fetchWorkflows = async () => {
    try {
      setError(null)
      const response = await fetch(`${API_BASE_URL}/api/workflows`)
      if (!response.ok) {
        throw new Error('Failed to load workflows')
      }
      const data = await response.json() as WorkflowInfo[]
      setWorkflows(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error('Failed to fetch workflows', err)
      setError(err instanceof Error ? err.message : 'Failed to load workflows')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchWorkflows()
  }, [])

  const runWorkflow = async (id: string) => {
    try {
      setRunningId(id)
      const response = await fetch(`${API_BASE_URL}/api/workflows/${id}/run`, { method: 'POST' })
      if (!response.ok) {
        throw new Error('Failed to start workflow')
      }
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'Failed to run workflow')
    } finally {
      setRunningId(null)
    }
  }

  const toggleWorkflow = async (workflow: WorkflowInfo) => {
    try {
      setTogglingId(workflow.id)
      const endpoint = workflow.enabled ? 'disable' : 'enable'
      const response = await fetch(`${API_BASE_URL}/api/workflows/${workflow.id}/${endpoint}`, {
        method: 'POST',
      })
      if (!response.ok) {
        throw new Error('Failed to update workflow status')
      }
      await fetchWorkflows()
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'Failed to update workflow status')
    } finally {
      setTogglingId(null)
    }
  }

  return (
    <div className="min-h-screen bg-black">
      <header className="h-14 border-b border-white/10 flex items-center gap-4 px-4">
        <a
          href="#/agents"
          className="p-2 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition"
        >
          <ArrowLeft className="w-5 h-5" />
        </a>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-orange-500/20">
            <WorkflowIcon className="w-5 h-5 text-orange-400" />
          </div>
          <div>
            <h1 className="text-white font-medium">Scheduled Workflows</h1>
            <p className="text-xs text-gray-500">Edit schedules and prompts here or in YAML</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <a
            href="#/workflows/new"
            className="flex items-center gap-2 px-3 py-1.5 text-xs text-orange-200 bg-orange-500/10 border border-orange-500/30 rounded-lg hover:bg-orange-500/20 transition"
          >
            <Plus className="w-3.5 h-3.5" />
            New Workflow
          </a>
          <button
            onClick={fetchWorkflows}
            className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-400 bg-white/5 border border-white/10 rounded-lg hover:text-white hover:bg-white/10 transition"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>
      </header>

      <div className="max-w-6xl mx-auto p-6">
        {error && (
          <div className="mb-6 flex items-center gap-2 text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-gray-500">Loading workflows...</div>
        ) : workflows.length === 0 ? (
          <div className="bg-white/[0.03] border border-white/10 rounded-xl p-6 text-gray-400">
            No workflows found. Add a YAML file in
            <span className="text-gray-200"> skills/Scheduled Workflows/workflows/</span>.
          </div>
        ) : (
          <div className="space-y-4">
            {workflows.map((workflow) => (
              <div
                key={workflow.id}
                className="bg-white/[0.03] border border-white/10 rounded-xl p-4 hover:bg-white/5 hover:border-white/20 transition"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h2 className="text-white font-medium truncate">{workflow.name}</h2>
                      <span
                        className={`text-[11px] px-2 py-0.5 rounded-full border ${
                          workflow.enabled
                            ? 'bg-green-500/10 text-green-300 border-green-500/30'
                            : 'bg-white/5 text-gray-400 border-white/10'
                        }`}
                      >
                        {workflow.enabled ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    {workflow.description && (
                      <p className="text-sm text-gray-400 mb-3">{workflow.description}</p>
                    )}

                    <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" />
                        {formatSchedule(workflow.schedule)}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5" />
                        {workflow.config_path}
                      </div>
                      <div className="text-gray-500">Last run: {relativeTime(workflow.last_run)}</div>
                    </div>

                    {workflow.output_path && (
                      <div className="mt-3 text-xs text-gray-500">
                        Output: <span className="text-gray-300">{workflow.output_path}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-2">
                    <a
                      href={`#/workflows/${workflow.id}`}
                      className="flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium rounded-lg bg-white/5 text-gray-200 border border-white/10 hover:bg-white/10 transition"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      Edit
                    </a>
                    <button
                      onClick={() => runWorkflow(workflow.id)}
                      disabled={runningId === workflow.id}
                      className="flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium rounded-lg bg-white/5 text-gray-200 border border-white/10 hover:bg-white/10 transition disabled:opacity-60"
                    >
                      <Play className="w-3.5 h-3.5" />
                      {runningId === workflow.id ? 'Running...' : 'Run'}
                    </button>
                    <button
                      onClick={() => toggleWorkflow(workflow)}
                      disabled={togglingId === workflow.id}
                      className={`flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium rounded-lg border transition disabled:opacity-60 ${
                        workflow.enabled
                          ? 'bg-red-500/10 text-red-200 border-red-500/20 hover:bg-red-500/20'
                          : 'bg-green-500/10 text-green-200 border-green-500/20 hover:bg-green-500/20'
                      }`}
                    >
                      {workflow.enabled ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                      {workflow.enabled ? 'Disable' : 'Enable'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-8 text-xs text-gray-500">
          Edit workflows in the UI or by modifying YAML in
          <span className="text-gray-300"> skills/Scheduled Workflows/workflows/</span>.
        </div>
      </div>
    </div>
  )
}
