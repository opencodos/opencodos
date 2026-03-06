import { useState, useEffect } from 'react'
import { API_BASE_URL } from '@/lib/api'

interface ConnectorOption {
  id: string
  name: string
  description: string
  icon: React.ReactNode
  requiresAuth: boolean
  authType: 'claude_ai' | 'telegram' | 'local' | 'token' | 'none' | 'gog'
  tokenInstructions?: string
}

const CONNECTORS: ConnectorOption[] = [
  {
    id: 'telegram',
    name: 'Telegram',
    description: 'Sync messages and contacts',
    icon: (
      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.161c-.18 1.897-.962 6.502-1.359 8.627-.168.9-.5 1.201-.82 1.23-.697.064-1.226-.461-1.901-.903-1.057-.692-1.654-1.123-2.681-1.799-1.186-.781-.417-1.21.258-1.911.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.139-5.062 3.345-.479.329-.913.489-1.302.481-.428-.009-1.252-.242-1.865-.442-.751-.244-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.831-2.529 6.998-3.015 3.333-1.386 4.025-1.627 4.477-1.635.099-.002.321.023.465.141.121.099.155.232.17.325.015.093.033.304.019.469z"/>
      </svg>
    ),
    requiresAuth: true,
    authType: 'telegram',
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Sync workspace messages',
    icon: (
      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
        <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zm10.124 2.521a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.52 2.521h-2.522V8.834zm-1.271 0a2.528 2.528 0 0 1-2.521 2.521 2.528 2.528 0 0 1-2.521-2.521V2.522A2.528 2.528 0 0 1 15.166 0a2.528 2.528 0 0 1 2.521 2.522v6.312zm-2.521 10.124a2.528 2.528 0 0 1 2.521 2.522A2.528 2.528 0 0 1 15.166 24a2.528 2.528 0 0 1-2.521-2.52v-2.522h2.521zm0-1.271a2.528 2.528 0 0 1-2.521-2.521 2.528 2.528 0 0 1 2.521-2.521h6.312A2.528 2.528 0 0 1 24 15.165a2.528 2.528 0 0 1-2.52 2.521h-6.314z"/>
      </svg>
    ),
    requiresAuth: true,
    authType: 'claude_ai',
  },
  {
    id: 'google',
    name: 'Google Workspace',
    description: 'Gmail, Calendar, Drive, Docs, Sheets',
    icon: (
      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
      </svg>
    ),
    requiresAuth: true,
    authType: 'gog',
  },
  {
    id: 'notion',
    name: 'Notion',
    description: 'Connect via claude.ai Settings',
    icon: (
      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
        <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466l1.823 1.447zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.886l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.139c-.093-.514.28-.887.747-.933l3.222-.187zM1.936 1.035l13.31-.98c1.634-.14 2.055-.047 3.082.7l4.249 2.986c.7.513.934.653.934 1.213v16.378c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.667c0-.839.374-1.54 1.447-1.632z"/>
      </svg>
    ),
    requiresAuth: false,
    authType: 'none',
  },
  {
    id: 'linear',
    name: 'Linear',
    description: 'Connect via claude.ai Settings',
    icon: (
      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
        <path d="M3.354 7.196l13.45 13.449a10.03 10.03 0 01-2.907 1.46c-.072.023-.144-.03-.144-.105V12.086a.1.1 0 00-.1-.1H3.739c-.075 0-.128-.072-.105-.144a10.03 10.03 0 011.72-4.646zM4.669 5.623l13.708 13.708c.39-.234.765-.49 1.12-.767L5.436 4.503c-.277.355-.533.73-.767 1.12zm2.44-2.067L20.444 16.89c.234-.39.49-.765.767-1.12L7.876 2.436c-.355.277-.73.533-1.12.767l.353.353zm3.182-1.69l11.155 11.156a10.1 10.1 0 00.659-3.525C22.105 4.262 17.843 0 12.508 0c-1.25 0-2.449.23-3.557.673.058.063.69.7.34 1.193z"/>
      </svg>
    ),
    requiresAuth: false,
    authType: 'claude_ai',
  },
  {
    id: 'granola',
    name: 'Granola',
    description: 'Sync meeting transcripts',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
      </svg>
    ),
    requiresAuth: false,
    authType: 'local',
  },
]

interface ConnectorsStepProps {
  connectors: string[]
  setConnectors: (connectors: string[]) => void
}

interface ConnectorState {
  connected: boolean
  connecting: boolean
  is_verified: boolean
  error: string | null
  statusMessage: string | null
}

const DEFAULT_STATE: ConnectorState = {
  connected: false,
  connecting: false,
  is_verified: true,
  error: null,
  statusMessage: null,
}

export function ConnectorsStep({ connectors, setConnectors }: ConnectorsStepProps) {
  const [states, setStates] = useState<Record<string, ConnectorState>>({})
  const [tokenModalOpen, setTokenModalOpen] = useState(false)
  const [tokenModalConnector, setTokenModalConnector] = useState<ConnectorOption | null>(null)
  const [tokenInput, setTokenInput] = useState('')
  const [tokenSaving, setTokenSaving] = useState(false)

  const getState = (id: string): ConnectorState => states[id] ?? DEFAULT_STATE

  const patchState = (id: string, patch: Partial<ConnectorState>) => {
    setStates((prev) => ({ ...prev, [id]: { ...(prev[id] ?? DEFAULT_STATE), ...patch } }))
  }

  const checkStatus = async (serviceId: string) => {
    const response = await fetch(`${API_BASE_URL}/api/integrations/${serviceId}/status`)
    return (await response.json()) as {
      connected?: boolean
      is_verified?: boolean
      status?: string
      error?: string
    }
  }

  // Check status of all connectors on mount to show already-connected services
  useEffect(() => {
    const checkAllStatuses = async () => {
      const results = await Promise.all(
        CONNECTORS.map(async (connector) => {
          try {
            const data = await checkStatus(connector.id)
            return { id: connector.id, ...data }
          } catch {
            return { id: connector.id, connected: false, is_verified: true }
          }
        }),
      )

      const newStates: Record<string, ConnectorState> = {}
      const newConnectors: string[] = [...connectors]

      for (const result of results) {
        if (result.is_verified === false) {
          newStates[result.id] = {
            ...DEFAULT_STATE,
            is_verified: false,
            statusMessage: result.status ?? null,
          }
        } else if (result.connected) {
          newStates[result.id] = { ...DEFAULT_STATE, connected: true }
          if (!newConnectors.includes(result.id)) {
            newConnectors.push(result.id)
          }
        }
      }

      setStates(newStates)
      if (newConnectors.length !== connectors.length) {
        setConnectors(newConnectors)
      }
    }

    checkAllStatuses()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleConnectorClick = async (connector: ConnectorOption) => {
    const st = getState(connector.id)

    // Unverified connectors are not clickable
    if (!st.is_verified) return

    // If already connected, disconnect
    if (st.connected) {
      patchState(connector.id, { connecting: true })
      try {
        const response = await fetch(`${API_BASE_URL}/api/integrations/${connector.id}`, {
          method: 'DELETE',
        })
        const data = await response.json() as { success?: boolean; message?: string }
        if (data.success) {
          setConnectors(connectors.filter((c) => c !== connector.id))
          patchState(connector.id, { connected: false, connecting: false, error: null })
        } else {
          patchState(connector.id, { connecting: false, error: data.message || 'Failed to disconnect' })
        }
      } catch {
        patchState(connector.id, { connecting: false, error: 'Failed to disconnect' })
      }
      return
    }

    // For non-auth connectors, just toggle selection
    if (connector.authType === 'none') {
      if (connectors.includes(connector.id)) {
        setConnectors(connectors.filter((c) => c !== connector.id))
        patchState(connector.id, { connected: false })
      } else {
        setConnectors([...connectors, connector.id])
        patchState(connector.id, { connected: true })
      }
      return
    }

    // For Telegram, select it AND trigger agent start
    if (connector.authType === 'telegram') {
      if (connectors.includes(connector.id)) {
        setConnectors(connectors.filter((c) => c !== connector.id))
        patchState(connector.id, { connected: false })
      } else {
        setConnectors([...connectors, connector.id])
        // Fire-and-forget: start agent before user reaches auth step
        fetch(`${API_BASE_URL}/api/setup/telegram/start-agent`, { method: 'POST' })
          .catch(() => {}) // Ignore errors - TelegramAuthStep handles failures
      }
      return
    }

    // For local connectors (like Granola), call backend to check/connect
    if (connector.authType === 'local') {
      patchState(connector.id, { connecting: true, error: null })
      try {
        const data = await checkStatus(connector.id)
        if (data.connected) {
          patchState(connector.id, { connected: true, connecting: false })
          setConnectors([...connectors.filter((c) => c !== connector.id), connector.id])
        } else {
          patchState(connector.id, { connecting: false, error: data.error || 'Not connected' })
        }
      } catch {
        patchState(connector.id, { connecting: false, error: 'Failed to connect' })
      }
      return
    }

    // For token-based connectors, open token modal
    if (connector.authType === 'token') {
      patchState(connector.id, { connecting: true })
      try {
        const data = await checkStatus(connector.id)
        if (data.connected) {
          patchState(connector.id, { connected: true, connecting: false })
          setConnectors([...connectors.filter((c) => c !== connector.id), connector.id])
          return
        }
      } catch {
        // Not connected, show modal
      }
      patchState(connector.id, { connecting: false })
      setTokenModalConnector(connector)
      setTokenInput('')
      setTokenModalOpen(true)
      return
    }

    // For gog connectors (Google), check backend status
    if (connector.authType === 'gog') {
      patchState(connector.id, { connecting: true, error: null })
      try {
        const data = await checkStatus(connector.id)
        if (data.connected) {
          patchState(connector.id, { connected: true, connecting: false })
          setConnectors([...connectors.filter((c) => c !== connector.id), connector.id])
        } else {
          patchState(connector.id, { connecting: false, error: 'Run "gog auth add your@email.com" in terminal first' })
        }
      } catch {
        patchState(connector.id, { connecting: false, error: 'Run "gog auth add your@email.com" in terminal first' })
      }
      return
    }

    // For claude.ai MCP connectors (Slack, Linear), check backend status
    if (connector.authType === 'claude_ai') {
      patchState(connector.id, { connecting: true, error: null })
      try {
        const data = await checkStatus(connector.id)
        if (data.connected) {
          patchState(connector.id, { connected: true, connecting: false })
          setConnectors([...connectors.filter((c) => c !== connector.id), connector.id])
        } else {
          patchState(connector.id, { connecting: false, error: 'Connect in claude.ai Settings > Integrations, then click here again' })
        }
      } catch {
        patchState(connector.id, { connecting: false, error: 'Connect in claude.ai Settings > Integrations, then click here again' })
      }
      return
    }
  }

  const handleTokenSave = async () => {
    if (!tokenModalConnector || !tokenInput.trim()) return

    setTokenSaving(true)
    patchState(tokenModalConnector.id, { error: null })

    try {
      const response = await fetch(`${API_BASE_URL}/api/integrations/${tokenModalConnector.id}/save-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tokenInput.trim() }),
      })
      const data = await response.json() as { success: boolean; message: string }

      if (data.success) {
        patchState(tokenModalConnector.id, { connected: true })
        setConnectors([...connectors.filter((c) => c !== tokenModalConnector.id), tokenModalConnector.id])
        setTokenModalOpen(false)
        setTokenInput('')
      } else {
        patchState(tokenModalConnector.id, { error: data.message })
      }
    } catch {
      patchState(tokenModalConnector.id, { error: 'Failed to save token' })
    } finally {
      setTokenSaving(false)
    }
  }

  const getStatusBadge = (connector: ConnectorOption) => {
    const st = getState(connector.id)
    if (st.connecting) {
      return (
        <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
      )
    }
    if (st.connected || connectors.includes(connector.id)) {
      return (
        <svg className="w-4 h-4 text-green-400" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
      )
    }
    if (st.error) {
      return (
        <svg className="w-4 h-4 text-red-400" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
        </svg>
      )
    }
    return null
  }

  return (
    <div className="space-y-6">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-light mb-2 text-white">Data Connectors</h1>
        <p className="text-gray-400">Click to connect your data sources</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {CONNECTORS.map((connector) => {
          const st = getState(connector.id)
          const isSelected = connectors.includes(connector.id) || st.connected
          const isDisabled = st.connecting || !st.is_verified

          return (
            <button
              key={connector.id}
              onClick={() => handleConnectorClick(connector)}
              disabled={isDisabled}
              title={!st.is_verified ? (st.statusMessage ?? undefined) : undefined}
              className={`p-4 rounded-xl border text-left transition-all ${
                !st.is_verified
                  ? 'bg-black/20 border-atlas-border opacity-50 cursor-not-allowed'
                  : isSelected
                  ? 'bg-white/10 border-white/30'
                  : st.error
                  ? 'bg-red-500/10 border-red-500/30'
                  : 'bg-black/30 border-atlas-border hover:border-white/20'
              } ${st.connecting ? 'opacity-70 cursor-wait' : ''}`}
            >
              <div className="flex items-start gap-3">
                <div
                  className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    isSelected ? 'bg-white/20 text-white' : 'bg-white/5 text-gray-500'
                  }`}
                >
                  {connector.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`font-medium ${isSelected ? 'text-white' : 'text-gray-300'}`}>
                      {connector.name}
                    </span>
                    {getStatusBadge(connector)}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5 truncate">
                    {st.error || (!st.is_verified && st.statusMessage) || connector.description}
                  </p>
                </div>
              </div>
            </button>
          )
        })}
      </div>

      <p className="text-center text-gray-500 text-sm">
        {connectors.length > 0
          ? `${connectors.length} connector${connectors.length > 1 ? 's' : ''} selected`
          : 'You can add connectors later from settings'}
      </p>

      {/* Token Input Modal */}
      {tokenModalOpen && tokenModalConnector && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-white/10 rounded-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-medium text-white mb-2">
              Connect {tokenModalConnector.name}
            </h3>
            <p className="text-sm text-gray-400 mb-4">
              {tokenModalConnector.tokenInstructions}
            </p>
            <input
              type="password"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="Paste your API token here..."
              className="w-full bg-black/50 border border-white/20 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-white/40 mb-4"
              autoFocus
            />
            {getState(tokenModalConnector.id).error && (
              <p className="text-red-400 text-sm mb-4">{getState(tokenModalConnector.id).error}</p>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setTokenModalOpen(false)
                  setTokenInput('')
                }}
                className="flex-1 px-4 py-2 border border-white/20 rounded-lg text-gray-300 hover:bg-white/5"
                disabled={tokenSaving}
              >
                Cancel
              </button>
              <button
                onClick={handleTokenSave}
                disabled={tokenSaving || !tokenInput.trim()}
                className="flex-1 px-4 py-2 bg-white text-black rounded-lg font-medium hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {tokenSaving ? 'Connecting...' : 'Connect'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
