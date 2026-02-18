import { useState, useCallback, useEffect, useRef } from 'react'
import { API_BASE_URL } from '@/lib/api'
import { getDesktopAtlasApiKey } from '@/lib/desktopRuntimeBootstrap'
import { isDesktopRuntimeAvailable } from '@/lib/desktopRuntime'
import { WizardLayout } from './WizardLayout'
import { WelcomeStep } from './WelcomeStep'
import { DependencyCheck } from '../setup/DependencyCheck'
import { ReposSetupStep, type ReposSetupStepHandle } from './ReposSetupStep'
import { ApiKeysStep } from './ApiKeysStep'
import { ConnectorsStep } from './ConnectorsStep'
import { TelegramAuthStep } from './TelegramAuthStep'
import { TelegramConversationStep } from './TelegramConversationStep'
import { TelegramBotStep } from './TelegramBotStep'
import { FirstSyncStep } from './FirstSyncStep'
import { ScheduleConfigStep } from './ScheduleConfigStep'
import { WorkspaceOntologyStep } from './WorkspaceOntologyStep'

const WIZARD_STORAGE_KEY = 'codos-wizard-state'

interface Workspace {
  name: string
  icon: string
  projects: string[]
}

interface ApiKeys {
  parallel: string
  pipedream_project_id: string
  pipedream_client_id: string
  pipedream_client_secret: string
  telegram_api_id: string
  telegram_api_hash: string
  assemblyai: string
}

interface WizardState {
  step: number
  name: string
  timezone: string
  goals: string
  codosPath: string
  vaultPath: string
  reposInitialized: boolean
  apiKeys: ApiKeys
  connectors: string[]
  telegramStatus: 'idle' | 'sending' | 'code_sent' | 'verified' | 'error'
  telegramConversationsConfigured: boolean
  telegramConversationsSkipped: boolean
  telegramBotConfigured: boolean
  telegramBotSkipped: boolean
  syncComplete: boolean
  schedulesConfigured: boolean
  schedulesSkipped: boolean
  workspaces: Workspace[]
  workspacesSkipped: boolean
  dependenciesOk: boolean
}

const isBundleMode = isDesktopRuntimeAvailable()

export function SetupPage() {
  const getAuthHeaders = useCallback((): Record<string, string> => {
    const atlasKey = getDesktopAtlasApiKey() || import.meta.env.VITE_ATLAS_API_KEY || ''
    return atlasKey ? { 'X-Atlas-Key': atlasKey } : {}
  }, [])

  const [step, setStep] = useState(0)
  const [isSaving, setIsSaving] = useState(false)
  const [isRestoring, setIsRestoring] = useState(true)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Form state
  const [name, setName] = useState('')
  const [timezone, setTimezone] = useState('')
  const [goals, setGoals] = useState('')
  const [dependenciesOk, setDependenciesOk] = useState(false)

  // Repository paths (Step 2)
  const [codosPath, setCodosPath] = useState('')
  const [vaultPath, setVaultPath] = useState('')
  const [reposInitialized, setReposInitialized] = useState(false)
  const reposSetupRef = useRef<ReposSetupStepHandle>(null)

  // API Keys
  const [apiKeys, setApiKeys] = useState<ApiKeys>({
    parallel: '',
    pipedream_project_id: '',
    pipedream_client_id: '',
    pipedream_client_secret: '',
    telegram_api_id: '',
    telegram_api_hash: '',
    assemblyai: '',
  })

  // Connectors
  const [connectors, setConnectors] = useState<string[]>([])
  const [hasPipedreamCreds, setHasPipedreamCreds] = useState(false)

  // Telegram auth state (QR-based)
  const [telegramStatus, setTelegramStatus] = useState<'idle' | 'sending' | 'code_sent' | 'verified' | 'error'>('idle')

  // Telegram conversation selection state
  const [telegramConversationsConfigured, setTelegramConversationsConfigured] = useState(false)
  const [telegramConversationsSkipped, setTelegramConversationsSkipped] = useState(false)

  // Telegram bot state (for Atlas Bot - Claude chat interface)
  const [telegramBotToken, setTelegramBotToken] = useState('')
  const [authorizedUserIds, setAuthorizedUserIds] = useState('')
  const [telegramBotConfigured, setTelegramBotConfigured] = useState(false)
  const [telegramBotSkipped, setTelegramBotSkipped] = useState(false)

  // Sync state
  const [syncComplete, setSyncComplete] = useState(false)

  // Schedule state
  const [schedulesConfigured, setSchedulesConfigured] = useState(false)
  const [schedulesSkipped, setSchedulesSkipped] = useState(false)

  // Workspaces state
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspacesSkipped, setWorkspacesSkipped] = useState(false)


  // Restore wizard state from localStorage on mount
  useEffect(() => {
    const restore = async () => {
      const saved = localStorage.getItem(WIZARD_STORAGE_KEY)
      if (saved) {
        try {
          const state: WizardState = JSON.parse(saved)

          // If saved step is past repos setup, verify backend config still exists.
          // User may have deleted ~/.codos — in that case start over.
          if (state.step > 2) {
            try {
              const res = await fetch(`${API_BASE_URL}/api/setup/status`)
              if (res.ok) {
                const status = await res.json()
                if (status.needs_setup || status.needsSetup) {
                  localStorage.removeItem(WIZARD_STORAGE_KEY)
                  setIsRestoring(false)
                  return
                }
              }
            } catch {
              // Backend unavailable — start fresh to be safe
              localStorage.removeItem(WIZARD_STORAGE_KEY)
              setIsRestoring(false)
              return
            }
          }

          // Restore all state (skip deps + repos steps in bundle mode)
          let restoredStep = state.step
          if (isBundleMode && (restoredStep === 1 || restoredStep === 2)) restoredStep = 3
          if (isBundleMode && restoredStep === 10) restoredStep = 9
          setStep(restoredStep)
          if (state.name) setName(state.name)
          if (state.timezone) setTimezone(state.timezone)
          if (state.goals) setGoals(state.goals)
          if (state.codosPath) setCodosPath(state.codosPath)
          if (state.vaultPath) setVaultPath(state.vaultPath)
          setReposInitialized(state.reposInitialized ?? false)
          if (state.apiKeys) setApiKeys(state.apiKeys)
          if (state.connectors) setConnectors(state.connectors)
          if (state.telegramStatus) setTelegramStatus(state.telegramStatus)
          setTelegramConversationsConfigured(state.telegramConversationsConfigured ?? false)
          setTelegramConversationsSkipped(state.telegramConversationsSkipped ?? false)
          setTelegramBotConfigured(state.telegramBotConfigured ?? false)
          setTelegramBotSkipped(state.telegramBotSkipped ?? false)
          setSyncComplete(state.syncComplete ?? false)
          setSchedulesConfigured(state.schedulesConfigured ?? false)
          setSchedulesSkipped(state.schedulesSkipped ?? false)
          if (state.workspaces) setWorkspaces(state.workspaces)
          setWorkspacesSkipped(state.workspacesSkipped ?? false)
          setDependenciesOk(state.dependenciesOk ?? false)
        } catch (e) {
          console.error('Failed to restore wizard state:', e)
          localStorage.removeItem(WIZARD_STORAGE_KEY)
        }
      }
      setIsRestoring(false)
    }
    restore()
  }, [])

  // Save wizard state to localStorage whenever relevant state changes
  useEffect(() => {
    // Don't save while restoring
    if (isRestoring) return

    const state: WizardState = {
      step,
      name,
      timezone,
      goals,
      codosPath,
      vaultPath,
      reposInitialized,
      apiKeys,
      connectors,
      telegramStatus,
      telegramConversationsConfigured,
      telegramConversationsSkipped,
      telegramBotConfigured,
      telegramBotSkipped,
      syncComplete,
      schedulesConfigured,
      schedulesSkipped,
      workspaces,
      workspacesSkipped,
      dependenciesOk,
    }
    localStorage.setItem(WIZARD_STORAGE_KEY, JSON.stringify(state))
  }, [
    isRestoring,
    step,
    name,
    timezone,
    goals,
    codosPath,
    vaultPath,
    reposInitialized,
    apiKeys,
    connectors,
    telegramStatus,
    telegramConversationsConfigured,
    telegramConversationsSkipped,
    telegramBotConfigured,
    telegramBotSkipped,
    syncComplete,
    schedulesConfigured,
    schedulesSkipped,
    workspaces,
    workspacesSkipped,
    dependenciesOk,
  ])

  // Fetch system info on mount (only if not restored from localStorage)
  useEffect(() => {
    // Skip if we restored state with name/timezone
    if (isRestoring) return

    const saved = localStorage.getItem(WIZARD_STORAGE_KEY)
    if (saved) {
      try {
        const state: WizardState = JSON.parse(saved)
        if (state.name && state.timezone) return // Already have these from restore
      } catch {
        // Continue with fetch
      }
    }

    fetch(`${API_BASE_URL}/api/setup/detect-system-info`)
      .then(res => res.json())
      .then(data => {
        if (data.name && !name) setName(data.name)
        if (data.timezone && !timezone) setTimezone(data.timezone)
      })
      .catch(() => {
        // Fallback if detection fails
        if (!timezone) setTimezone('America/Los_Angeles')
      })

    // Check if Pipedream credentials are already configured
    fetch(`${API_BASE_URL}/api/setup/pipedream/status`)
      .then(res => res.json())
      .then(data => setHasPipedreamCreds(!!data.configured))
      .catch(() => {})
  }, [isRestoring, name, timezone])

  const handleSyncComplete = useCallback(() => {
    setSyncComplete(true)
  }, [])

  const handleReposInitialized = useCallback(() => {
    setReposInitialized(true)
  }, [])

  const handleDependenciesOk = useCallback(() => {
    setDependenciesOk(true)
  }, [])

  const canProceed = () => {
    switch (step) {
      case 0: // Welcome + Goals
        return true // Goals are optional, name auto-detected
      case 1: // Dependencies Check (bun, claude)
        return dependenciesOk
      case 2: // Repos Setup - check paths are filled
        return Boolean(codosPath && vaultPath)
      case 3: // API Keys
        return true // All keys are optional
      case 4: // Connectors
        return true // Connectors are optional
      case 5: // Telegram Auth (phone-based for message syncing)
        // Skip if telegram not selected, otherwise require verification
        if (!connectors.includes('telegram')) return true
        return telegramStatus === 'verified'
      case 6: // Telegram Conversation Selection
        // Skip if telegram not selected or not verified
        if (!connectors.includes('telegram')) return true
        if (telegramStatus !== 'verified') return true
        return telegramConversationsConfigured || telegramConversationsSkipped
      case 7: // Telegram Bot (Atlas Bot - optional)
        return telegramBotConfigured || telegramBotSkipped
      case 8: // First Sync
        return syncComplete || connectors.length === 0
      case 9: // Schedule Config (optional - can skip or complete)
        return schedulesConfigured || schedulesSkipped || connectors.length === 0
      case 10: // Workspaces (optional - can skip or complete)
        return workspaces.length > 0 || workspacesSkipped
      case 11: // Done
        return true
      default:
        return true
    }
  }

  const saveSetup = async (overrides?: { workspaces?: Workspace[]; workspacesSkipped?: boolean }) => {
    setIsSaving(true)
    setSaveError(null)
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 15000)
    try {
      const resolvedWorkspaces = overrides?.workspaces ?? workspaces
      const resolvedWorkspacesSkipped = overrides?.workspacesSkipped ?? workspacesSkipped

      const response = await fetch(`${API_BASE_URL}/api/setup/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          generate_claude_md: true,
          user_name: name,
          timezone,
          // Additional data for config
          codosPath,
          vaultPath,
          apiKeys,
          connectors,
          workspaces: resolvedWorkspacesSkipped ? [] : resolvedWorkspaces,
          goals,
          // Telegram bot config
          telegram_bot_token: telegramBotConfigured ? telegramBotToken : undefined,
          authorized_user_ids: telegramBotConfigured ? authorizedUserIds : undefined,
        }),
        signal: controller.signal,
      })
      if (!response.ok) {
        const body = await response.text().catch(() => '')
        const message = body ? `Failed to save setup (${response.status}): ${body}` : `Failed to save setup (${response.status})`
        console.error(message)
        setSaveError(message)
        return false
      }
      return true
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        const message = 'Failed to save setup: request timed out'
        console.error(message)
        setSaveError(message)
      } else {
        const message = `Failed to save setup: ${String(err)}`
        console.error(message)
        setSaveError(message)
      }
      return false
    } finally {
      window.clearTimeout(timeoutId)
      setIsSaving(false)
    }
  }

  const saveKeys = async () => {
    setIsSaving(true)
    setSaveError(null)
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 15000)
    try {
      const response = await fetch(`${API_BASE_URL}/api/setup/save-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKeys }),
        signal: controller.signal,
      })
      if (!response.ok) {
        const body = await response.text().catch(() => '')
        const message = body ? `Failed to save keys (${response.status}): ${body}` : `Failed to save keys (${response.status})`
        console.error(message)
        setSaveError(message)
        return false
      }
      return true
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        const message = 'Failed to save keys: request timed out'
        console.error(message)
        setSaveError(message)
      } else {
        const message = `Failed to save keys: ${String(err)}`
        console.error(message)
        setSaveError(message)
      }
      return false
    } finally {
      window.clearTimeout(timeoutId)
      setIsSaving(false)
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_name: name,
          timezone,
          apiKeys,
          goals,
          connectors,
          telegram_bot_token: telegramBotConfigured ? telegramBotToken : undefined,
          authorized_user_ids: telegramBotConfigured ? authorizedUserIds : undefined,
        }),
        signal: controller.signal,
      })
      if (!response.ok) {
        const body = await response.text().catch(() => '')
        const message = body ? `Failed to save progress (${response.status}): ${body}` : `Failed to save progress (${response.status})`
        console.error(message)
        setSaveError(message)
        return false
      }
      return true
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        const message = 'Failed to save progress: request timed out'
        console.error(message)
        setSaveError(message)
      } else {
        const message = `Failed to save progress: ${String(err)}`
        console.error(message)
        setSaveError(message)
      }
      return false
    } finally {
      window.clearTimeout(timeoutId)
      setIsSaving(false)
    }
  }

  const handleStartOver = useCallback(() => {
    localStorage.removeItem(WIZARD_STORAGE_KEY)
    window.location.reload()
  }, [])

  const autoInitializeRepos = async (): Promise<boolean> => {
    // In bundle mode the backend creates vault + paths.json at startup.
    // Just read the status to confirm and populate local state.
    try {
      console.log('[wizard] autoInitializeRepos: checking setup status')
      const res = await fetch(`${API_BASE_URL}/api/setup/status`, {
        headers: { ...getAuthHeaders() },
      })
      if (!res.ok) {
        const msg = `setup/status failed: HTTP ${res.status}`
        console.error('[wizard]', msg)
        setSaveError(msg)
        return false
      }
      const status = await res.json()
      console.log('[wizard] autoInitializeRepos: status', status)

      if (status.codos_path || status.codosPath) setCodosPath(status.codos_path || status.codosPath)
      if (status.vault_path || status.vaultPath) setVaultPath(status.vault_path || status.vaultPath)
      setReposInitialized(true)
      return true
    } catch (err) {
      const msg = `Auto-initialize failed: ${String(err)}`
      console.error('[wizard]', msg, err)
      setSaveError(msg)
      return false
    }
  }

  const handleNext = async () => {
    if (step === 12) {
      // Final step - save and redirect
      const ok = await saveSetup()
      if (!ok) return
      // Clear wizard state
      localStorage.removeItem(WIZARD_STORAGE_KEY)
      // Clear old session to force fresh start
      localStorage.removeItem('atlas-agent-session')
      // Set auto-start flag for ChatArea
      localStorage.setItem('atlas-autostart', 'brief')
      window.location.hash = '/agents'
    } else {
      // In bundle mode: skip deps (step 1) + repos (step 2) — auto-initialize
      if (isBundleMode && (step === 0 || step === 1)) {
        const ok = await autoInitializeRepos()
        if (!ok) return
        setDependenciesOk(true)
        setStep(3) // Jump past deps + repos to API keys
        return
      }
      // Handle repos setup step - save paths via ref
      if (step === 2) {
        const success = await reposSetupRef.current?.save()
        if (!success) return // Don't proceed if save failed
      }
      // At step 3 (API keys), save keys to .env only (lightweight)
      if (step === 3) {
        const ok = await saveKeys()
        if (!ok) return
        // Re-check Pipedream status after keys are saved
        try {
          const res = await fetch(`${API_BASE_URL}/api/setup/pipedream/status`)
          const data = await res.json()
          setHasPipedreamCreds(!!data.configured)
        } catch { /* non-critical */ }
      }
      // Save full progress at later checkpoints
      if (step === 6 || step === 7 || step === 9) {
        const ok = await saveProgress()
        if (!ok) return
      }
      // In bundle mode, skip Workspaces step — go straight to finish
      if (isBundleMode && step === 9) {
        setWorkspacesSkipped(true)
        const ok = await saveSetup({ workspaces: [], workspacesSkipped: true })
        if (!ok) return
        localStorage.removeItem(WIZARD_STORAGE_KEY)
        localStorage.removeItem('atlas-agent-session')
        localStorage.setItem('atlas-autostart', 'brief')
        window.location.hash = '/agents'
        return
      }
      setStep((s) => s + 1)
    }
  }

  const handleBack = () => {
    if (step > 0) {
      // In bundle mode, skip deps + repos steps when going back
      if (isBundleMode && step === 3) {
        setStep(0)
      } else {
        setStep((s) => s - 1)
      }
    }
  }

  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <WelcomeStep
            name={name}
            goals={goals}
            setGoals={setGoals}
            onSkip={() => setStep(1)}
          />
        )
      case 1:
        return (
          <DependencyCheck
            onComplete={handleDependenciesOk}
            onSkip={() => {
              setDependenciesOk(true)
              setStep((s) => s + 1)
            }}
          />
        )
      case 2:
        return (
          <ReposSetupStep
            ref={reposSetupRef}
            codosPath={codosPath}
            setCodosPath={setCodosPath}
            vaultPath={vaultPath}
            setVaultPath={setVaultPath}
            onInitialized={handleReposInitialized}
          />
        )
      case 3:
        return (
          <ApiKeysStep
            apiKeys={apiKeys}
            setApiKeys={setApiKeys}
          />
        )
      case 4:
        return (
          <ConnectorsStep
            connectors={connectors}
            setConnectors={setConnectors}
            pipedreamConfigured={hasPipedreamCreds}
          />
        )
      case 5:
        return (
          <TelegramAuthStep
            connectors={connectors}
            telegramStatus={telegramStatus}
            setTelegramStatus={setTelegramStatus}
          />
        )
      case 6:
        return (
          <TelegramConversationStep
            connectors={connectors}
            onComplete={() => {
              setTelegramConversationsConfigured(true)
              setStep((s) => s + 1)
            }}
            onSkip={() => {
              setTelegramConversationsSkipped(true)
              setStep((s) => s + 1)
            }}
          />
        )
      case 7:
        return (
          <TelegramBotStep
            telegramBotToken={telegramBotToken}
            setTelegramBotToken={setTelegramBotToken}
            authorizedUserIds={authorizedUserIds}
            setAuthorizedUserIds={setAuthorizedUserIds}
            telegramBotConfigured={telegramBotConfigured}
            setTelegramBotConfigured={setTelegramBotConfigured}
            onSkip={() => {
              setTelegramBotSkipped(true)
              setStep((s) => s + 1)
            }}
          />
        )
      case 8:
        return (
          <FirstSyncStep
            connectors={connectors}
            onSyncComplete={handleSyncComplete}
          />
        )
      case 9:
        return (
          <ScheduleConfigStep
            connectors={connectors}
            onComplete={() => {
              setSchedulesConfigured(true)
              setStep((s) => s + 1)
            }}
            onSkip={() => {
              setSchedulesSkipped(true)
              setStep((s) => s + 1)
            }}
          />
        )
      case 10:
        return (
          <WorkspaceOntologyStep
            onComplete={async (ws) => {
              setWorkspaces(ws)
              setWorkspacesSkipped(false)
              // Go directly to agents
              const ok = await saveSetup({ workspaces: ws, workspacesSkipped: false })
              if (!ok) return
              localStorage.removeItem(WIZARD_STORAGE_KEY)
              localStorage.removeItem('atlas-agent-session')
              localStorage.setItem('atlas-autostart', 'brief')
              window.location.hash = '/agents'
            }}
            onSkip={async () => {
              setWorkspacesSkipped(true)
              // Go directly to agents
              const ok = await saveSetup({ workspaces: [], workspacesSkipped: true })
              if (!ok) return
              localStorage.removeItem(WIZARD_STORAGE_KEY)
              localStorage.removeItem('atlas-agent-session')
              localStorage.setItem('atlas-autostart', 'brief')
              window.location.hash = '/agents'
            }}
          />
        )
      default:
        return null
    }
  }

  // Show loading state while restoring
  if (isRestoring) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-white/60">Loading...</div>
      </div>
    )
  }

  return (
    <WizardLayout
      currentStep={step}
      totalSteps={11}
      onNext={handleNext}
      onBack={handleBack}
      canProceed={canProceed() && !isSaving}
      isLastStep={step === 10}
      onStartOver={handleStartOver}
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
