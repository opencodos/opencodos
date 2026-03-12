import { useCallback, useEffect, useState } from 'react'
import {
  getDesktopRuntimeSettings,
  getDesktopServiceEvents,
  getDesktopServices,
  isDesktopRuntimeAvailable,
  showDesktopMainWindow,
  startDesktopAutostartServices,
  startDesktopService,
  stopDesktopService,
  updateDesktopRuntimeSettings,
  type DesktopRuntimeSettings,
  type DesktopServiceEvent,
  type DesktopServiceStatus,
} from '@/lib/desktopRuntime'

function formatStartedAt(timestampMs?: number): string {
  if (!timestampMs) {
    return 'unknown'
  }

  const date = new Date(timestampMs)
  if (Number.isNaN(date.getTime())) {
    return 'unknown'
  }

  return date.toLocaleTimeString()
}

export function DesktopRuntimePanel() {
  const [services, setServices] = useState<DesktopServiceStatus[]>([])
  const [events, setEvents] = useState<DesktopServiceEvent[]>([])
  const [loadingServiceId, setLoadingServiceId] = useState<string | null>(null)
  const [loadingAutostart, setLoadingAutostart] = useState(false)
  const [loadingSettings, setLoadingSettings] = useState(false)
  const [settings, setSettings] = useState<DesktopRuntimeSettings>({
    autoStartServicesOnLaunch: true,
    launchAtLoginEnabled: true,
    backendMode: 'managed',
  })
  const [error, setError] = useState<string | null>(null)

  const refreshServices = useCallback(async () => {
    try {
      const nextServices = await getDesktopServices()
      const nextSettings = await getDesktopRuntimeSettings()
      const nextEvents = await getDesktopServiceEvents(8)
      setServices(nextServices)
      setSettings(nextSettings)
      setEvents(nextEvents)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch service status')
    }
  }, [])

  useEffect(() => {
    if (!isDesktopRuntimeAvailable()) {
      return
    }

    void refreshServices()
    const intervalId = window.setInterval(() => {
      void refreshServices()
    }, 5000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [refreshServices])

  if (!isDesktopRuntimeAvailable()) {
    return null
  }

  async function startService(serviceId: string) {
    setLoadingServiceId(serviceId)
    try {
      await startDesktopService(serviceId)
      await refreshServices()
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
      await refreshServices()
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to stop ${serviceId}`)
    } finally {
      setLoadingServiceId(null)
    }
  }

  async function startAutostartServices() {
    setLoadingAutostart(true)
    try {
      await startDesktopAutostartServices()
      await refreshServices()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start autostart services')
    } finally {
      setLoadingAutostart(false)
    }
  }

  async function toggleAutoStartServicesOnLaunch(enabled: boolean) {
    setLoadingSettings(true)
    try {
      const nextSettings = await updateDesktopRuntimeSettings({
        autoStartServicesOnLaunch: enabled,
      })
      setSettings(nextSettings)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update auto-start setting')
    } finally {
      setLoadingSettings(false)
    }
  }

  async function toggleLaunchAtLogin(enabled: boolean) {
    setLoadingSettings(true)
    try {
      const nextSettings = await updateDesktopRuntimeSettings({
        launchAtLoginEnabled: enabled,
      })
      setSettings(nextSettings)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update launch-at-login setting')
    } finally {
      setLoadingSettings(false)
    }
  }

  const runningCount = services.filter((service) => service.running).length

  return (
    <div className="fixed right-4 top-4 z-50 w-96 rounded-lg border border-white/20 bg-black/85 p-3 text-xs shadow-lg backdrop-blur">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-semibold text-white">Desktop Runtime</p>
        <span className="text-white/70">
          {runningCount}/{services.length} running
        </span>
      </div>

      <div className="mb-3 flex gap-2">
        <button
          className="rounded bg-white/15 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50"
          disabled={loadingAutostart}
          onClick={() => {
            void startAutostartServices()
          }}
          type="button"
        >
          Start Autostart
        </button>
        <button
          className="rounded bg-white/15 px-2 py-1 text-[11px] font-medium text-white"
          onClick={() => {
            void refreshServices()
          }}
          type="button"
        >
          Refresh
        </button>
        <button
          className="rounded bg-white/15 px-2 py-1 text-[11px] font-medium text-white"
          onClick={() => {
            void showDesktopMainWindow()
          }}
          type="button"
        >
          Show Window
        </button>
        <button
          className="rounded bg-white/15 px-2 py-1 text-[11px] font-medium text-white"
          onClick={() => {
            window.location.hash = '/desktop-settings'
          }}
          type="button"
        >
          Settings
        </button>
      </div>

      <div className="mb-3 space-y-1 rounded border border-white/10 bg-white/5 p-2 text-[11px] text-white/80">
        <label className="flex items-center justify-between gap-2">
          <span>Auto-start services on launch</span>
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
      </div>

      <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
        {services.map((service) => {
          const isBusy = loadingServiceId === service.id
          const statusColor = service.running ? 'text-green-400' : 'text-red-400'

          return (
            <div key={service.id} className="rounded border border-white/10 bg-white/5 p-2">
              <div className="mb-1 flex items-center justify-between">
                <p className="text-[12px] font-medium text-white">{service.name}</p>
                <span className={statusColor}>{service.running ? 'Running' : 'Stopped'}</span>
              </div>

              <div className="space-y-0.5 text-[11px] text-white/70">
                <p>ID: {service.id}</p>
                <p>PID: {service.pid ?? 'n/a'}</p>
                <p>Started: {formatStartedAt(service.startedAtMs)}</p>
                <p className="truncate">Log: {service.logPath ?? 'n/a'}</p>
                <p>Autostart: {service.autostart ? 'yes' : 'no'}</p>
                <p>
                  Restart on crash: {service.restartOnCrash ? 'yes' : 'no'}
                  {typeof service.maxRestartAttempts === 'number'
                    ? ` (max ${service.maxRestartAttempts})`
                    : ' (unlimited)'}
                </p>
                <p>Restart attempts: {service.restartAttempts}</p>
                {service.lastError && <p className="text-red-300">Error: {service.lastError}</p>}
              </div>

              <div className="mt-2 flex gap-2">
                <button
                  className="rounded bg-green-600 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50"
                  disabled={isBusy || service.running}
                  onClick={() => {
                    void startService(service.id)
                  }}
                  type="button"
                >
                  Start
                </button>
                <button
                  className="rounded bg-red-600 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50"
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

      <div className="mt-3 max-h-24 space-y-1 overflow-y-auto rounded border border-white/10 bg-white/5 p-2 text-[10px] text-white/70">
        {events.length === 0 && <p>No recent runtime events.</p>}
        {events.map((event) => (
          <p key={`${event.timestampMs}-${event.serviceId}-${event.message}`}>
            [{new Date(event.timestampMs).toLocaleTimeString()}] {event.serviceId} ({event.level}): {event.message}
          </p>
        ))}
      </div>

      {error && <p className="mt-2 text-[11px] text-red-300">{error}</p>}
    </div>
  )
}
