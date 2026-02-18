import { useState, useCallback, useEffect } from 'react'
import { API_BASE_URL } from '@/lib/api'
import { getDesktopAtlasApiKey } from '@/lib/desktopRuntimeBootstrap'

interface DependencyStatus {
  name: string
  installed: boolean
  version: string | null
  required_version: string
  status: 'ok' | 'warning' | 'missing'
  install_command: string
}

interface DependencyCheckResponse {
  all_ok: boolean
  dependencies: DependencyStatus[]
}

interface DependencyCheckProps {
  onComplete: () => void
  onSkip?: () => void
}

const DEPENDENCY_INFO: Record<string, { label: string; description: string }> = {
  bun: {
    label: 'Bun',
    description: 'Fast JavaScript runtime and package manager',
  },
  claude: {
    label: 'Claude CLI',
    description: 'AI coding assistant from Anthropic',
  },
}

function StatusIcon({ status }: { status: 'ok' | 'warning' | 'missing' }) {
  if (status === 'ok') {
    return (
      <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center border border-green-500/30 shrink-0">
        <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      </div>
    )
  }

  if (status === 'warning') {
    return (
      <div className="w-8 h-8 rounded-full bg-yellow-500/20 flex items-center justify-center border border-yellow-500/30 shrink-0">
        <svg className="w-4 h-4 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      </div>
    )
  }

  return (
    <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center border border-red-500/30 shrink-0">
      <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  return (
    <button
      onClick={handleCopy}
      className="px-2 py-1 text-xs bg-white/5 hover:bg-white/10 rounded border border-white/10 text-gray-400 hover:text-white transition flex items-center gap-1"
    >
      {copied ? (
        <>
          <svg className="w-3 h-3 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span className="text-green-400">Copied</span>
        </>
      ) : (
        <>
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          <span>Copy</span>
        </>
      )}
    </button>
  )
}

function DependencyRow({ dep }: { dep: DependencyStatus }) {
  const info = DEPENDENCY_INFO[dep.name] || { label: dep.name, description: '' }
  const showInstallCommand = dep.status !== 'ok'

  return (
    <div className="p-4 bg-black/30 border border-white/10 rounded-lg space-y-3">
      <div className="flex items-center gap-3">
        <StatusIcon status={dep.status} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-white">{info.label}</span>
            {dep.version && (
              <span className={`text-xs px-2 py-0.5 rounded ${
                dep.status === 'ok'
                  ? 'bg-green-500/20 text-green-400'
                  : dep.status === 'warning'
                  ? 'bg-yellow-500/20 text-yellow-400'
                  : 'bg-gray-500/20 text-gray-400'
              }`}>
                v{dep.version}
              </span>
            )}
            {dep.required_version && dep.status === 'warning' && (
              <span className="text-xs text-yellow-400">
                (requires {dep.required_version}+)
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-0.5">{info.description}</p>
        </div>
        {dep.status === 'ok' && (
          <span className="text-xs text-green-400 font-medium">Installed</span>
        )}
        {dep.status === 'warning' && (
          <span className="text-xs text-yellow-400 font-medium">Update needed</span>
        )}
        {dep.status === 'missing' && (
          <span className="text-xs text-red-400 font-medium">Not installed</span>
        )}
      </div>

      {showInstallCommand && (
        <div className="flex items-center gap-2">
          <code className="flex-1 bg-black/50 px-3 py-2 rounded border border-white/5 font-mono text-xs text-gray-300 overflow-x-auto">
            {dep.install_command}
          </code>
          <CopyButton text={dep.install_command} />
        </div>
      )}
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2].map((i) => (
        <div key={i} className="p-4 bg-black/30 border border-white/10 rounded-lg animate-pulse">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-white/10" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-white/10 rounded w-24" />
              <div className="h-3 bg-white/5 rounded w-48" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

export function DependencyCheck({ onComplete, onSkip }: DependencyCheckProps) {
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<DependencyCheckResponse | null>(null)

  const checkDependencies = useCallback(async () => {
    setChecking(true)
    setError(null)

    try {
      const atlasKey = getDesktopAtlasApiKey() || import.meta.env.VITE_ATLAS_API_KEY || ''
      const response = await fetch(`${API_BASE_URL}/api/setup/check-dependencies`, {
        headers: atlasKey ? { 'X-Atlas-Key': atlasKey } : {},
      })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      const data: DependencyCheckResponse = await response.json()
      setResult(data)

      // Auto-trigger onComplete if all dependencies are OK
      if (data.all_ok) {
        // Small delay so user can see the success state
        setTimeout(() => {
          onComplete()
        }, 500)
      }
    } catch (err) {
      console.error('Failed to check dependencies:', err)
      setError('Failed to reach backend. Make sure the server is running.')
      // Create fallback result with all missing
      setResult({
        all_ok: false,
        dependencies: [
          { name: 'bun', installed: false, version: null, required_version: '1.0', status: 'missing', install_command: 'curl -fsSL https://bun.sh/install | bash' },
          { name: 'claude', installed: false, version: null, required_version: '1.0', status: 'missing', install_command: 'npm install -g @anthropic-ai/claude-code' },
        ],
      })
    } finally {
      setChecking(false)
    }
  }, [onComplete])

  // Initial check on mount
  useEffect(() => {
    checkDependencies()
  }, [checkDependencies])

  const allOk = result?.all_ok ?? false
  const hasIssues = result && !result.all_ok
  const missingCount = result?.dependencies.filter(d => d.status === 'missing').length ?? 0
  const warningCount = result?.dependencies.filter(d => d.status === 'warning').length ?? 0

  return (
    <div className="space-y-6">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-light mb-2 text-white">System Dependencies</h1>
        <p className="text-gray-400">Checking required tools for Codos to function</p>
      </div>

      {checking ? (
        <div className="space-y-4">
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="w-12 h-12 border-2 border-white/20 border-t-white rounded-full animate-spin" />
            <p className="text-gray-400">Checking dependencies...</p>
          </div>
          <LoadingSkeleton />
        </div>
      ) : (
        <>
          {/* Summary banner */}
          {allOk && (
            <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-lg flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center border border-green-500/30">
                <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <p className="text-green-400 font-medium">All dependencies installed</p>
                <p className="text-green-400/70 text-sm">You're ready to proceed with the setup</p>
              </div>
            </div>
          )}

          {hasIssues && (
            <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-yellow-500/20 flex items-center justify-center border border-yellow-500/30">
                <svg className="w-5 h-5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <p className="text-yellow-400 font-medium">
                  {missingCount > 0 && `${missingCount} missing`}
                  {missingCount > 0 && warningCount > 0 && ', '}
                  {warningCount > 0 && `${warningCount} need update`}
                </p>
                <p className="text-yellow-400/70 text-sm">Install the required dependencies and check again</p>
              </div>
            </div>
          )}

          {error && (
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          {/* Dependency list */}
          <div className="space-y-3">
            {result?.dependencies.map((dep) => (
              <DependencyRow key={dep.name} dep={dep} />
            ))}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-4">
            {onSkip && (
              <button
                onClick={onSkip}
                className="text-gray-500 hover:text-gray-300 text-sm transition-colors"
              >
                Skip for now
              </button>
            )}
            {!onSkip && <div />}
            <div className="flex items-center gap-3">
              <button
                onClick={checkDependencies}
                disabled={checking}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm text-white transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <svg className={`w-4 h-4 ${checking ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Check Again
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
