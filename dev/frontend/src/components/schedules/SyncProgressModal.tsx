import { useEffect, useState, useCallback, useRef } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { SERVICE_ICONS } from '@/components/connectors/service-icons'
import { API_BASE_URL } from '@/lib/api'

interface SyncProgressModalProps {
  connector: string
  connectorName: string
  isOpen: boolean
  onClose: () => void
}

type SyncPhase = 'connecting' | 'fetching' | 'processing' | 'complete' | 'error'

const PHASE_MESSAGES: Record<SyncPhase, string> = {
  connecting: 'Connecting...',
  fetching: 'Fetching data...',
  processing: 'Processing...',
  complete: 'Complete',
  error: 'Sync failed',
}

export function SyncProgressModal({
  connector,
  connectorName,
  isOpen,
  onClose,
}: SyncProgressModalProps) {
  const [phase, setPhase] = useState<SyncPhase>('connecting')
  const [progress, setProgress] = useState(0)
  const [statusMessage, setStatusMessage] = useState('Connecting...')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isFinished, setIsFinished] = useState(false)
  const taskIdRef = useRef<string | null>(null)
  const pollingRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearTimeout(pollingRef.current)
      pollingRef.current = null
    }
  }, [])

  const pollStatus = useCallback(async () => {
    if (!taskIdRef.current) return

    try {
      const statusResponse = await fetch(
        `${API_BASE_URL}/api/setup/sync/status/${taskIdRef.current}`
      )

      if (!statusResponse.ok) {
        throw new Error('Failed to get sync status')
      }

      const status = await statusResponse.json()
      const connectorStatus = status.connectors?.[connector]

      if (connectorStatus) {
        // Map backend status to UI phase
        const connectorTaskStatus = String(connectorStatus.status || '')
        let newPhase: SyncPhase = 'connecting'
        if (connectorTaskStatus === 'connecting' || connectorTaskStatus === 'pending') {
          newPhase = 'connecting'
        } else if (connectorTaskStatus === 'fetching') {
          newPhase = 'fetching'
        } else if (connectorTaskStatus === 'processing' || connectorTaskStatus === 'syncing' || connectorTaskStatus === 'running') {
          newPhase = 'processing'
        } else if (connectorTaskStatus === 'completed' || connectorTaskStatus === 'complete') {
          newPhase = 'complete'
        } else if (connectorTaskStatus === 'failed' || connectorTaskStatus === 'error') {
          newPhase = 'error'
        }

        const rawProgress = typeof connectorStatus.progress === 'number' ? connectorStatus.progress : 0
        const progressPercent = rawProgress <= 1 ? Math.round(rawProgress * 100) : Math.round(rawProgress)

        setPhase(newPhase)
        setProgress(progressPercent)
        setStatusMessage(
          connectorStatus.message || PHASE_MESSAGES[newPhase]
        )

        if (connectorTaskStatus === 'failed' || connectorTaskStatus === 'error') {
          setErrorMessage(connectorStatus.error || 'An error occurred during sync')
          setIsFinished(true)
          stopPolling()
          return
        }
      }

      // Check if sync is complete
      if (status.status === 'completed' || status.status === 'complete' || status.status === 'failed' || status.status === 'error') {
        setIsFinished(true)
        if (status.status === 'completed' || status.status === 'complete') {
          setPhase('complete')
          setProgress(100)
          setStatusMessage('Complete')
        } else {
          setPhase('error')
          setErrorMessage(connectorStatus?.error || status.error || 'Sync failed')
        }
        stopPolling()
      } else {
        // Continue polling
        pollingRef.current = setTimeout(pollStatus, 500)
      }
    } catch (error) {
      console.error('Polling error:', error)
      setPhase('error')
      setErrorMessage('Failed to fetch sync status')
      setIsFinished(true)
      stopPolling()
    }
  }, [connector, stopPolling])

  const startSync = useCallback(async () => {
    setPhase('connecting')
    setProgress(0)
    setStatusMessage('Connecting...')
    setErrorMessage(null)
    setIsFinished(false)

    try {
      const startResponse = await fetch(`${API_BASE_URL}/api/setup/sync/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectors: [connector] }),
      })

      if (!startResponse.ok) {
        throw new Error('Failed to start sync')
      }

      const { task_id } = await startResponse.json()
      taskIdRef.current = task_id

      // Start polling
      pollStatus()
    } catch (error) {
      console.error('Start sync error:', error)
      setPhase('error')
      setErrorMessage('Failed to start sync')
      setIsFinished(true)
    }
  }, [connector, pollStatus])

  useEffect(() => {
    if (isOpen) {
      startSync()
    }

    return () => {
      stopPolling()
    }
  }, [isOpen, startSync, stopPolling])

  const handleClose = () => {
    stopPolling()
    taskIdRef.current = null
    onClose()
  }

  const IconComponent = SERVICE_ICONS[connector]

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent
        className="bg-atlas-card border-atlas-border sm:max-w-md"
        showCloseButton={false}
      >
        <DialogHeader className="items-center">
          {/* Connector icon */}
          <div className="w-16 h-16 rounded-2xl bg-white/10 flex items-center justify-center mb-2">
            {IconComponent ? (
              <IconComponent className="w-8 h-8" />
            ) : (
              <div className="w-8 h-8 rounded-lg bg-gray-600 flex items-center justify-center text-white text-sm font-medium">
                {connectorName.charAt(0).toUpperCase()}
              </div>
            )}
          </div>
          <DialogTitle className="text-white text-xl">{connectorName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Progress bar */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">{statusMessage}</span>
              <span className="text-white font-medium">{Math.round(progress)}%</span>
            </div>
            <div className="h-2 bg-black/30 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ${
                  phase === 'error'
                    ? 'bg-red-500'
                    : phase === 'complete'
                    ? 'bg-green-500'
                    : 'bg-gradient-to-r from-orange-400 to-orange-500'
                }`}
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {/* Status indicator */}
          <div className="flex items-center justify-center gap-3">
            {phase === 'error' ? (
              <div className="flex items-center gap-2 text-red-400">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
                <span className="text-sm">{errorMessage}</span>
              </div>
            ) : phase === 'complete' ? (
              <div className="flex items-center gap-2 text-green-400">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                <span className="text-sm">Sync completed successfully</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-gray-400">
                <div className="w-5 h-5 border-2 border-orange-500/30 border-t-orange-500 rounded-full animate-spin" />
                <span className="text-sm">Syncing in progress...</span>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <button
            onClick={handleClose}
            disabled={!isFinished}
            className={`w-full py-3 px-4 rounded-xl font-medium transition-all ${
              isFinished
                ? phase === 'error'
                  ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30'
                  : 'bg-green-500/20 text-green-400 hover:bg-green-500/30 border border-green-500/30'
                : 'bg-gray-700/50 text-gray-500 cursor-not-allowed border border-gray-700'
            }`}
          >
            {isFinished ? 'Close' : 'Syncing...'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
