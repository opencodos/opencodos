import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { API_BASE_URL, integrationAPI } from '@/lib/api'

// ==================== Types ====================

interface SyncStatus {
  connector: string
  status: 'pending' | 'syncing' | 'done' | 'error'
  progress?: number
  message?: string
}

interface PreflightResult {
  connector: string
  ready: boolean
  reason: string | null
}

type SyncPhase = 'preflight' | 'syncing' | 'complete'

interface FirstSyncStepProps {
  connectors: string[]
  onSyncComplete: () => void
}

const CONNECTOR_NAMES: Record<string, string> = {
  telegram: 'Telegram',
  slack: 'Slack',
  gmail: 'Gmail',
  google: 'Google Workspace',
  googlecalendar: 'Google Calendar',
  calendar: 'Google Calendar',
  notion: 'Notion',
  linear: 'Linear',
  googledrive: 'Google Drive',
  granola: 'Granola',
}

// ==================== Error mapping ====================

const ERROR_PATTERNS: [RegExp, string][] = [
  [/timeout/i, 'Sync timed out, try again'],
  [/ENOENT/i, 'Sync script not found'],
  [/ECONNREFUSED/i, 'Service unavailable, check if backend is running'],
  [/bun not found/i, 'bun runtime not installed'],
  [/session/i, 'Authentication session expired or missing'],
  [/rate.?limit/i, 'Rate limited by provider, try again later'],
  [/401|unauthorized/i, 'Authentication failed, reconnect the service'],
  [/403|forbidden/i, 'Permission denied by provider'],
]

function friendlyError(raw: string): string {
  for (const [pattern, message] of ERROR_PATTERNS) {
    if (pattern.test(raw)) return message
  }
  return raw
}

// Google Workspace expands into individual sync services
const GOOGLE_SUB_CONNECTORS = ['gmail', 'calendar']

function expandConnectors(connectors: string[]): string[] {
  return connectors.flatMap(c => c === 'google' ? GOOGLE_SUB_CONNECTORS : [c])
}

// ==================== Component ====================

export function FirstSyncStep({ connectors: rawConnectors, onSyncComplete }: FirstSyncStepProps) {
  const connectors = useMemo(() => expandConnectors(rawConnectors), [rawConnectors])
  const [phase, setPhase] = useState<SyncPhase>('preflight')
  const [preflightResults, setPreflightResults] = useState<PreflightResult[]>([])
  const [preflightLoading, setPreflightLoading] = useState(true)
  const [syncStatuses, setSyncStatuses] = useState<SyncStatus[]>([])
  const [overallProgress, setOverallProgress] = useState(0)
  const [hasErrors, setHasErrors] = useState(false)
  const [taskId, setTaskId] = useState<string | null>(null)
  const pollingRef = useRef(false)
  const mountedRef = useRef(false)

  // Cancel telegram sync on unmount (user navigated away while sync running)
  const connectorsRef = useRef(connectors)
  connectorsRef.current = connectors
  useEffect(() => {
    return () => {
      if (pollingRef.current && connectorsRef.current.includes('telegram')) {
        integrationAPI.cancelTelegramSync().catch(() => {})
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ==================== Preflight ====================

  useEffect(() => {
    // Prevent double initialization in React StrictMode
    if (mountedRef.current) return
    mountedRef.current = true

    if (connectors.length === 0) {
      setPhase('complete')
      onSyncComplete()
      return
    }

    const runPreflight = async () => {
      setPreflightLoading(true)
      try {
        const res = await fetch(`${API_BASE_URL}/api/setup/sync/preflight`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connectors }),
        })
        if (!res.ok) {
          // Preflight endpoint not available, skip to syncing
          startSyncing(connectors)
          return
        }
        const data = await res.json()
        setPreflightResults(data.results)
        if (data.all_ready) {
          // All ready, auto-start sync
          startSyncing(connectors)
        } else {
          setPreflightLoading(false)
        }
      } catch {
        // Preflight failed, skip to syncing directly
        startSyncing(connectors)
      }
    }

    runPreflight()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectors.length])

  // ==================== Syncing ====================

  const pollStatus = useCallback(async (tid: string, targetConnectors: string[]) => {
    if (pollingRef.current) return
    pollingRef.current = true

    const poll = async () => {
      if (!pollingRef.current) return

      try {
        const statusResponse = await fetch(
          `${API_BASE_URL}/api/setup/sync/status/${tid}`
        )

        if (!statusResponse.ok) {
          throw new Error('Failed to get sync status')
        }

        const status = await statusResponse.json()

        // Map API status to UI status -- only update targetConnectors
        setSyncStatuses(prev => prev.map((s) => {
          if (!targetConnectors.includes(s.connector)) return s

          const connectorStatus = status.connectors[s.connector]
          if (!connectorStatus) {
            return { ...s, status: 'pending' as const, progress: 0 }
          }

          let uiStatus: SyncStatus['status'] = 'pending'
          if (connectorStatus.status === 'completed') {
            uiStatus = 'done'
          } else if (connectorStatus.status === 'failed' || connectorStatus.status === 'error') {
            uiStatus = 'error'
          } else if (
            ['connecting', 'fetching', 'processing', 'syncing'].includes(connectorStatus.status)
          ) {
            uiStatus = 'syncing'
          }

          const rawProgress = typeof connectorStatus.progress === 'number' ? connectorStatus.progress : 0
          const progressPercent = rawProgress <= 1 ? Math.round(rawProgress * 100) : Math.round(rawProgress)

          return {
            connector: s.connector,
            status: uiStatus,
            progress: progressPercent,
            message: friendlyError(connectorStatus.message || connectorStatus.error || 'Waiting...'),
          }
        }))

        const rawOverall = typeof status.progress === 'number' ? status.progress : 0
        const overallPercent = rawOverall <= 1 ? rawOverall * 100 : rawOverall
        setOverallProgress(overallPercent)

        // Continue polling or complete
        if (status.status === 'running' || status.status === 'pending') {
          setTimeout(poll, 500)
        } else {
          pollingRef.current = false
          // Check ALL statuses for errors
          setSyncStatuses(prev => {
            const terminalHasErrors =
              status.status === 'failed' ||
              prev.some((cs) => {
                if (targetConnectors.includes(cs.connector)) {
                  const apiStatus = status.connectors[cs.connector]
                  return apiStatus?.status === 'failed' || apiStatus?.status === 'error'
                }
                return cs.status === 'error'
              })
            setHasErrors(terminalHasErrors)
            return prev
          })
          setPhase('complete')
          onSyncComplete()
        }
      } catch (error) {
        console.error('Polling error:', error)
        pollingRef.current = false
        setSyncStatuses((prev) =>
          prev.map((s) =>
            targetConnectors.includes(s.connector)
              ? { ...s, status: 'error' as const, message: 'Sync failed' }
              : s
          )
        )
        setHasErrors(true)
        setPhase('complete')
        onSyncComplete()
      }
    }

    poll()
  }, [onSyncComplete])

  const startSyncing = useCallback(async (connectorsToSync: string[]) => {
    setPhase('syncing')
    setHasErrors(false)
    setOverallProgress(0)

    const initialStatuses: SyncStatus[] = connectors.map((c) => ({
      connector: c,
      status: connectorsToSync.includes(c) ? 'pending' as const : 'pending' as const,
      progress: 0,
    }))
    setSyncStatuses(initialStatuses)

    try {
      const startResponse = await fetch(`${API_BASE_URL}/api/setup/sync/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectors: connectorsToSync }),
      })

      if (!startResponse.ok) {
        throw new Error('Failed to start sync')
      }

      const { task_id } = await startResponse.json()
      setTaskId(task_id)
      pollStatus(task_id, connectorsToSync)
    } catch (error) {
      console.error('Start sync error:', error)
      setSyncStatuses((prev) =>
        prev.map((s) =>
          connectorsToSync.includes(s.connector)
            ? { ...s, status: 'error' as const, message: 'Failed to start sync' }
            : s
        )
      )
      setHasErrors(true)
      setPhase('complete')
      onSyncComplete()
    }
  }, [connectors, onSyncComplete, pollStatus])

  // ==================== Retry ====================

  const handleRetryConnector = useCallback(async (connector: string) => {
    if (!taskId) return

    setPhase('syncing')
    setHasErrors(false)

    // Reset the connector to pending
    setSyncStatuses(prev => prev.map(s =>
      s.connector === connector
        ? { ...s, status: 'pending' as const, progress: 0, message: undefined }
        : s
    ))

    try {
      const res = await fetch(`${API_BASE_URL}/api/setup/sync/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: taskId, connectors: [connector] }),
      })

      if (!res.ok) throw new Error('Retry failed')

      const data = await res.json()
      pollStatus(data.task_id, [connector])
    } catch (error) {
      console.error('Retry error:', error)
      setSyncStatuses(prev => prev.map(s =>
        s.connector === connector
          ? { ...s, status: 'error' as const, message: 'Retry failed' }
          : s
      ))
      setHasErrors(true)
      setPhase('complete')
    }
  }, [taskId, pollStatus])

  const handleRetryAllFailed = useCallback(async () => {
    if (!taskId) return

    const failedConnectors = syncStatuses
      .filter(s => s.status === 'error')
      .map(s => s.connector)

    if (failedConnectors.length === 0) return

    setPhase('syncing')
    setHasErrors(false)

    // Reset failed connectors to pending
    setSyncStatuses(prev => prev.map(s =>
      failedConnectors.includes(s.connector)
        ? { ...s, status: 'pending' as const, progress: 0, message: undefined }
        : s
    ))

    try {
      const res = await fetch(`${API_BASE_URL}/api/setup/sync/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: taskId, connectors: failedConnectors }),
      })

      if (!res.ok) throw new Error('Retry failed')

      const data = await res.json()
      pollStatus(data.task_id, failedConnectors)
    } catch (error) {
      console.error('Retry all failed error:', error)
      setSyncStatuses(prev => prev.map(s =>
        failedConnectors.includes(s.connector)
          ? { ...s, status: 'error' as const, message: 'Retry failed' }
          : s
      ))
      setHasErrors(true)
      setPhase('complete')
    }
  }, [taskId, syncStatuses, pollStatus])

  // ==================== Render: No connectors ====================

  if (connectors.length === 0) {
    return (
      <div className="space-y-6">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-light mb-2 text-white">Initial Sync</h1>
          <p className="text-gray-400">No connectors to sync</p>
        </div>

        <div className="flex flex-col items-center justify-center py-12">
          <div className="w-16 h-16 rounded-full bg-gray-500/20 flex items-center justify-center border border-gray-500/30 mb-4">
            <svg className="w-8 h-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-gray-400 text-center">
            No connectors selected.
            <br />
            You can add them later from settings.
          </p>
        </div>
      </div>
    )
  }

  // ==================== Render: Preflight ====================

  if (phase === 'preflight' && !preflightLoading) {
    const readyConnectors = preflightResults.filter(r => r.ready).map(r => r.connector)
    const notReadyResults = preflightResults.filter(r => !r.ready)

    return (
      <div className="space-y-6">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-light mb-2 text-white">Initial Sync</h1>
          <p className="text-gray-400">Checking connector readiness...</p>
        </div>

        <div className="space-y-3">
          {preflightResults.map((result) => (
            <div
              key={result.connector}
              className="flex items-center gap-4 p-4 bg-black/30 rounded-xl border border-atlas-border"
            >
              <div className="w-8 h-8 rounded-lg flex items-center justify-center">
                {result.ready ? (
                  <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <p className="font-medium text-white">
                  {CONNECTOR_NAMES[result.connector] || result.connector}
                </p>
                <p className="text-xs text-gray-500">
                  {result.ready ? 'Ready to sync' : result.reason}
                </p>
              </div>
            </div>
          ))}
        </div>

        {notReadyResults.length > 0 && (
          <div className="mt-4 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
            <p className="text-yellow-400 text-sm mb-3">
              {notReadyResults.length} connector{notReadyResults.length > 1 ? 's' : ''} not ready.
              You can sync the ready ones now and fix the rest later.
            </p>
          </div>
        )}

        {readyConnectors.length > 0 && (
          <button
            onClick={() => startSyncing(readyConnectors)}
            className="w-full py-3 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white font-medium rounded-xl transition-all duration-200"
          >
            {readyConnectors.length === connectors.length
              ? 'Start Sync'
              : `Sync ${readyConnectors.length} Ready Connector${readyConnectors.length > 1 ? 's' : ''}`
            }
          </button>
        )}

        {readyConnectors.length === 0 && (
          <button
            onClick={() => {
              setPhase('complete')
              onSyncComplete()
            }}
            className="w-full py-3 bg-atlas-card hover:bg-atlas-card/80 text-gray-300 font-medium rounded-xl border border-atlas-border transition-all duration-200"
          >
            Skip Sync
          </button>
        )}
      </div>
    )
  }

  // ==================== Render: Syncing / Complete ====================

  return (
    <div className="space-y-6">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-light mb-2 text-white">Initial Sync</h1>
        <p className="text-gray-400">
          {phase === 'complete' ? 'Sync complete!' : phase === 'preflight' ? 'Checking readiness...' : 'Syncing your data sources...'}
        </p>
      </div>

      {/* Overall progress */}
      <div className="mb-6">
        <div className="flex justify-between text-sm mb-2">
          <span className="text-gray-400">Overall progress</span>
          <span className="text-white">{Math.round(overallProgress)}%</span>
        </div>
        <div className="h-2 bg-atlas-card rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-orange-400 to-orange-500 transition-all duration-300"
            style={{ width: `${overallProgress}%` }}
          />
        </div>
      </div>

      {/* Individual connector status */}
      <div className="space-y-3">
        {syncStatuses.map((status) => (
          <div
            key={status.connector}
            className="flex items-center gap-4 p-4 bg-black/30 rounded-xl border border-atlas-border"
          >
            {/* Status icon */}
            <div className="w-8 h-8 rounded-lg flex items-center justify-center">
              {status.status === 'pending' && (
                <div className="w-4 h-4 rounded-full border-2 border-gray-600" />
              )}
              {status.status === 'syncing' && (
                <div className="w-5 h-5 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
              )}
              {status.status === 'done' && (
                <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
              {status.status === 'error' && (
                <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              )}
            </div>

            {/* Name and message */}
            <div className="flex-1 min-w-0">
              <p className="font-medium text-white">
                {CONNECTOR_NAMES[status.connector] || status.connector}
              </p>
              <p className="text-xs text-gray-500">{status.message || 'Waiting...'}</p>
            </div>

            {/* Progress or Retry button */}
            {status.status === 'syncing' && (
              <div className="w-16 text-right">
                <span className="text-sm text-gray-400">{status.progress}%</span>
              </div>
            )}
            {phase === 'complete' && status.status === 'error' && (
              <button
                onClick={() => handleRetryConnector(status.connector)}
                className="px-3 py-1.5 bg-orange-500/20 hover:bg-orange-500/30 border border-orange-500/30 rounded-lg text-orange-300 text-xs whitespace-nowrap transition-colors"
              >
                Retry
              </button>
            )}
          </div>
        ))}
      </div>

      {phase === 'complete' && !hasErrors && (
        <div className="mt-6 p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
          <p className="text-green-400 text-sm text-center">
            All connectors synced successfully! Click Continue to finish setup.
          </p>
        </div>
      )}

      {phase === 'complete' && hasErrors && (
        <div className="mt-6 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg flex items-center justify-between gap-4">
          <p className="text-yellow-400 text-sm">
            Some connectors failed to sync.
          </p>
          <button
            onClick={handleRetryAllFailed}
            className="px-4 py-2 bg-yellow-500/20 hover:bg-yellow-500/30 border border-yellow-500/30 rounded-lg text-yellow-300 text-sm whitespace-nowrap"
          >
            Retry All Failed
          </button>
        </div>
      )}
    </div>
  )
}
