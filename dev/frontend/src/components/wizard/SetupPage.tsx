import { useState, useReducer, useCallback, useEffect } from 'react'
import { API_BASE_URL } from '@/lib/api'
import { getDesktopAtlasApiKey } from '@/lib/desktopRuntimeBootstrap'
import { isDesktopRuntimeAvailable } from '@/lib/desktopRuntime'
import { WizardLayout } from './WizardLayout'
import { WelcomeStep } from './WelcomeStep'
import { DependencyCheck } from '../setup/DependencyCheck'
import { ConnectorsStep } from './ConnectorsStep'
import { TelegramAuthStep } from './TelegramAuthStep'
import { TelegramConversationStep } from './TelegramConversationStep'
import { FirstSyncStep } from './FirstSyncStep'
import { ScheduleConfigStep } from './ScheduleConfigStep'

const WIZARD_STORAGE_KEY = 'codos-wizard-state'
const TOTAL_STEPS = 7

type TelegramStatus = 'idle' | 'sending' | 'code_sent' | 'verified' | 'error'

interface WizardState {
  step: number
  name: string
  timezone: string
  goals: string
  connectors: string[]
  telegramStatus: TelegramStatus
  telegramConversationsConfigured: boolean
  telegramConversationsSkipped: boolean
  syncComplete: boolean
  schedulesConfigured: boolean
  schedulesSkipped: boolean
  dependenciesOk: boolean
}

const initialState: WizardState = {
  step: 0,
  name: '',
  timezone: '',
  goals: '',
  connectors: [],
  telegramStatus: 'idle',
  telegramConversationsConfigured: false,
  telegramConversationsSkipped: false,
  syncComplete: false,
  schedulesConfigured: false,
  schedulesSkipped: false,
  dependenciesOk: false,
}

type WizardAction =
  | { type: 'SET_STEP'; step: number }
  | { type: 'SET_NAME'; name: string }
  | { type: 'SET_GOALS'; goals: string }
  | { type: 'SET_CONNECTORS'; connectors: string[] }
  | { type: 'SET_TELEGRAM_STATUS'; status: TelegramStatus }
  | { type: 'SET_TELEGRAM_CONVERSATIONS_DONE'; configured: boolean; skipped: boolean }
  | { type: 'SET_SYNC_COMPLETE'; complete: boolean }
  | { type: 'SET_SCHEDULES_DONE'; configured: boolean; skipped: boolean }
  | { type: 'SET_DEPS_OK'; ok: boolean }
  | { type: 'RESTORE'; state: WizardState }
  | { type: 'RESET' }

function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'SET_STEP':
      return { ...state, step: action.step }
    case 'SET_NAME':
      return { ...state, name: action.name }
    case 'SET_GOALS':
      return { ...state, goals: action.goals }
    case 'SET_CONNECTORS':
      return { ...state, connectors: action.connectors }
    case 'SET_TELEGRAM_STATUS':
      return { ...state, telegramStatus: action.status }
    case 'SET_TELEGRAM_CONVERSATIONS_DONE':
      return {
        ...state,
        telegramConversationsConfigured: action.configured,
        telegramConversationsSkipped: action.skipped,
      }
    case 'SET_SYNC_COMPLETE':
      return { ...state, syncComplete: action.complete }
    case 'SET_SCHEDULES_DONE':
      return {
        ...state,
        schedulesConfigured: action.configured,
        schedulesSkipped: action.skipped,
      }
    case 'SET_DEPS_OK':
      return { ...state, dependenciesOk: action.ok }
    case 'RESTORE':
      return { ...action.state }
    case 'RESET':
      return { ...initialState }
    default:
      return state
  }
}

const isBundleMode = isDesktopRuntimeAvailable()

export function SetupPage() {
  const [state, dispatch] = useReducer(wizardReducer, initialState)
  const [isSaving, setIsSaving] = useState(false)
  const [isRestoring, setIsRestoring] = useState(true)
  const [saveError, setSaveError] = useState<string | null>(null)

  const getAuthHeaders = useCallback((): Record<string, string> => {
    const atlasKey = getDesktopAtlasApiKey() || import.meta.env.VITE_ATLAS_API_KEY || ''
    return atlasKey ? { 'X-Atlas-Key': atlasKey } : {}
  }, [])

  // Restore wizard state from localStorage on mount
  useEffect(() => {
    const restore = async () => {
      const saved = localStorage.getItem(WIZARD_STORAGE_KEY)
      if (saved) {
        try {
          const parsed: WizardState = JSON.parse(saved)

          // If saved step is past welcome, verify backend config still exists.
          if (parsed.step > 1) {
            try {
              const res = await fetch(`${API_BASE_URL}/api/setup/status`)
              if (res.ok) {
                const status = await res.json()
                if (status.needs_setup) {
                  localStorage.removeItem(WIZARD_STORAGE_KEY)
                  setIsRestoring(false)
                  return
                }
              }
            } catch {
              localStorage.removeItem(WIZARD_STORAGE_KEY)
              setIsRestoring(false)
              return
            }
          }

          // In bundle mode, skip deps step
          let restoredStep = parsed.step
          if (isBundleMode && restoredStep === 1) restoredStep = 2

          dispatch({ type: 'RESTORE', state: { ...parsed, step: restoredStep } })
        } catch (e) {
          console.error('Failed to restore wizard state:', e)
          localStorage.removeItem(WIZARD_STORAGE_KEY)
        }
      }
      setIsRestoring(false)
    }
    restore()
  }, [])

  // Save wizard state to localStorage whenever state changes
  useEffect(() => {
    if (isRestoring) return
    localStorage.setItem(WIZARD_STORAGE_KEY, JSON.stringify(state))
  }, [isRestoring, state])

  // Fetch system info on mount
  useEffect(() => {
    if (isRestoring) return
    if (state.name && state.timezone) return

    fetch(`${API_BASE_URL}/api/setup/detect-system-info`)
      .then(res => res.json())
      .then(data => {
        if (data.name && !state.name) dispatch({ type: 'SET_NAME', name: data.name })
        if (data.timezone && !state.timezone) {
          // timezone is not in reducer since it's only set once; store it directly
          dispatch({ type: 'RESTORE', state: { ...state, timezone: data.timezone } })
        }
      })
      .catch(() => {
        if (!state.timezone) {
          dispatch({ type: 'RESTORE', state: { ...state, timezone: 'America/Los_Angeles' } })
        }
      })
  }, [isRestoring]) // eslint-disable-line react-hooks/exhaustive-deps

  const canProceed = () => {
    switch (state.step) {
      case 0: // Welcome + Goals
        return true
      case 1: // Dependencies
        return state.dependenciesOk
      case 2: // Connectors
        return true
      case 3: // Telegram Auth
        if (!state.connectors.includes('telegram')) return true
        return state.telegramStatus === 'verified'
      case 4: // Telegram Conversations
        if (!state.connectors.includes('telegram')) return true
        if (state.telegramStatus !== 'verified') return true
        return state.telegramConversationsConfigured || state.telegramConversationsSkipped
      case 5: // First Sync
        return true
      case 6: // Schedules
        return state.schedulesConfigured || state.schedulesSkipped || state.connectors.length === 0
      default:
        return true
    }
  }

  const autoInitialize = async (): Promise<boolean> => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/setup/auto-initialize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        setSaveError(`Auto-initialize failed (${res.status}): ${body}`)
        return false
      }
      return true
    } catch (err) {
      setSaveError(`Auto-initialize failed: ${String(err)}`)
      return false
    }
  }

  const saveProgress = async () => {
    setIsSaving(true)
    setSaveError(null)
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 15000)
    try {
      const response = await fetch(`${API_BASE_URL}/api/setup/save-progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          user_name: state.name,
          timezone: state.timezone,
          goals: state.goals,
          connectors: state.connectors,
          api_keys: {},
        }),
        signal: controller.signal,
      })
      if (!response.ok) {
        const body = await response.text().catch(() => '')
        setSaveError(body ? `Failed to save progress (${response.status}): ${body}` : `Failed to save progress (${response.status})`)
        return false
      }
      return true
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setSaveError('Failed to save progress: request timed out')
      } else {
        setSaveError(`Failed to save progress: ${String(err)}`)
      }
      return false
    } finally {
      window.clearTimeout(timeoutId)
      setIsSaving(false)
    }
  }

  const saveSetup = async () => {
    setIsSaving(true)
    setSaveError(null)
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 15000)
    try {
      const response = await fetch(`${API_BASE_URL}/api/setup/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          generate_claude_md: true,
          user_name: state.name,
          timezone: state.timezone,
          connectors: state.connectors,
          goals: state.goals,
          api_keys: {},
        }),
        signal: controller.signal,
      })
      if (!response.ok) {
        const body = await response.text().catch(() => '')
        setSaveError(body ? `Failed to save setup (${response.status}): ${body}` : `Failed to save setup (${response.status})`)
        return false
      }
      return true
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setSaveError('Failed to save setup: request timed out')
      } else {
        setSaveError(`Failed to save setup: ${String(err)}`)
      }
      return false
    } finally {
      window.clearTimeout(timeoutId)
      setIsSaving(false)
    }
  }

  const finishWizard = async () => {
    const ok = await saveSetup()
    if (!ok) return
    localStorage.removeItem(WIZARD_STORAGE_KEY)
    localStorage.removeItem('atlas-agent-session')
    localStorage.setItem('atlas-autostart', 'brief')
    window.location.hash = '/agents'
  }

  const handleNext = async () => {
    const isLastStep = state.step === TOTAL_STEPS - 1

    if (isLastStep) {
      await finishWizard()
      return
    }

    // Step 0 → auto-initialize paths + vault
    if (state.step === 0) {
      const ok = await autoInitialize()
      if (!ok) return

      if (isBundleMode) {
        // Bundle mode: skip deps, jump to connectors
        dispatch({ type: 'SET_DEPS_OK', ok: true })
        dispatch({ type: 'SET_STEP', step: 2 })
        return
      }
      dispatch({ type: 'SET_STEP', step: 1 })
      return
    }

    // Save progress at checkpoints
    if (state.step === 4 || state.step === 5) {
      const ok = await saveProgress()
      if (!ok) return
    }

    dispatch({ type: 'SET_STEP', step: state.step + 1 })
  }

  const handleBack = () => {
    if (state.step <= 0) return

    if (isBundleMode && state.step === 2) {
      // Skip deps step in bundle mode
      dispatch({ type: 'SET_STEP', step: 0 })
    } else {
      dispatch({ type: 'SET_STEP', step: state.step - 1 })
    }
  }

  const handleStartOver = useCallback(() => {
    localStorage.removeItem(WIZARD_STORAGE_KEY)
    window.location.reload()
  }, [])

  const renderStep = () => {
    switch (state.step) {
      case 0:
        return (
          <WelcomeStep
            name={state.name}
            goals={state.goals}
            setGoals={(goals) => dispatch({ type: 'SET_GOALS', goals })}
            onSkip={() => dispatch({ type: 'SET_STEP', step: 1 })}
          />
        )
      case 1:
        return (
          <DependencyCheck
            onComplete={() => {
              dispatch({ type: 'SET_DEPS_OK', ok: true })
              dispatch({ type: 'SET_STEP', step: 2 })
            }}
            onSkip={() => {
              dispatch({ type: 'SET_DEPS_OK', ok: true })
              dispatch({ type: 'SET_STEP', step: 2 })
            }}
          />
        )
      case 2:
        return (
          <ConnectorsStep
            connectors={state.connectors}
            setConnectors={(connectors) => dispatch({ type: 'SET_CONNECTORS', connectors })}
          />
        )
      case 3:
        return (
          <TelegramAuthStep
            connectors={state.connectors}
            telegramStatus={state.telegramStatus}
            setTelegramStatus={(status) => dispatch({ type: 'SET_TELEGRAM_STATUS', status })}
          />
        )
      case 4:
        return (
          <TelegramConversationStep
            connectors={state.connectors}
            onComplete={() => {
              dispatch({ type: 'SET_TELEGRAM_CONVERSATIONS_DONE', configured: true, skipped: false })
              dispatch({ type: 'SET_STEP', step: 5 })
            }}
            onSkip={() => {
              dispatch({ type: 'SET_TELEGRAM_CONVERSATIONS_DONE', configured: false, skipped: true })
              dispatch({ type: 'SET_STEP', step: 5 })
            }}
          />
        )
      case 5:
        return (
          <FirstSyncStep
            connectors={state.connectors}
            onSyncComplete={() => dispatch({ type: 'SET_SYNC_COMPLETE', complete: true })}
          />
        )
      case 6:
        return (
          <ScheduleConfigStep
            connectors={state.connectors}
            onComplete={async () => {
              dispatch({ type: 'SET_SCHEDULES_DONE', configured: true, skipped: false })
              await finishWizard()
            }}
            onSkip={async () => {
              dispatch({ type: 'SET_SCHEDULES_DONE', configured: false, skipped: true })
              await finishWizard()
            }}
          />
        )
      default:
        return null
    }
  }

  if (isRestoring) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-white/60">Loading...</div>
      </div>
    )
  }

  const syncInProgress = state.step === 5 && state.connectors.length > 0 && !state.syncComplete

  return (
    <WizardLayout
      currentStep={state.step}
      totalSteps={TOTAL_STEPS}
      onNext={handleNext}
      onBack={handleBack}
      canProceed={canProceed() && !isSaving}
      isLastStep={state.step === TOTAL_STEPS - 1}
      onStartOver={handleStartOver}
      continueLabel={syncInProgress ? 'Continue without sync' : undefined}
      continueVariant={syncInProgress ? 'subtle' : 'default'}
    >
      {saveError && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          {saveError}
        </div>
      )}
      {renderStep()}
    </WizardLayout>
  )
}

export default SetupPage
