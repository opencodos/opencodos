import { useCallback, useEffect, useState } from 'react'
import {
  getDesktopDefaultVaultPath,
  getDesktopRuntimeBootstrapStatus,
  getDesktopServiceCatalog,
  getDesktopRuntimeSettings,
  getDesktopServiceRegistry,
  getDesktopServiceEvents,
  getDesktopServices,
  isDesktopRuntimeAvailable,
  startDesktopAutostartServices,
  startDesktopService,
  stopDesktopService,
  updateDesktopServiceRegistry,
  updateDesktopRuntimeSettings,
  type DesktopServiceCatalogEntry,
  type DesktopServiceRegistryConfig,
  type DesktopRuntimeSettings,
  type DesktopServiceEvent,
  type DesktopServiceStatus,
  type DesktopRuntimeBootstrapStatus,
} from '@/lib/desktopRuntime'

const WIZARD_STORAGE_KEY = 'codos-wizard-state'

function formatTime(timestampMs?: number): string {
  if (!timestampMs) return 'n/a'
  const date = new Date(timestampMs)
  if (Number.isNaN(date.getTime())) return 'n/a'
  return date.toLocaleString()
}

export function DesktopRuntimeSettingsPage() {
  const [services, setServices] = useState<DesktopServiceStatus[]>([])
  const [events, setEvents] = useState<DesktopServiceEvent[]>([])
  const [serviceCatalog, setServiceCatalog] = useState<DesktopServiceCatalogEntry[]>([])
  const [serviceRegistry, setServiceRegistry] = useState<DesktopServiceRegistryConfig | null>(null)
  const [settings, setSettings] = useState<DesktopRuntimeSettings>({
    autoStartServicesOnLaunch: true,
    launchAtLoginEnabled: true,
    backendMode: 'managed',
  })
  const [bootstrap, setBootstrap] = useState<DesktopRuntimeBootstrapStatus | null>(null)
  const [detectedVaultPath, setDetectedVaultPath] = useState<string | null>(null)
  const [loadingServiceId, setLoadingServiceId] = useState<string | null>(null)
  const [loadingRegistryId, setLoadingRegistryId] = useState<string | null>(null)
  const [loadingSettings, setLoadingSettings] = useState(false)
  const [loadingAutostart, setLoadingAutostart] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [nextServices, nextSettings, nextEvents, nextRegistry, nextCatalog, nextDetectedVaultPath, nextBootstrap] =
        await Promise.all([
        getDesktopServices(),
        getDesktopRuntimeSettings(),
        getDesktopServiceEvents(50),
        getDesktopServiceRegistry(),
        getDesktopServiceCatalog(),
        getDesktopDefaultVaultPath(),
        getDesktopRuntimeBootstrapStatus(),
      ])
      setServices(nextServices)
      setSettings(nextSettings)
      setEvents(nextEvents)
      setServiceRegistry(nextRegistry)
      setServiceCatalog(nextCatalog)
      setDetectedVaultPath(nextDetectedVaultPath)
      setBootstrap(nextBootstrap)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load desktop runtime settings')
    }
  }, [])

  useEffect(() => {
    if (!isDesktopRuntimeAvailable()) return
    void refresh()
    const intervalId = window.setInterval(() => {
      void refresh()
    }, 5000)

    return () => window.clearInterval(intervalId)
  }, [refresh])

  if (!isDesktopRuntimeAvailable()) {
    return (
      <div className="mx-auto mt-10 max-w-3xl rounded border border-white/10 bg-black/40 p-6 text-sm text-white/80">
        Desktop settings are available only in the Tauri desktop runtime.
      </div>
    )
  }

  async function toggleAutoStartServicesOnLaunch(enabled: boolean) {
    setLoadingSettings(true)
    try {
      const next = await updateDesktopRuntimeSettings({ autoStartServicesOnLaunch: enabled })
      setSettings(next)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update setting')
    } finally {
      setLoadingSettings(false)
    }
  }

  async function toggleLaunchAtLogin(enabled: boolean) {
    setLoadingSettings(true)
    try {
      const next = await updateDesktopRuntimeSettings({ launchAtLoginEnabled: enabled })
      setSettings(next)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update setting')
    } finally {
      setLoadingSettings(false)
    }
  }

  async function setBackendMode(mode: DesktopRuntimeSettings['backendMode']) {
    setLoadingSettings(true)
    try {
      const next = await updateDesktopRuntimeSettings({ backendMode: mode })
      setSettings(next)
      await refresh()
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update backend mode')
    } finally {
      setLoadingSettings(false)
    }
  }

  async function startService(serviceId: string) {
    setLoadingServiceId(serviceId)
    try {
      await startDesktopService(serviceId)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to start ${serviceId}`)
    } finally {
      setLoadingServiceId(null)
    }
  }

  async function stopService(serviceId: string) {
    setLoadingServiceId(serviceId)
    try {
      await stopDesktopService(serviceId)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to stop ${serviceId}`)
    } finally {
      setLoadingServiceId(null)
    }
  }

  async function startAutostart() {
    setLoadingAutostart(true)
    try {
      await startDesktopAutostartServices()
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start autostart services')
    } finally {
      setLoadingAutostart(false)
    }
  }

  async function switchToManagedAndStart() {
    setLoadingSettings(true)
    try {
      const next = await updateDesktopRuntimeSettings({ backendMode: 'managed' })
      setSettings(next)
      await startDesktopAutostartServices()
      await refresh()
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to switch backend mode and start services')
    } finally {
      setLoadingSettings(false)
    }
  }

  async function persistServiceRegistry(nextRegistry: DesktopServiceRegistryConfig, serviceId: string) {
    setLoadingRegistryId(serviceId)
    try {
      const savedRegistry = await updateDesktopServiceRegistry(nextRegistry)
      setServiceRegistry(savedRegistry)
      await refresh()
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update service registry')
    } finally {
      setLoadingRegistryId(null)
    }
  }

  function runSetupAgain() {
    localStorage.removeItem(WIZARD_STORAGE_KEY)
    localStorage.removeItem('atlas-autostart')
    window.location.hash = '/setup'
  }

  function defaultRestartPolicyForService(serviceId: string) {
    const catalogEntry = serviceCatalog.find((entry) => entry.id === serviceId)
    return {
      enabled: catalogEntry?.defaultRestartOnCrash ?? false,
      maxAttempts: catalogEntry?.defaultMaxRestartAttempts,
    }
  }

  async function toggleServiceEnabled(serviceId: string, enabled: boolean) {
    if (!serviceRegistry) return

    const nextEnabled = new Set(serviceRegistry.enabledServices)
    const nextAutostart = new Set(serviceRegistry.autostartServices)
    const nextPolicies = { ...serviceRegistry.restartPolicies }

    if (enabled) {
      nextEnabled.add(serviceId)
      if (!nextPolicies[serviceId]) {
        nextPolicies[serviceId] = defaultRestartPolicyForService(serviceId)
      }
    } else {
      nextEnabled.delete(serviceId)
      nextAutostart.delete(serviceId)
    }

    await persistServiceRegistry(
      {
        enabledServices: Array.from(nextEnabled).sort(),
        autostartServices: Array.from(nextAutostart).sort(),
        restartPolicies: nextPolicies,
      },
      serviceId
    )
  }

  async function toggleServiceAutostart(serviceId: string, enabled: boolean) {
    if (!serviceRegistry) return

    const nextAutostart = new Set(serviceRegistry.autostartServices)
    if (enabled) {
      nextAutostart.add(serviceId)
    } else {
      nextAutostart.delete(serviceId)
    }

    await persistServiceRegistry(
      {
        ...serviceRegistry,
        autostartServices: Array.from(nextAutostart).sort(),
      },
      serviceId
    )
  }

  async function toggleServiceRestartOnCrash(serviceId: string, enabled: boolean) {
    if (!serviceRegistry) return

    const currentPolicy = serviceRegistry.restartPolicies[serviceId] ?? defaultRestartPolicyForService(serviceId)
    const nextPolicies = {
      ...serviceRegistry.restartPolicies,
      [serviceId]: {
        ...currentPolicy,
        enabled,
      },
    }

    await persistServiceRegistry(
      {
        ...serviceRegistry,
        restartPolicies: nextPolicies,
      },
      serviceId
    )
  }

  async function setServiceRestartMaxAttempts(serviceId: string, maxAttempts: number | undefined) {
    if (!serviceRegistry) return

    const currentPolicy = serviceRegistry.restartPolicies[serviceId] ?? defaultRestartPolicyForService(serviceId)
    const nextPolicies = {
      ...serviceRegistry.restartPolicies,
      [serviceId]: {
        ...currentPolicy,
        maxAttempts,
      },
    }

    await persistServiceRegistry(
      {
        ...serviceRegistry,
        restartPolicies: nextPolicies,
      },
      serviceId
    )
  }

  const backendService = services.find((service) => service.id === 'connector-backend')
  const autostartServices = services.filter((service) => service.autostart)
  const autostartRunningCount = autostartServices.filter((service) => service.running).length
  const stoppedAutostartServices = autostartServices.filter((service) => !service.running)
  const latestImportantEvent = events.find((event) => event.level === 'error' || event.level === 'warn')

  return (
    <div className="mx-auto mt-6 max-w-5xl space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-white">Desktop Runtime Settings</h1>
        <div className="flex gap-2">
          <button
            className="rounded bg-orange-500/80 px-3 py-1 text-xs font-medium text-white hover:bg-orange-500"
            onClick={runSetupAgain}
            type="button"
          >
            Run Setup Again
          </button>
          <button
            className="rounded bg-white/15 px-3 py-1 text-xs font-medium text-white"
            onClick={() => {
              void refresh()
            }}
            type="button"
          >
            Refresh
          </button>
          <button
            className="rounded bg-white/15 px-3 py-1 text-xs font-medium text-white"
            onClick={() => {
              window.location.hash = '/agents'
            }}
            type="button"
          >
            Back
          </button>
        </div>
      </div>

      <div className="rounded border border-white/10 bg-black/50 p-3 text-sm text-white/80">
        <h2 className="mb-3 text-sm font-medium text-white">Runtime Health</h2>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <p>Vault: {detectedVaultPath ?? 'Not detected'}</p>
          <p>Backend mode: {settings.backendMode === 'managed' ? 'Managed' : 'Attach Existing'}</p>
          <p>Autostart services: {autostartRunningCount}/{autostartServices.length} running</p>
          <p>
            Backend:
            {' '}
            {backendService?.running
              ? backendService.managedExternally
                ? 'Connected (external)'
                : 'Running'
              : 'Stopped'}
          </p>
          <p>Network: {bootstrap?.usesIsolatedPorts ? 'Isolated ports' : 'Default ports'}</p>
          <p>Port conflict: {bootstrap?.portConflictDetected ? 'Detected' : 'None'}</p>
        </div>
        {latestImportantEvent && (
          <p className="mt-3 rounded border border-white/10 bg-black/40 px-2 py-1 text-xs text-yellow-200">
            Latest warning: [{new Date(latestImportantEvent.timestampMs).toLocaleTimeString()}]{' '}
            {latestImportantEvent.serviceId}: {latestImportantEvent.message}
          </p>
        )}
      </div>

      {(Boolean(stoppedAutostartServices.length > 0) ||
        Boolean(
          settings.backendMode === 'attachExisting' && bootstrap?.attachToExistingBackend && !backendService?.running
        )) && (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100">
          <h2 className="mb-2 text-sm font-medium text-amber-100">Action Items</h2>
          <div className="flex flex-wrap gap-2">
            {stoppedAutostartServices.length > 0 && (
              <button
                className="rounded bg-amber-500/30 px-3 py-1 text-xs font-medium text-amber-50 disabled:opacity-50"
                disabled={loadingAutostart}
                onClick={() => {
                  void startAutostart()
                }}
                type="button"
              >
                Start Autostart Services
              </button>
            )}
            {settings.backendMode === 'attachExisting' && bootstrap?.attachToExistingBackend && !backendService?.running && (
              <button
                className="rounded bg-amber-500/30 px-3 py-1 text-xs font-medium text-amber-50 disabled:opacity-50"
                disabled={loadingSettings}
                onClick={() => {
                  void switchToManagedAndStart()
                }}
                type="button"
              >
                Switch To Managed + Start
              </button>
            )}
          </div>
        </div>
      )}

      <div className="rounded border border-white/10 bg-black/50 p-3 text-sm text-white/80">
        <div className="space-y-2">
          <label className="flex items-center justify-between gap-2">
            <span>Auto-start services on app launch</span>
            <input
              checked={settings.autoStartServicesOnLaunch}
              disabled={loadingSettings}
              onChange={(event) => {
                void toggleAutoStartServicesOnLaunch(event.target.checked)
              }}
              type="checkbox"
            />
          </label>
          <label className="flex items-center justify-between gap-2">
            <span>Launch at login (headless)</span>
            <input
              checked={settings.launchAtLoginEnabled}
              disabled={loadingSettings}
              onChange={(event) => {
                void toggleLaunchAtLogin(event.target.checked)
              }}
              type="checkbox"
            />
          </label>
          <label className="flex items-center justify-between gap-2">
            <span>Backend mode</span>
            <select
              className="rounded border border-white/20 bg-black px-2 py-1 text-white"
              disabled={loadingSettings}
              onChange={(event) => {
                const nextMode = event.target.value === 'attachExisting' ? 'attachExisting' : 'managed'
                void setBackendMode(nextMode)
              }}
              value={settings.backendMode}
            >
              <option value="managed">Managed (Codos starts backend)</option>
              <option value="attachExisting">Attach Existing (use running backend)</option>
            </select>
          </label>
          <button
            className="rounded bg-white/15 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
            disabled={loadingAutostart}
            onClick={() => {
              void startAutostart()
            }}
            type="button"
          >
            Start All Autostart Services
          </button>
        </div>
      </div>

      <div className="rounded border border-white/10 bg-black/50 p-3 text-sm text-white/80">
        <h2 className="mb-2 text-sm font-medium text-white">Vault Path</h2>
        <p className="text-xs text-white/60">
          {detectedVaultPath ?? 'Not detected — configure via ~/.codos/paths.json'}
        </p>
      </div>

      {bootstrap && (
        <div className="rounded border border-white/10 bg-black/50 p-3 text-xs text-white/80">
          <h2 className="mb-2 text-sm font-medium text-white">Runtime Network</h2>
          <div className="grid grid-cols-2 gap-2">
            <p>Backend URL: {bootstrap.backendBaseUrl}</p>
            <p>Backend WS: {bootstrap.backendWsUrl}</p>
            <p>Backend port: {bootstrap.backendPort}</p>
            <p>Telegram port: {bootstrap.telegramAgentPort}</p>
            <p>Isolated ports: {bootstrap.usesIsolatedPorts ? 'yes' : 'no'}</p>
            <p>Port conflict detected: {bootstrap.portConflictDetected ? 'yes' : 'no'}</p>
            <p>Attach existing backend: {bootstrap.attachToExistingBackend ? 'yes' : 'no'}</p>
          </div>
        </div>
      )}

      <div className="rounded border border-white/10 bg-black/50 p-3 text-sm text-white/80">
        <h2 className="mb-2 text-sm font-medium text-white">Managed Services Registry</h2>
        <div className="space-y-2">
          {serviceCatalog.map((entry) => {
            const enabled = serviceRegistry?.enabledServices.includes(entry.id) ?? false
            const autostart = serviceRegistry?.autostartServices.includes(entry.id) ?? false
            const policy = serviceRegistry?.restartPolicies[entry.id] ?? defaultRestartPolicyForService(entry.id)
            const isBusy = loadingRegistryId === entry.id

            return (
              <div key={entry.id} className="rounded border border-white/10 bg-black/40 p-2 text-xs">
                <div className="mb-2 flex items-center justify-between">
                  <div>
                    <p className="font-medium text-white">{entry.name}</p>
                    <p className="text-white/60">{entry.id}</p>
                  </div>
                  <p className="text-white/60">{entry.cwdRelative}</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex items-center justify-between gap-2">
                    <span>Enabled</span>
                    <input
                      checked={enabled}
                      disabled={isBusy}
                      onChange={(event) => {
                        void toggleServiceEnabled(entry.id, event.target.checked)
                      }}
                      type="checkbox"
                    />
                  </label>
                  <label className="flex items-center justify-between gap-2">
                    <span>Autostart</span>
                    <input
                      checked={autostart}
                      disabled={isBusy || !enabled}
                      onChange={(event) => {
                        void toggleServiceAutostart(entry.id, event.target.checked)
                      }}
                      type="checkbox"
                    />
                  </label>
                  <label className="flex items-center justify-between gap-2">
                    <span>Restart on crash</span>
                    <input
                      checked={policy.enabled}
                      disabled={isBusy || !enabled}
                      onChange={(event) => {
                        void toggleServiceRestartOnCrash(entry.id, event.target.checked)
                      }}
                      type="checkbox"
                    />
                  </label>
                  <label className="flex items-center justify-between gap-2">
                    <span>Max restart attempts</span>
                    <select
                      className="rounded border border-white/20 bg-black px-2 py-1 text-white"
                      disabled={isBusy || !enabled || !policy.enabled}
                      onChange={(event) => {
                        const value = event.target.value
                        void setServiceRestartMaxAttempts(
                          entry.id,
                          value === 'unlimited' ? undefined : Number.parseInt(value, 10)
                        )
                      }}
                      value={typeof policy.maxAttempts === 'number' ? String(policy.maxAttempts) : 'unlimited'}
                    >
                      <option value="unlimited">Unlimited</option>
                      <option value="1">1</option>
                      <option value="3">3</option>
                      <option value="5">5</option>
                      <option value="10">10</option>
                    </select>
                  </label>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="space-y-2">
        {services.map((service) => {
          const isBusy = loadingServiceId === service.id
          return (
            <div key={service.id} className="rounded border border-white/10 bg-black/50 p-3 text-sm text-white/80">
              <div className="mb-2 flex items-center justify-between">
                <p className="font-medium text-white">{service.name}</p>
                <p className={service.running ? 'text-green-400' : 'text-red-400'}>
                  {service.running ? 'Running' : 'Stopped'}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <p>ID: {service.id}</p>
                <p>PID: {service.pid ?? 'n/a'}</p>
                <p>Autostart: {service.autostart ? 'yes' : 'no'}</p>
                <p>
                  Restart policy:{' '}
                  {service.restartOnCrash
                    ? typeof service.maxRestartAttempts === 'number'
                      ? `on (max ${service.maxRestartAttempts})`
                      : 'on (unlimited)'
                    : 'off'}
                </p>
                <p>Restart attempts: {service.restartAttempts}</p>
                <p>Next retry: {formatTime(service.nextRestartAtMs)}</p>
                <p className="col-span-2 truncate">Log: {service.logPath ?? 'n/a'}</p>
                {service.lastError && <p className="col-span-2 text-red-300">Last error: {service.lastError}</p>}
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  className="rounded bg-green-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                  disabled={isBusy || service.running}
                  onClick={() => {
                    void startService(service.id)
                  }}
                  type="button"
                >
                  Start
                </button>
                <button
                  className="rounded bg-red-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                  disabled={isBusy || !service.running}
                  onClick={() => {
                    void stopService(service.id)
                  }}
                  type="button"
                >
                  Stop
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <div className="rounded border border-white/10 bg-black/50 p-3 text-xs text-white/80">
        <h2 className="mb-2 text-sm font-medium text-white">Service Events</h2>
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {events.length === 0 && <p>No events yet.</p>}
          {events.map((event) => (
            <p key={`${event.timestampMs}-${event.serviceId}-${event.message}`}>
              [{new Date(event.timestampMs).toLocaleString()}] {event.serviceId} ({event.level}):{' '}
              {event.message}
            </p>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-red-300">{error}</p>}
    </div>
  )
}
