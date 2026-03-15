import { useState, useEffect, useCallback, useMemo } from 'react'
import { API_BASE_URL } from '@/lib/api'

interface SchedulePreset {
  id: string
  label: string
  description: string
}

interface ConnectorPresets {
  connector: string
  name: string
  default_preset: string
  presets: SchedulePreset[]
}

interface ScheduleConfigStepProps {
  connectors: string[]
  onComplete: () => void
  onSkip: () => void
}

// Map frontend connector IDs to backend preset IDs
const CONNECTOR_TO_PRESET_ID: Record<string, string> = {
  googlecalendar: 'calendar',
}

// Display names for connectors
const CONNECTOR_DISPLAY_NAMES: Record<string, string> = {
  telegram: 'Telegram',
  slack: 'Slack',
  gmail: 'Gmail',
  googlecalendar: 'Google Calendar',
  calendar: 'Google Calendar',
  notion: 'Notion',
  linear: 'Linear',
  github: 'GitHub',
  googledrive: 'Google Drive',
  granola: 'Granola',
}

// Helper to get preset ID for a connector
const getPresetId = (connectorId: string): string => {
  return CONNECTOR_TO_PRESET_ID[connectorId] || connectorId
}

// Standalone connectors get interactive preset selectors and LaunchAgent installation.
// All other connectors are workflow-based — their schedules are defined in YAML files.
const STANDALONE_CONNECTORS = ['telegram', 'granola']

// Helper to check if a connector has scheduling support (more than just "manual")
const hasSchedulingSupport = (presets: ConnectorPresets | undefined): boolean => {
  if (!presets) return false
  // Has scheduling support if there's at least one preset that isn't "manual"
  return presets.presets.some(p => p.id !== 'manual')
}

const CONNECTOR_ICONS: Record<string, string> = {
  telegram: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z',
  slack: 'M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z',
  gmail: 'M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z',
  calendar: 'M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM9 10H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2zm-8 4H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2z',
  googlecalendar: 'M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM9 10H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2zm-8 4H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2z',
  notion: 'M4 3h16c.55 0 1 .45 1 1v16c0 .55-.45 1-1 1H4c-.55 0-1-.45-1-1V4c0-.55.45-1 1-1zm1 2v14h14V5H5zm2 2h4v4H7V7zm6 0h4v2h-4V7zm0 4h4v2h-4v-2zm-6 2h4v4H7v-4zm6 2h4v2h-4v-2z',
  linear: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z',
  github: 'M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z',
  googledrive: 'M7.71 3.5L1.15 15l4.58 7.5h13.54L15.71 15 9.14 3.5H7.71zm8.57 0L22.85 15l-4.58 7.5H4.73L8.29 15l6.57-11.5h1.42z',
  granola: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm-1-13h2v6h-2zm0 8h2v2h-2z',
}

export function ScheduleConfigStep({ connectors: rawConnectors, onComplete, onSkip }: ScheduleConfigStepProps) {
  // Expand "google" into individual services that have their own schedule presets
  const connectors = useMemo(
    () => rawConnectors.flatMap(c => c === 'google' ? ['gmail', 'calendar'] : [c]),
    [rawConnectors],
  )

  // Split into standalone (interactive) vs workflow (read-only) connectors
  const standaloneConnectors = useMemo(() => connectors.filter(c => STANDALONE_CONNECTORS.includes(c)), [connectors])
  const workflowConnectors = useMemo(() => connectors.filter(c => !STANDALONE_CONNECTORS.includes(c)), [connectors])

  const [allPresets, setAllPresets] = useState<Record<string, ConnectorPresets>>({})
  const [selections, setSelections] = useState<Record<string, string>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [isInstalling, setIsInstalling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [installResults, setInstallResults] = useState<Record<string, { success: boolean; error?: string }>>({})

  // Fetch presets on mount
  useEffect(() => {
    const fetchPresets = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/setup/schedules/presets`)
        if (!response.ok) throw new Error('Failed to fetch presets')

        const data = await response.json()

        // Build a map of all presets by connector ID
        const presetsMap: Record<string, ConnectorPresets> = {}
        for (const preset of data.connectors) {
          presetsMap[preset.connector] = preset
        }

        setAllPresets(presetsMap)

        // Initialize selections with defaults only for standalone connectors
        const defaultSelections: Record<string, string> = {}
        for (const connectorId of standaloneConnectors) {
          const presetId = getPresetId(connectorId)
          const connectorPresets = presetsMap[presetId]
          if (connectorPresets && hasSchedulingSupport(connectorPresets)) {
            defaultSelections[connectorId] = connectorPresets.default_preset
          }
        }
        setSelections(defaultSelections)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load presets')
      } finally {
        setIsLoading(false)
      }
    }

    if (connectors.length > 0) {
      fetchPresets()
    } else {
      setIsLoading(false)
    }
  }, [connectors])

  const handlePresetSelect = useCallback((connectorId: string, presetId: string) => {
    setSelections((prev) => ({
      ...prev,
      [connectorId]: presetId,
    }))
  }, [])

  const handleInstall = useCallback(async () => {
    setIsInstalling(true)
    setError(null)
    setInstallResults({})

    try {
      // Only install schedules for standalone connectors (not workflow-based ones)
      const selectionsArray = Object.entries(selections)
        .filter(([connectorId]) => {
          if (!STANDALONE_CONNECTORS.includes(connectorId)) return false
          const presetId = getPresetId(connectorId)
          return hasSchedulingSupport(allPresets[presetId])
        })
        .map(([connectorId, preset_id]) => ({
          // Use the backend preset ID (e.g., "calendar" instead of "googlecalendar")
          connector: getPresetId(connectorId),
          preset_id,
        }))

      const response = await fetch(`${API_BASE_URL}/api/setup/schedules/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selections: selectionsArray }),
      })

      if (!response.ok) throw new Error('Failed to install schedules')

      const data = await response.json()

      // Map results back to frontend connector IDs
      const resultsMap: Record<string, { success: boolean; error?: string }> = {}
      for (const result of data.results) {
        // Find the original connector ID (reverse mapping)
        const originalConnectorId = connectors.find(c => getPresetId(c) === result.connector) || result.connector
        resultsMap[originalConnectorId] = {
          success: result.success,
          error: result.error,
        }
      }
      setInstallResults(resultsMap)

      if (data.success) {
        // Small delay to show success state
        setTimeout(onComplete, 1000)
      } else {
        setError(`Some schedules failed to install: ${data.message}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to install schedules')
    } finally {
      setIsInstalling(false)
    }
  }, [selections, allPresets, connectors, onComplete])

  const getConnectorPresets = (connectorId: string): ConnectorPresets | undefined => {
    const presetId = getPresetId(connectorId)
    return allPresets[presetId]
  }

  const getSelectedPreset = (connectorId: string): SchedulePreset | undefined => {
    const connectorPresets = getConnectorPresets(connectorId)
    if (!connectorPresets) return undefined
    return connectorPresets.presets.find((p) => p.id === selections[connectorId])
  }

  const getDisplayName = (connectorId: string): string => {
    return CONNECTOR_DISPLAY_NAMES[connectorId] || connectorId.charAt(0).toUpperCase() + connectorId.slice(1)
  }

  if (connectors.length === 0) {
    return (
      <div className="space-y-6">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-light mb-2 text-white">Schedule Configuration</h1>
          <p className="text-gray-400">No connectors to configure</p>
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
            You can configure schedules later from settings.
          </p>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-light mb-2 text-white">Schedule Configuration</h1>
          <p className="text-gray-400">Loading schedule options...</p>
        </div>

        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-orange-500/30 border-t-orange-500 rounded-full animate-spin" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-light mb-2 text-white">Schedule Configuration</h1>
        <p className="text-gray-400">
          Configure when each connector syncs automatically
        </p>
      </div>

      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg mb-6">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* Standalone connectors — interactive preset selectors */}
      {standaloneConnectors.length > 0 && (
        <div className="space-y-4">
          {standaloneConnectors.map((connectorId) => {
            const connectorPresets = getConnectorPresets(connectorId)
            const selectedPreset = getSelectedPreset(connectorId)
            const installResult = installResults[connectorId]
            const displayName = getDisplayName(connectorId)
            const supported = hasSchedulingSupport(connectorPresets)

            return (
              <div
                key={connectorId}
                className="p-4 bg-black/30 rounded-xl border border-atlas-border"
              >
                {/* Connector header */}
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg bg-atlas-card flex items-center justify-center">
                    <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                      <path d={CONNECTOR_ICONS[connectorId] || CONNECTOR_ICONS.granola} />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <h3 className="font-medium text-white">{displayName}</h3>
                    <p className="text-xs text-gray-500">
                      {selectedPreset?.description || 'Select a schedule'}
                    </p>
                  </div>
                  {installResult && (
                    <div className="flex items-center">
                      {installResult.success ? (
                        <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      )}
                    </div>
                  )}
                </div>

                {/* Preset buttons */}
                {supported && (
                  <div className="flex flex-wrap gap-2">
                    {connectorPresets?.presets.map((preset) => {
                      const isSelected = selections[connectorId] === preset.id
                      return (
                        <button
                          key={preset.id}
                          onClick={() => handlePresetSelect(connectorId, preset.id)}
                          disabled={isInstalling}
                          className={`
                            px-3 py-1.5 rounded-lg text-sm transition-all
                            ${isSelected
                              ? 'bg-orange-500/20 border-orange-500/50 text-orange-400 border'
                              : 'bg-atlas-card border border-atlas-border text-gray-400 hover:border-gray-600 hover:text-gray-300'
                            }
                            ${isInstalling ? 'opacity-50 cursor-not-allowed' : ''}
                          `}
                        >
                          {preset.label}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Workflow-based connectors — read-only display */}
      {workflowConnectors.length > 0 && (
        <div className="mt-6">
          {/* Section header */}
          <div className="flex items-center gap-3 mb-3">
            <div className="flex-1 h-px bg-atlas-border/50" />
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Scheduled Workflows</span>
            <div className="flex-1 h-px bg-atlas-border/50" />
          </div>

          <p className="text-xs text-gray-500 mb-3">
            These connectors sync via Scheduled Workflows.
            Edit files in <span className="text-gray-400 font-mono">skills/Scheduled Workflows/workflows/</span> to customize.
          </p>

          <div className="bg-black/20 rounded-xl border border-atlas-border/50 divide-y divide-atlas-border/30">
            {workflowConnectors.map((connectorId) => {
              const connectorPresets = getConnectorPresets(connectorId)
              const displayName = getDisplayName(connectorId)
              // Show the default preset's label as the schedule description
              const defaultPreset = connectorPresets?.presets.find(p => p.id === connectorPresets.default_preset)

              return (
                <div
                  key={connectorId}
                  className="flex items-center gap-3 px-4 py-3"
                >
                  <div className="w-8 h-8 rounded-lg bg-atlas-card/50 flex items-center justify-center">
                    <svg className="w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="currentColor">
                      <path d={CONNECTOR_ICONS[connectorId] || CONNECTOR_ICONS.granola} />
                    </svg>
                  </div>
                  <span className="text-sm text-gray-400 flex-1">{displayName}</span>
                  <span className="text-xs text-gray-500">
                    {defaultPreset?.label || 'Configured in workflow'}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-4 pt-4">
        <button
          onClick={onSkip}
          disabled={isInstalling}
          className="flex-1 py-3 px-4 rounded-xl border border-atlas-border text-gray-400 hover:text-white hover:border-gray-600 transition-colors disabled:opacity-50"
        >
          Skip
        </button>
        <button
          onClick={handleInstall}
          disabled={isInstalling}
          className="flex-1 py-3 px-4 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {isInstalling ? (
            <>
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Installing...
            </>
          ) : (
            'Install Schedules'
          )}
        </button>
      </div>

      <p className="text-xs text-gray-500 text-center">
        {standaloneConnectors.length > 0
          ? 'Standalone schedules are installed as macOS LaunchAgents. Workflow schedules are managed separately.'
          : 'All connectors use Scheduled Workflows. You can customize them from the workflow YAML files.'}
      </p>
    </div>
  )
}
