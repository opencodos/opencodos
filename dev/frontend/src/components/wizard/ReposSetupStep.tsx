import { useEffect, useState, useImperativeHandle, forwardRef } from 'react'
import { API_BASE_URL } from '@/lib/api'
import { getDesktopAtlasApiKey } from '@/lib/desktopRuntimeBootstrap'

interface PathStatus {
  exists: boolean
  isGitRepo: boolean
  hasExpectedStructure: boolean
}

interface DetectedPaths {
  codosPath?: string | null
  vaultPath?: string | null
  codosStatus?: PathStatus | null
  vaultStatus?: PathStatus | null
  codos_path?: string | null
  vault_path?: string | null
}

interface ReposSetupStepProps {
  codosPath: string
  setCodosPath: (path: string) => void
  vaultPath: string
  setVaultPath: (path: string) => void
  onInitialized: () => void
}

export interface ReposSetupStepHandle {
  save: () => Promise<boolean>
}

export const ReposSetupStep = forwardRef<ReposSetupStepHandle, ReposSetupStepProps>(function ReposSetupStep({
  codosPath,
  setCodosPath,
  vaultPath,
  setVaultPath,
  onInitialized,
}, ref) {
  const [detecting, setDetecting] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [codosStatus, setCodosStatus] = useState<PathStatus | null>(null)
  const [vaultStatus, setVaultStatus] = useState<PathStatus | null>(null)

  const parseJsonOrNull = (raw: string) => {
    if (!raw) return null
    try {
      return JSON.parse(raw) as unknown
    } catch {
      return null
    }
  }

  const getAuthHeaders = (): Record<string, string> => {
    const atlasKey = getDesktopAtlasApiKey() || import.meta.env.VITE_ATLAS_API_KEY || ''
    return atlasKey ? { 'X-Atlas-Key': atlasKey } : {}
  }

  // Auto-detect paths on mount
  useEffect(() => {
    const detectPaths = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/setup/repos/detect`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        })
        const raw = await response.text()
        const data = (parseJsonOrNull(raw) || {}) as DetectedPaths
        const resolvedCodosPath = data.codosPath ?? data.codos_path
        const resolvedVaultPath = data.vaultPath ?? data.vault_path

        if (resolvedCodosPath) setCodosPath(resolvedCodosPath)
        if (resolvedVaultPath) setVaultPath(resolvedVaultPath)
        if (data.codosStatus) setCodosStatus(data.codosStatus)
        if (data.vaultStatus) setVaultStatus(data.vaultStatus)
      } catch {
        // Backend not available; leave inputs empty for manual entry
        setError('Backend is unavailable. Enter paths manually.')
      } finally {
        setDetecting(false)
      }
    }
    detectPaths()
  }, [setCodosPath, setVaultPath])

  const handleSave = async (): Promise<boolean> => {
    if (!codosPath || !vaultPath) {
      setError('Both paths are required')
      return false
    }

    setSaving(true)
    setError(null)

    try {
      const response = await fetch(`${API_BASE_URL}/api/setup/repos/initialize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ codos_path: codosPath, vault_path: vaultPath }),
      })

      const raw = await response.text()
      const data = parseJsonOrNull(raw)

      if (!response.ok) {
        const detail =
          data && typeof data === 'object' && 'detail' in data
            ? (data as { detail?: unknown }).detail
            : null
        const message =
          typeof detail === 'string'
            ? detail
            : Array.isArray(detail)
              ? detail
                  .map((item) => {
                    if (typeof item === 'string') return item
                    if (item && typeof item === 'object' && 'msg' in item) {
                      return String((item as { msg?: string }).msg)
                    }
                    try {
                      return JSON.stringify(item)
                    } catch {
                      return String(item)
                    }
                  })
                  .join(', ')
              : response.statusText || 'Failed to initialize repositories'
        throw new Error(message)
      }

      onInitialized()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save configuration')
      return false
    } finally {
      setSaving(false)
    }
  }

  // Expose save method to parent via ref
  useImperativeHandle(ref, () => ({
    save: handleSave
  }))

  const getStatusBadge = (status: PathStatus | null, label: string) => {
    if (!status) return null

    if (status.exists && status.hasExpectedStructure) {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full bg-green-500/20 text-green-400 border border-green-500/30">
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
          Using existing {label}
        </span>
      )
    }

    if (status.exists) {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          Folder exists (will configure)
        </span>
      )
    }

    return (
      <span className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">
        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
        </svg>
        Will create
      </span>
    )
  }

  return (
    <div className="space-y-6">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-light mb-2 text-white">Set Up Your Workspaces</h1>
        <p className="text-gray-400">Configure where Codos stores code and context</p>
      </div>

      {detecting ? (
        <div className="flex flex-col items-center justify-center py-12">
          <div className="w-12 h-12 border-2 border-white/20 border-t-white rounded-full animate-spin mb-4" />
          <p className="text-gray-400">Detecting existing workspaces...</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Code Repository */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm text-gray-400 flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                </svg>
                Code Repository (codos)
              </label>
              {getStatusBadge(codosStatus, 'workspace')}
            </div>
            <div className="relative">
              <input
                type="text"
                value={codosPath}
                onChange={(e) => setCodosPath(e.target.value)}
                placeholder="/path/to/codos"
                className="w-full bg-black border border-white/10 rounded-lg px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-white/30 font-mono text-sm"
              />
            </div>
            <p className="text-xs text-gray-600">
              Skills, ingestion pipelines, hooks, and development files
            </p>
          </div>

          {/* Vault Repository */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm text-gray-400 flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                Context Vault (Obsidian)
              </label>
              {getStatusBadge(vaultStatus, 'vault')}
            </div>
            <div className="relative">
              <input
                type="text"
                value={vaultPath}
                onChange={(e) => setVaultPath(e.target.value)}
                placeholder="/path/to/vault"
                className="w-full bg-black border border-white/10 rounded-lg px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-white/30 font-mono text-sm"
              />
            </div>
            <p className="text-xs text-gray-600">
              Notes, briefs, todos, CRM data, and personal context
            </p>
          </div>

          {/* What will be created */}
          <div className="mt-6 p-4 bg-white/5 border border-white/10 rounded-lg">
            <h3 className="text-sm font-medium text-white mb-3">What gets saved</h3>
            <div className="space-y-2 text-sm text-gray-400">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>~/.codos/paths.json with your workspace locations</span>
              </div>
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-gray-500">Existing folders are never modified</span>
              </div>
            </div>
          </div>

          {error && (
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          {saving && (
            <div className="flex items-center justify-center gap-2 text-gray-400">
              <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
              <span>Saving...</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
})
