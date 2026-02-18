import { useState, useEffect, useRef } from 'react'
import { API_BASE_URL } from '@/lib/api'
import { getDesktopAtlasApiKey } from '@/lib/desktopRuntimeBootstrap'

interface ApiKeys {
  parallel: string
  pipedream_project_id: string
  pipedream_client_id: string
  pipedream_client_secret: string
  telegram_api_id: string
  telegram_api_hash: string
  assemblyai: string
}

interface ApiKeysStepProps {
  apiKeys: ApiKeys
  setApiKeys: (keys: ApiKeys) => void
}

interface KeyInputProps {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  required?: boolean
  description: string
  docsUrl?: string
  exists?: boolean  // Show green checkmark if key already exists
}

function KeyInput({ label, value, onChange, placeholder, required, description, docsUrl, exists }: KeyInputProps) {
  const [showKey, setShowKey] = useState(false)

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-400">
            {label}
            {required && <span className="text-red-400 ml-1">*</span>}
          </label>
          {exists && (
            <svg className="h-4 w-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>
        {docsUrl && (
          <a
            href={docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-400 hover:text-blue-300 transition"
          >
            Get key
          </a>
        )}
      </div>
      <div className="relative">
        <input
          type={showKey ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`w-full bg-black border rounded-lg px-4 py-3 pr-12 text-white placeholder-gray-600 focus:outline-none font-mono text-sm ${
            exists ? 'border-green-500/50 focus:border-green-500/70' : 'border-atlas-border focus:border-white/30'
          }`}
        />
        <button
          type="button"
          onClick={() => setShowKey(!showKey)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition"
        >
          {showKey ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          )}
        </button>
      </div>
      <p className="text-xs text-gray-600">{description}</p>
    </div>
  )
}

interface ExistingKeys {
  parallel: string | null
  pipedream_project_id: string | null
  pipedream_client_id: string | null
  pipedream_client_secret: string | null
  telegram_api_id: string | null
  telegram_api_hash: string | null
  assemblyai: string | null
  has_parallel: boolean
  has_pipedream: boolean
  has_telegram: boolean
  has_assemblyai: boolean
}

export function ApiKeysStep({ apiKeys, setApiKeys }: ApiKeysStepProps) {
  const [pipedreamValidating, setPipedreamValidating] = useState(false)
  const [pipedreamValid, setPipedreamValid] = useState<boolean | null>(null)
  const [pipedreamError, setPipedreamError] = useState<string | null>(null)
  const lastValidatedCombo = useRef<string>('')
  const [existingKeys, setExistingKeys] = useState<ExistingKeys | null>(null)
  const [loadingExisting, setLoadingExisting] = useState(true)

  const getAuthHeaders = (): Record<string, string> => {
    const atlasKey = getDesktopAtlasApiKey() || import.meta.env.VITE_ATLAS_API_KEY || ''
    return atlasKey ? { 'X-Atlas-Key': atlasKey } : {}
  }

  // Fetch existing keys on mount
  useEffect(() => {
    async function fetchExistingKeys() {
      try {
        const res = await fetch(`${API_BASE_URL}/api/setup/existing-keys`, {
          headers: getAuthHeaders(),
        })
        if (res.ok) {
          const data: ExistingKeys = await res.json()
          setExistingKeys(data)

          // If Pipedream keys exist, mark them as valid (already validated during previous setup)
          if (data.has_pipedream) {
            setPipedreamValid(true)
          }
        }
      } catch (err) {
        console.error('Failed to fetch existing keys:', err)
      } finally {
        setLoadingExisting(false)
      }
    }
    fetchExistingKeys()
  }, [])

  // Validate Pipedream credentials when they change
  useEffect(() => {
    const projectId = apiKeys.pipedream_project_id.trim()
    const clientId = apiKeys.pipedream_client_id.trim()
    const clientSecret = apiKeys.pipedream_client_secret.trim()
    const comboKey = `${projectId}:${clientId}:${clientSecret}`

    // Skip if empty or same as last validated
    if (!projectId || !clientId || !clientSecret || comboKey === lastValidatedCombo.current) {
      if (!projectId || !clientId || !clientSecret) {
        setPipedreamValid(null)
        setPipedreamError(null)
      }
      return
    }

    // Debounce validation
    const timeoutId = setTimeout(async () => {
      setPipedreamValidating(true)
      setPipedreamError(null)

      try {
        const res = await fetch(`${API_BASE_URL}/api/setup/pipedream/validate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify({
            project_id: projectId,
            client_id: clientId,
            client_secret: clientSecret,
          })
        })
        const data = await res.json()

        if (data.valid) {
          setPipedreamValid(true)
          lastValidatedCombo.current = comboKey
        } else {
          setPipedreamValid(false)
          setPipedreamError(data.error || 'Invalid Pipedream credentials')
        }
      } catch (err) {
        setPipedreamValid(false)
        setPipedreamError('Failed to validate')
      } finally {
        setPipedreamValidating(false)
      }
    }, 500)

    return () => clearTimeout(timeoutId)
  }, [apiKeys.pipedream_project_id, apiKeys.pipedream_client_id, apiKeys.pipedream_client_secret])

  // Show loading state while checking existing keys
  if (loadingExisting) {
    return (
      <div className="space-y-6">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-light mb-2 text-white">API Keys</h1>
          <p className="text-gray-400">Checking existing configuration...</p>
        </div>
        <div className="flex justify-center py-8">
          <svg className="animate-spin h-8 w-8 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        </div>
      </div>
    )
  }

  // Count configured keys
  const configuredCount = existingKeys
    ? [existingKeys.has_parallel, existingKeys.has_pipedream, existingKeys.has_telegram, existingKeys.has_assemblyai].filter(Boolean).length
    : 0

  return (
    <div className="space-y-6">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-light mb-2 text-white">API Keys</h1>
        <p className="text-gray-400">Enter your API keys to power Codos</p>
      </div>

      {/* Show existing keys summary */}
      {configuredCount > 0 && (
        <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-lg mb-4">
          <div className="flex items-center gap-2 text-green-400">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span className="font-medium">{configuredCount} key{configuredCount > 1 ? 's' : ''} already configured</span>
          </div>
          <p className="text-green-400/70 text-sm mt-1">
            Found existing keys in your env files. Leave fields empty to keep current values.
          </p>
        </div>
      )}

      <div className="space-y-5">
        <KeyInput
          label={existingKeys?.has_parallel ? `Parallel API Key (${existingKeys.parallel})` : "Parallel API Key"}
          value={apiKeys.parallel}
          onChange={(v) => setApiKeys({ ...apiKeys, parallel: v })}
          placeholder={existingKeys?.has_parallel ? "Leave empty to keep existing" : "..."}
          description="Optional - enables deep research capabilities"
          docsUrl="https://www.parallel.ai"
          exists={existingKeys?.has_parallel}
        />

        {/* Pipedream Credentials with inline validation */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-400">
                {existingKeys?.has_pipedream ? `Pipedream Credentials (${existingKeys.pipedream_project_id})` : "Pipedream Credentials"}
              </label>
              {pipedreamValidating && (
                <svg className="animate-spin h-4 w-4 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              )}
              {!pipedreamValidating && pipedreamValid === true && (
                <svg className="h-4 w-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
              {!pipedreamValidating && pipedreamValid === false && (
                <svg className="h-4 w-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              )}
            </div>
            <a
              href="https://pipedream.com/connect"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-400 hover:text-blue-300 transition"
            >
              Get key
            </a>
          </div>
          <div className="grid grid-cols-1 gap-3">
            <input
              type="text"
              value={apiKeys.pipedream_project_id}
              onChange={(e) => setApiKeys({ ...apiKeys, pipedream_project_id: e.target.value })}
              placeholder={existingKeys?.has_pipedream ? "Leave empty to keep existing project id" : "Project ID (e.g. proj_...)"}
              className={`w-full bg-black border rounded-lg px-4 py-3 text-white placeholder-gray-600 focus:outline-none font-mono text-sm ${
                pipedreamValid === false ? 'border-red-500/50 focus:border-red-500/70' :
                pipedreamValid === true ? 'border-green-500/50 focus:border-green-500/70' :
                'border-atlas-border focus:border-white/30'
              }`}
            />
            <input
              type="text"
              value={apiKeys.pipedream_client_id}
              onChange={(e) => setApiKeys({ ...apiKeys, pipedream_client_id: e.target.value })}
              placeholder={existingKeys?.has_pipedream ? "Leave empty to keep existing client id" : "Client ID"}
              className={`w-full bg-black border rounded-lg px-4 py-3 text-white placeholder-gray-600 focus:outline-none font-mono text-sm ${
                pipedreamValid === false ? 'border-red-500/50 focus:border-red-500/70' :
                pipedreamValid === true ? 'border-green-500/50 focus:border-green-500/70' :
                'border-atlas-border focus:border-white/30'
              }`}
            />
            <input
              type="password"
              value={apiKeys.pipedream_client_secret}
              onChange={(e) => setApiKeys({ ...apiKeys, pipedream_client_secret: e.target.value })}
              placeholder={existingKeys?.has_pipedream ? "Leave empty to keep existing client secret" : "Client Secret"}
              className={`w-full bg-black border rounded-lg px-4 py-3 text-white placeholder-gray-600 focus:outline-none font-mono text-sm ${
                pipedreamValid === false ? 'border-red-500/50 focus:border-red-500/70' :
                pipedreamValid === true ? 'border-green-500/50 focus:border-green-500/70' :
                'border-atlas-border focus:border-white/30'
              }`}
            />
          </div>
          {pipedreamError ? (
            <p className="text-xs text-red-400">{pipedreamError}</p>
          ) : (
            <p className="text-xs text-gray-600">Required for connectors (Slack, Gmail, Calendar, Notion, Linear, etc.)</p>
          )}
        </div>

        <KeyInput
          label={existingKeys?.has_telegram ? `Telegram API ID (${existingKeys.telegram_api_id})` : "Telegram API ID"}
          value={apiKeys.telegram_api_id}
          onChange={(v) => setApiKeys({ ...apiKeys, telegram_api_id: v })}
          placeholder={existingKeys?.has_telegram ? "Leave empty to keep existing" : "12345678"}
          description="Required for Telegram message sync"
          docsUrl="https://my.telegram.org/apps"
          exists={existingKeys?.has_telegram}
        />

        <KeyInput
          label={existingKeys?.has_telegram ? `Telegram API Hash (${existingKeys.telegram_api_hash})` : "Telegram API Hash"}
          value={apiKeys.telegram_api_hash}
          onChange={(v) => setApiKeys({ ...apiKeys, telegram_api_hash: v })}
          placeholder={existingKeys?.has_telegram ? "Leave empty to keep existing" : "0123456789abcdef..."}
          description="Required for Telegram message sync"
          docsUrl="https://my.telegram.org/apps"
          exists={existingKeys?.has_telegram}
        />

        <KeyInput
          label={existingKeys?.has_assemblyai ? `AssemblyAI API Key (${existingKeys.assemblyai})` : "AssemblyAI API Key"}
          value={apiKeys.assemblyai}
          onChange={(v) => setApiKeys({ ...apiKeys, assemblyai: v })}
          placeholder={existingKeys?.has_assemblyai ? "Leave empty to keep existing" : "..."}
          description="Optional - for voice transcription"
          docsUrl="https://www.assemblyai.com/dashboard"
          exists={existingKeys?.has_assemblyai}
        />
      </div>

      <div className="mt-6 p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
        <p className="text-blue-400 text-sm">
          <span className="font-medium">Security note:</span> Your API keys are stored locally and never sent to our servers.
        </p>
      </div>
    </div>
  )
}
