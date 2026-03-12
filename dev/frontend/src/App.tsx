import { useEffect, useState } from 'react'
import { ConnectorsPage } from '@/components/connectors/ConnectorsPage'
import { ConnectorSettingsPage } from '@/components/connectors/ConnectorSettingsPage'
import { SetupPage } from '@/components/wizard/SetupPage'
import { SchedulesPage } from '@/components/schedules/SchedulesPage'
import { WorkflowsPage } from '@/components/workflows/WorkflowsPage'
import { WorkflowEditorPage } from '@/components/workflows/WorkflowEditorPage'
import { AgentDashboard } from '@/components/agents'
import { SkillsPage } from '@/components/skills'
import { HealthPage } from '@/components/health'
import { CRMPage } from '@/components/crm'
import { InboxPage } from '@/components/inbox/InboxPage'
import { DesktopRuntimePanel } from '@/components/desktop/DesktopRuntimePanel'
import { DesktopRuntimeSettingsPage } from '@/components/desktop/DesktopRuntimeSettingsPage'
import { API_BASE_URL } from '@/lib/api'

type Page =
  | 'connectors'
  | 'connector-settings'
  | 'schedules'
  | 'workflows'
  | 'workflow-editor'
  | 'setup'
  | 'agents'
  | 'skills'
  | 'health'
  | 'crm'
  | 'inbox'
  | 'desktop-settings'

const DEFAULT_ROUTE = '/agents'
const SHOW_DESKTOP_RUNTIME_PANEL = import.meta.env.VITE_SHOW_DESKTOP_RUNTIME_PANEL === 'true'
const WIZARD_STORAGE_KEY = 'codos-wizard-state'

function App() {
  const [currentPage, setCurrentPage] = useState<Page>('connectors')
  const [currentService, setCurrentService] = useState<string | null>(null)
  const [currentWorkflowId, setCurrentWorkflowId] = useState<string | null>(null)

  useEffect(() => {
    const handleHashChange = () => {
      const path = window.location.hash.replace('#', '') || DEFAULT_ROUTE
      if (path === '/setup') {
        setCurrentPage('setup')
        setCurrentService(null)
        return
      }

      if (path === '/agents') {
        setCurrentPage('agents')
        setCurrentService(null)
        return
      }

      if (path === '/connectors') {
        setCurrentPage('connectors')
        setCurrentService(null)
        return
      }

      if (path === '/schedules') {
        setCurrentPage('schedules')
        setCurrentService(null)
        return
      }

      if (path === '/workflows') {
        setCurrentPage('workflows')
        setCurrentService(null)
        setCurrentWorkflowId(null)
        return
      }

      if (path.startsWith('/workflows/')) {
        const workflowId = path.split('/')[2]
        setCurrentPage('workflow-editor')
        setCurrentService(null)
        setCurrentWorkflowId(workflowId === 'new' ? null : workflowId)
        return
      }

      if (path === '/skills') {
        setCurrentPage('skills')
        setCurrentService(null)
        return
      }

      if (path === '/health') {
        setCurrentPage('health')
        setCurrentService(null)
        return
      }

      if (path === '/inbox') {
        setCurrentPage('inbox')
        setCurrentService(null)
        return
      }

      if (path === '/crm') {
        setCurrentPage('crm')
        setCurrentService(null)
        return
      }

      if (path === '/desktop-settings') {
        setCurrentPage('desktop-settings')
        setCurrentService(null)
        return
      }

      if (path.startsWith('/connectors/')) {
        const service = path.split('/')[2]
        setCurrentPage('connector-settings')
        setCurrentService(service)
        return
      }

      window.location.hash = DEFAULT_ROUTE
      setCurrentPage('agents')
      setCurrentService(null)
    }

    if (!window.location.hash) {
      window.location.hash = DEFAULT_ROUTE
    }

    handleHashChange()
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  useEffect(() => {
    let cancelled = false

    const currentPath = () => window.location.hash.replace('#', '') || DEFAULT_ROUTE
    const redirectTo = (path: string) => {
      if (!cancelled && currentPath() !== path) {
        window.location.hash = path
      }
    }

    const maybeRedirectToSetup = async () => {
      const path = currentPath()
      if (path === '/setup') {
        return
      }

      const hasWizardState = Boolean(localStorage.getItem(WIZARD_STORAGE_KEY))

      try {
        const response = await fetch(`${API_BASE_URL}/api/setup/status`)
        if (!response.ok) {
          if (hasWizardState) {
            redirectTo('/setup')
          }
          return
        }

        const status = (await response.json()) as {
          needs_setup?: boolean
        }
        if (cancelled) {
          return
        }

        const needsSetup = status.needs_setup === true
        if (needsSetup) {
          redirectTo('/setup')
          return
        }

        // Setup is complete; stale wizard state should not force onboarding.
        if (hasWizardState) {
          localStorage.removeItem(WIZARD_STORAGE_KEY)
        }
      } catch {
        // If status check fails, fall back to local wizard state.
        if (hasWizardState) {
          redirectTo('/setup')
        }
      }
    }

    void (async () => {
      await maybeRedirectToSetup()
    })()

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="min-h-screen bg-background text-foreground">
      {SHOW_DESKTOP_RUNTIME_PANEL && <DesktopRuntimePanel />}
      {currentPage === 'setup' && <SetupPage />}
      {currentPage === 'agents' && <AgentDashboard />}
      {currentPage === 'connectors' && <ConnectorsPage />}
      {currentPage === 'schedules' && <SchedulesPage />}
      {currentPage === 'workflows' && <WorkflowsPage />}
      {currentPage === 'workflow-editor' && <WorkflowEditorPage workflowId={currentWorkflowId} />}
      {currentPage === 'skills' && <SkillsPage />}
      {currentPage === 'health' && <HealthPage />}
      {currentPage === 'crm' && <CRMPage />}
      {currentPage === 'inbox' && <InboxPage />}
      {currentPage === 'desktop-settings' && <DesktopRuntimeSettingsPage />}
      {currentPage === 'connector-settings' && currentService && (
        <ConnectorSettingsPage
          service={currentService}
          onBack={() => {
            window.location.hash = '/connectors'
          }}
        />
      )}
    </div>
  )
}

export default App
