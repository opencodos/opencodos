import { useState, useEffect, useRef } from 'react'
import { API_BASE_URL } from '@/lib/api'
import { isDesktopRuntimeAvailable, openExternalUrl } from '@/lib/desktopRuntime'

interface ConnectorOption {
  id: string
  name: string
  description: string
  icon: React.ReactNode
  requiresAuth: boolean
  authType: 'pipedream' | 'telegram' | 'local' | 'token' | 'none'
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
    authType: 'pipedream',
  },
  {
    id: 'gmail',
    name: 'Gmail',
    description: 'Sync emails and contacts',
    icon: (
      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
        <path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z"/>
      </svg>
    ),
    requiresAuth: true,
    authType: 'pipedream',
  },
  {
    id: 'googlecalendar',
    name: 'Google Calendar',
    description: 'Sync events and meetings',
    icon: (
      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
        <path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11zM9 11H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2zm-8 4H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2z"/>
      </svg>
    ),
    requiresAuth: true,
    authType: 'pipedream',
  },
  {
    id: 'notion',
    name: 'Notion',
    description: 'Sync pages and databases',
    icon: (
      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
        <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466l1.823 1.447zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.886l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.139c-.093-.514.28-.887.747-.933l3.222-.187zM1.936 1.035l13.31-.98c1.634-.14 2.055-.047 3.082.7l4.249 2.986c.7.513.934.653.934 1.213v16.378c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.667c0-.839.374-1.54 1.447-1.632z"/>
      </svg>
    ),
    requiresAuth: true,
    authType: 'pipedream',
  },
  {
    id: 'linear',
    name: 'Linear',
    description: 'Sync issues and projects',
    icon: (
      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
        <path d="M3.354 7.196l13.45 13.449a10.03 10.03 0 01-2.907 1.46c-.072.023-.144-.03-.144-.105V12.086a.1.1 0 00-.1-.1H3.739c-.075 0-.128-.072-.105-.144a10.03 10.03 0 011.72-4.646zM4.669 5.623l13.708 13.708c.39-.234.765-.49 1.12-.767L5.436 4.503c-.277.355-.533.73-.767 1.12zm2.44-2.067L20.444 16.89c.234-.39.49-.765.767-1.12L7.876 2.436c-.355.277-.73.533-1.12.767l.353.353zm3.182-1.69l11.155 11.156a10.1 10.1 0 00.659-3.525C22.105 4.262 17.843 0 12.508 0c-1.25 0-2.449.23-3.557.673.058.063.69.7.34 1.193z"/>
      </svg>
    ),
    requiresAuth: true,
    authType: 'pipedream',
  },
  {
    id: 'googledrive',
    name: 'Google Drive',
    description: 'Sync files and folders',
    icon: (
      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
        <path d="M7.71 3.5L1.15 15l4.58 7.5h13.54L15.71 15 9.14 3.5H7.71zm8.57 0L22.85 15l-4.58 7.5H4.73L8.29 15l6.57-11.5h1.42z"/>
      </svg>
    ),
    requiresAuth: true,
    authType: 'pipedream',
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
  pipedreamConfigured?: boolean
}

type ConnectorStatus = 'idle' | 'connecting' | 'connected' | 'error'

export function ConnectorsStep({ connectors, setConnectors, pipedreamConfigured = false }: ConnectorsStepProps) {
  const [statuses, setStatuses] = useState<Record<string, ConnectorStatus>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [tokenModalOpen, setTokenModalOpen] = useState(false)
  const [tokenModalConnector, setTokenModalConnector] = useState<ConnectorOption | null>(null)
  const [tokenInput, setTokenInput] = useState('')
  const [tokenSaving, setTokenSaving] = useState(false)
  const oauthPopupRef = useRef<Window | null>(null)
  const oauthPollTimerRef = useRef<number | null>(null)
  const oauthTimeoutTimerRef = useRef<number | null>(null)
  const oauthConnectorIdRef = useRef<string | null>(null)

  const clearOauthTimers = () => {
    if (oauthPollTimerRef.current !== null) {
      window.clearInterval(oauthPollTimerRef.current)
      oauthPollTimerRef.current = null
    }
    if (oauthTimeoutTimerRef.current !== null) {
      window.clearTimeout(oauthTimeoutTimerRef.current)
      oauthTimeoutTimerRef.current = null
    }
  }

  const closeOauthPopup = () => {
    clearOauthTimers()
    try {
      oauthPopupRef.current?.close()
    } catch {
      // Best effort - popup may already be closed
    }
    oauthPopupRef.current = null
    oauthConnectorIdRef.current = null
  }

  useEffect(() => {
    return () => {
      if (oauthPollTimerRef.current !== null) {
        window.clearInterval(oauthPollTimerRef.current)
      }
      if (oauthTimeoutTimerRef.current !== null) {
        window.clearTimeout(oauthTimeoutTimerRef.current)
      }
      try {
        oauthPopupRef.current?.close()
      } catch {
        // Best effort - popup may already be closed
      }
    }
  }, [])

  const checkStatus = async (serviceId: string) => {
    const response = await fetch(`${API_BASE_URL}/api/integrations/${serviceId}/status`)
    const data = (await response.json()) as { connected?: boolean; error?: string }
    return data
  }

  // Check status of all connectors on mount to show already-connected services
  useEffect(() => {
    const checkAllStatuses = async () => {
      const statusPromises = CONNECTORS.map(async (connector) => {
        try {
          const status = await checkStatus(connector.id)
          return { id: connector.id, connected: status.connected }
        } catch {
          return { id: connector.id, connected: false }
        }
      })

      const results = await Promise.all(statusPromises)
      const newStatuses: Record<string, ConnectorStatus> = {}
      const newConnectors: string[] = [...connectors]

      for (const result of results) {
        if (result.connected) {
          newStatuses[result.id] = 'connected'
          if (!newConnectors.includes(result.id)) {
            newConnectors.push(result.id)
          }
        }
      }

      setStatuses(newStatuses)
      if (newConnectors.length !== connectors.length) {
        setConnectors(newConnectors)
      }
    }

    checkAllStatuses()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleConnectorClick = async (connector: ConnectorOption) => {
    // If already connected, disconnect for real
    if (statuses[connector.id] === 'connected') {
      setStatuses((prev) => ({ ...prev, [connector.id]: 'connecting' }))
      try {
        const response = await fetch(`${API_BASE_URL}/api/integrations/${connector.id}`, {
          method: 'DELETE',
        })
        const data = await response.json() as { success?: boolean; message?: string }
        if (data.success) {
          setConnectors(connectors.filter((c) => c !== connector.id))
          setStatuses((prev) => ({ ...prev, [connector.id]: 'idle' }))
        } else {
          // Disconnect failed, keep as connected
          setStatuses((prev) => ({ ...prev, [connector.id]: 'connected' }))
          setErrors((prev) => ({ ...prev, [connector.id]: data.message || 'Failed to disconnect' }))
        }
      } catch {
        setStatuses((prev) => ({ ...prev, [connector.id]: 'connected' }))
        setErrors((prev) => ({ ...prev, [connector.id]: 'Failed to disconnect' }))
      }
      return
    }

    // For non-auth connectors, just toggle selection
    if (connector.authType === 'none') {
      if (connectors.includes(connector.id)) {
        setConnectors(connectors.filter((c) => c !== connector.id))
      } else {
        setConnectors([...connectors, connector.id])
        setStatuses((prev) => ({ ...prev, [connector.id]: 'connected' }))
      }
      return
    }

    // For Telegram, select it AND trigger agent start
    if (connector.authType === 'telegram') {
      if (connectors.includes(connector.id)) {
        setConnectors(connectors.filter((c) => c !== connector.id))
        setStatuses((prev) => ({ ...prev, [connector.id]: 'idle' }))
      } else {
        setConnectors([...connectors, connector.id])
        // Fire-and-forget: start agent before user reaches step 5
        fetch(`${API_BASE_URL}/api/setup/telegram/start-agent`, { method: 'POST' })
          .catch(() => {}) // Ignore errors - TelegramAuthStep handles failures
      }
      return
    }

    // For local connectors (like Granola), call backend to check/connect
    if (connector.authType === 'local') {
      setStatuses((prev) => ({ ...prev, [connector.id]: 'connecting' }))
      setErrors((prev) => ({ ...prev, [connector.id]: '' }))

      try {
        const response = await fetch(`${API_BASE_URL}/api/integrations/${connector.id}/status`)
        const data = await response.json() as { connected?: boolean; status?: string; error?: string }

        if (data.connected) {
          setStatuses((prev) => ({ ...prev, [connector.id]: 'connected' }))
          setConnectors([...connectors.filter((c) => c !== connector.id), connector.id])
        } else {
          setStatuses((prev) => ({ ...prev, [connector.id]: 'error' }))
          setErrors((prev) => ({
            ...prev,
            [connector.id]: data.error || 'Not connected',
          }))
        }
      } catch {
        setStatuses((prev) => ({ ...prev, [connector.id]: 'error' }))
        setErrors((prev) => ({ ...prev, [connector.id]: 'Failed to connect' }))
      }
      return
    }

    // For token-based connectors, open token modal
    if (connector.authType === 'token') {
      // First check if already connected
      setStatuses((prev) => ({ ...prev, [connector.id]: 'connecting' }))
      try {
        const existingStatus = await checkStatus(connector.id)
        if (existingStatus.connected) {
          setStatuses((prev) => ({ ...prev, [connector.id]: 'connected' }))
          setConnectors([...connectors.filter((c) => c !== connector.id), connector.id])
          return
        }
      } catch {
        // Not connected, show modal
      }
      setStatuses((prev) => ({ ...prev, [connector.id]: 'idle' }))
      setTokenModalConnector(connector)
      setTokenInput('')
      setTokenModalOpen(true)
      return
    }

    // For Pipedream connectors, trigger OAuth
    if (connector.authType === 'pipedream') {
      if (!pipedreamConfigured) {
        setStatuses((prev) => ({ ...prev, [connector.id]: 'error' }))
        setErrors((prev) => ({
          ...prev,
          [connector.id]: 'Pipedream credentials not configured. Go back to the API Keys step and add them.',
        }))
        return
      }

      setStatuses((prev) => ({ ...prev, [connector.id]: 'connecting' }))
      setErrors((prev) => ({ ...prev, [connector.id]: '' }))

      if (oauthPopupRef.current && !oauthPopupRef.current.closed) {
        setStatuses((prev) => ({ ...prev, [connector.id]: 'error' }))
        setErrors((prev) => ({
          ...prev,
          [connector.id]: 'Finish the currently open OAuth window first.',
        }))
        return
      }

      try {
        const existingStatus = await checkStatus(connector.id)
        if (existingStatus.connected) {
          setStatuses((prev) => ({ ...prev, [connector.id]: 'connected' }))
          setConnectors([...connectors.filter((c) => c !== connector.id), connector.id])
          return
        }

        const response = await fetch(`${API_BASE_URL}/api/integrations/${connector.id}/connect`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
        const data = await response.json() as { redirect_url?: string; error?: string }

        if (!response.ok) {
          setStatuses((prev) => ({ ...prev, [connector.id]: 'error' }))
          setErrors((prev) => ({
            ...prev,
            [connector.id]: data.error || 'Connection failed',
          }))
          return
        }

        if (!data.redirect_url) {
          setStatuses((prev) => ({ ...prev, [connector.id]: 'error' }))
          setErrors((prev) => ({ ...prev, [connector.id]: data.error || 'Connection failed' }))
          return
        }

        const fetchStatus = async () => {
          const statusRes = await fetch(
            `${API_BASE_URL}/api/integrations/${connector.id}/status?refresh=true`,
          )
          return await statusRes.json() as {
            connected?: boolean
            error?: string
          }
        }

        const tryAutobindAndCheck = async () => {
          let statusData = await fetchStatus()

          // Pipedream OAuth can succeed before account_id is bound locally.
          // Attempt autobind and re-check once to persist the connection.
          if (!statusData.connected) {
            try {
              await fetch(`${API_BASE_URL}/api/integrations/${connector.id}/autobind`, {
                method: 'POST',
              })
              statusData = await fetchStatus()
            } catch {
              // Ignore autobind errors; we'll show status check result below.
            }
          }

          return statusData
        }

        // Open OAuth URL — prefer Tauri command (opens in default browser),
        // fall back to window.open() for browser-only mode.
        const isDesktop = isDesktopRuntimeAvailable()

        if (isDesktop) {
          try {
            await openExternalUrl(data.redirect_url)
          } catch {
            setStatuses((prev) => ({ ...prev, [connector.id]: 'error' }))
            setErrors((prev) => ({
              ...prev,
              [connector.id]: 'Failed to open browser. Please try again.',
            }))
            return
          }

          closeOauthPopup()
          oauthConnectorIdRef.current = connector.id

          // In desktop mode, poll backend directly since there's no popup to track
          oauthPollTimerRef.current = window.setInterval(async () => {
            try {
              const statusData = await tryAutobindAndCheck()
              if (statusData.connected) {
                clearOauthTimers()
                oauthConnectorIdRef.current = null
                setStatuses((prev) => ({ ...prev, [connector.id]: 'connected' }))
                setConnectors([
                  ...connectors.filter((c) => c !== connector.id),
                  connector.id,
                ])
              }
            } catch {
              // Keep polling on transient errors
            }
          }, 2000)

          // Longer timeout since user is in external browser
          oauthTimeoutTimerRef.current = window.setTimeout(() => {
            setStatuses((prev) => {
              if (prev[connector.id] !== 'connecting') return prev
              return { ...prev, [connector.id]: 'error' }
            })
            setErrors((prev) => ({
              ...prev,
              [connector.id]: 'OAuth timed out. Please close the browser tab and try again.',
            }))
            closeOauthPopup()
          }, 120000)
        } else {
          // Browser mode: open popup and track its lifecycle
          const popup = window.open(
            data.redirect_url,
            '_blank',
            'width=500,height=600,scrollbars=yes',
          )

          if (!popup) {
            setStatuses((prev) => ({ ...prev, [connector.id]: 'error' }))
            setErrors((prev) => ({
              ...prev,
              [connector.id]: 'Popup blocked. Enable pop-ups and try again.',
            }))
            return
          }

          popup.focus()
          closeOauthPopup()
          oauthPopupRef.current = popup
          oauthConnectorIdRef.current = connector.id

          const finalizeOAuth = async () => {
            const activeConnectorId = oauthConnectorIdRef.current
            closeOauthPopup()

            if (activeConnectorId !== connector.id) {
              return
            }

            try {
              const statusData = await tryAutobindAndCheck()

              if (statusData.connected) {
                setStatuses((prev) => ({ ...prev, [connector.id]: 'connected' }))
                setConnectors([
                  ...connectors.filter((c) => c !== connector.id),
                  connector.id,
                ])
              } else {
                setStatuses((prev) => ({ ...prev, [connector.id]: 'error' }))
                setErrors((prev) => ({
                  ...prev,
                  [connector.id]: statusData.error || 'Not connected',
                }))
              }
            } catch {
              setStatuses((prev) => ({ ...prev, [connector.id]: 'error' }))
              setErrors((prev) => ({ ...prev, [connector.id]: 'Failed to connect' }))
            }
          }

          oauthPollTimerRef.current = window.setInterval(() => {
            const currentPopup = oauthPopupRef.current
            if (!currentPopup || currentPopup.closed) {
              void finalizeOAuth()
            }
          }, 1000)

          oauthTimeoutTimerRef.current = window.setTimeout(() => {
            setStatuses((prev) => {
              if (prev[connector.id] !== 'connecting') return prev
              return { ...prev, [connector.id]: 'error' }
            })
            setErrors((prev) => ({
              ...prev,
              [connector.id]: 'OAuth timed out. Close the window and try again.',
            }))
            closeOauthPopup()
          }, 60000)
        }
      } catch {
        setStatuses((prev) => ({ ...prev, [connector.id]: 'error' }))
        setErrors((prev) => ({ ...prev, [connector.id]: 'Failed to connect' }))
      }
    }
  }

  const handleTokenSave = async () => {
    if (!tokenModalConnector || !tokenInput.trim()) return

    setTokenSaving(true)
    setErrors((prev) => ({ ...prev, [tokenModalConnector.id]: '' }))

    try {
      const response = await fetch(`${API_BASE_URL}/api/integrations/${tokenModalConnector.id}/save-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tokenInput.trim() }),
      })
      const data = await response.json() as { success: boolean; message: string }

      if (data.success) {
        setStatuses((prev) => ({ ...prev, [tokenModalConnector.id]: 'connected' }))
        setConnectors([...connectors.filter((c) => c !== tokenModalConnector.id), tokenModalConnector.id])
        setTokenModalOpen(false)
        setTokenInput('')
      } else {
        setErrors((prev) => ({ ...prev, [tokenModalConnector.id]: data.message }))
        setStatuses((prev) => ({ ...prev, [tokenModalConnector.id]: 'error' }))
      }
    } catch {
      setErrors((prev) => ({ ...prev, [tokenModalConnector.id]: 'Failed to save token' }))
      setStatuses((prev) => ({ ...prev, [tokenModalConnector.id]: 'error' }))
    } finally {
      setTokenSaving(false)
    }
  }

  const getStatusBadge = (connector: ConnectorOption) => {
    const status = statuses[connector.id]
    if (status === 'connecting') {
      return (
        <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
      )
    }
    if (status === 'connected' || connectors.includes(connector.id)) {
      return (
        <svg className="w-4 h-4 text-green-400" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
      )
    }
    if (status === 'error') {
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

      {!pipedreamConfigured && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-300">
          Pipedream not configured — OAuth connectors (Slack, Gmail, etc.) require Pipedream credentials. Go back to the API Keys step to add them.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {CONNECTORS.map((connector) => {
          const isSelected = connectors.includes(connector.id) || statuses[connector.id] === 'connected'
          const isConnecting = statuses[connector.id] === 'connecting'
          const hasError = statuses[connector.id] === 'error'
          const isPipedreamDisabled = connector.authType === 'pipedream' && !pipedreamConfigured

          return (
            <button
              key={connector.id}
              onClick={() => handleConnectorClick(connector)}
              disabled={isConnecting || isPipedreamDisabled}
              className={`p-4 rounded-xl border text-left transition-all ${
                isSelected
                  ? 'bg-white/10 border-white/30'
                  : hasError
                  ? 'bg-red-500/10 border-red-500/30'
                  : 'bg-black/30 border-atlas-border hover:border-white/20'
              } ${isConnecting ? 'opacity-70 cursor-wait' : ''} ${isPipedreamDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
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
                    {errors[connector.id] || connector.description}
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
            {errors[tokenModalConnector.id] && (
              <p className="text-red-400 text-sm mb-4">{errors[tokenModalConnector.id]}</p>
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
