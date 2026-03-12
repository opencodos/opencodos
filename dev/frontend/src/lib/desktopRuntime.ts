export interface DesktopServiceStatus {
  id: string
  name: string
  autostart: boolean
  restartOnCrash: boolean
  maxRestartAttempts?: number
  restartAttempts: number
  nextRestartAtMs?: number
  running: boolean
  pid?: number
  startedAtMs?: number
  logPath?: string
  lastError?: string
  managedExternally?: boolean
}

export type DesktopBackendStatus = DesktopServiceStatus

export interface DesktopRuntimeSettings {
  autoStartServicesOnLaunch: boolean
  launchAtLoginEnabled: boolean
  backendMode: 'managed' | 'attachExisting'
}

export interface DesktopRuntimeSettingsPatch {
  autoStartServicesOnLaunch?: boolean
  launchAtLoginEnabled?: boolean
  backendMode?: 'managed' | 'attachExisting'
}

export interface DesktopServiceRestartPolicyConfig {
  enabled: boolean
  maxAttempts?: number
}

export interface DesktopServiceRegistryConfig {
  enabledServices: string[]
  autostartServices: string[]
  restartPolicies: Record<string, DesktopServiceRestartPolicyConfig>
}

export interface DesktopServiceCatalogEntry {
  id: string
  name: string
  cwdRelative: string
  defaultAutostart: boolean
  defaultRestartOnCrash: boolean
  defaultMaxRestartAttempts?: number
}

export interface DesktopServiceEvent {
  timestampMs: number
  serviceId: string
  level: string
  message: string
}

export interface DesktopVaultPathValidation {
  path: string
  exists: boolean
  isDirectory: boolean
  readable: boolean
  writable: boolean
  valid: boolean
  message: string
}

export interface DesktopRuntimeBootstrapStatus {
  backendBaseUrl: string
  backendWsUrl: string
  backendPort: number
  telegramAgentPort: number
  usesIsolatedPorts: boolean
  portConflictDetected: boolean
  attachToExistingBackend: boolean
  atlasApiKey: string
}

type TauriInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>

type TauriInternals = {
  invoke: TauriInvoke
}

type DesktopWindow = Window & {
  __TAURI_INTERNALS__?: TauriInternals
}

function getInvoke(): TauriInvoke | null {
  const desktopWindow = window as DesktopWindow
  return desktopWindow.__TAURI_INTERNALS__?.invoke ?? null
}

function normalizeServiceStatus(raw: unknown): DesktopServiceStatus {
  if (!raw || typeof raw !== 'object') {
    return {
      id: 'unknown',
      name: 'Unknown',
      autostart: false,
      restartOnCrash: false,
      restartAttempts: 0,
      running: false,
    }
  }

  const status = raw as Record<string, unknown>

  const startedAtMs =
    typeof status.startedAtMs === 'number'
      ? status.startedAtMs
      : typeof status.started_at_ms === 'number'
        ? status.started_at_ms
        : undefined

  const logPath =
    typeof status.logPath === 'string'
      ? status.logPath
      : typeof status.log_path === 'string'
        ? status.log_path
        : undefined

  const lastError =
    typeof status.lastError === 'string'
      ? status.lastError
      : typeof status.last_error === 'string'
        ? status.last_error
        : undefined

  return {
    id: typeof status.id === 'string' ? status.id : 'unknown',
    name: typeof status.name === 'string' ? status.name : 'Unknown',
    autostart: Boolean(status.autostart),
    restartOnCrash:
      typeof status.restartOnCrash === 'boolean'
        ? status.restartOnCrash
        : typeof status.restart_on_crash === 'boolean'
          ? status.restart_on_crash
          : false,
    maxRestartAttempts:
      typeof status.maxRestartAttempts === 'number'
        ? status.maxRestartAttempts
        : typeof status.max_restart_attempts === 'number'
          ? status.max_restart_attempts
          : undefined,
    restartAttempts:
      typeof status.restartAttempts === 'number'
        ? status.restartAttempts
        : typeof status.restart_attempts === 'number'
          ? status.restart_attempts
          : 0,
    nextRestartAtMs:
      typeof status.nextRestartAtMs === 'number'
        ? status.nextRestartAtMs
        : typeof status.next_restart_at_ms === 'number'
          ? status.next_restart_at_ms
          : undefined,
    running: Boolean(status.running),
    pid: typeof status.pid === 'number' ? status.pid : undefined,
    startedAtMs,
    logPath,
    lastError,
    managedExternally:
      typeof status.managedExternally === 'boolean'
        ? status.managedExternally
        : typeof status.managed_externally === 'boolean'
          ? status.managed_externally
          : false,
  }
}

function normalizeServiceList(raw: unknown): DesktopServiceStatus[] {
  if (!Array.isArray(raw)) {
    return []
  }

  return raw.map(normalizeServiceStatus)
}

async function invokeCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const invoke = getInvoke()
  if (!invoke) {
    throw new Error('Desktop runtime not available in browser mode')
  }

  return (await invoke(command, args)) as T
}

function findBackendService(services: DesktopServiceStatus[]): DesktopBackendStatus {
  const backend = services.find((service) => service.id === 'gateway-backend')
  if (!backend) {
    return {
      id: 'gateway-backend',
      name: 'Gateway Backend',
      autostart: true,
      restartOnCrash: true,
      restartAttempts: 0,
      running: false,
    }
  }

  return backend
}

export function isDesktopRuntimeAvailable(): boolean {
  return Boolean(getInvoke())
}

export async function getDesktopServices(): Promise<DesktopServiceStatus[]> {
  const response = await invokeCommand<unknown>('list_services')
  return normalizeServiceList(response)
}

export async function startDesktopService(serviceId: string): Promise<DesktopServiceStatus> {
  const response = await invokeCommand<unknown>('start_service', { serviceId })
  return normalizeServiceStatus(response)
}

export async function stopDesktopService(serviceId: string): Promise<DesktopServiceStatus> {
  const response = await invokeCommand<unknown>('stop_service', { serviceId })
  return normalizeServiceStatus(response)
}

export async function startDesktopAutostartServices(): Promise<DesktopServiceStatus[]> {
  const response = await invokeCommand<unknown>('start_autostart_services')
  return normalizeServiceList(response)
}

export async function getDesktopBackendStatus(): Promise<DesktopBackendStatus> {
  const services = await getDesktopServices()
  return findBackendService(services)
}

export async function startDesktopBackend(): Promise<DesktopBackendStatus> {
  return startDesktopService('gateway-backend')
}

export async function stopDesktopBackend(): Promise<DesktopBackendStatus> {
  return stopDesktopService('gateway-backend')
}

export async function showDesktopMainWindow(): Promise<void> {
  await invokeCommand('show_main_window')
}

function normalizeServiceEvent(raw: unknown): DesktopServiceEvent {
  if (!raw || typeof raw !== 'object') {
    return {
      timestampMs: 0,
      serviceId: 'unknown',
      level: 'info',
      message: '',
    }
  }

  const event = raw as Record<string, unknown>
  return {
    timestampMs:
      typeof event.timestampMs === 'number'
        ? event.timestampMs
        : typeof event.timestamp_ms === 'number'
          ? event.timestamp_ms
          : 0,
    serviceId:
      typeof event.serviceId === 'string'
        ? event.serviceId
        : typeof event.service_id === 'string'
          ? event.service_id
          : 'unknown',
    level: typeof event.level === 'string' ? event.level : 'info',
    message: typeof event.message === 'string' ? event.message : '',
  }
}

function normalizeServiceEvents(raw: unknown): DesktopServiceEvent[] {
  if (!Array.isArray(raw)) {
    return []
  }
  return raw.map(normalizeServiceEvent)
}

function normalizeRuntimeSettings(raw: unknown): DesktopRuntimeSettings {
  if (!raw || typeof raw !== 'object') {
    return {
      autoStartServicesOnLaunch: true,
      launchAtLoginEnabled: true,
      backendMode: 'managed',
    }
  }

  const settings = raw as Record<string, unknown>
  return {
    autoStartServicesOnLaunch:
      typeof settings.autoStartServicesOnLaunch === 'boolean'
        ? settings.autoStartServicesOnLaunch
        : typeof settings.auto_start_services_on_launch === 'boolean'
          ? settings.auto_start_services_on_launch
          : true,
    launchAtLoginEnabled:
      typeof settings.launchAtLoginEnabled === 'boolean'
        ? settings.launchAtLoginEnabled
        : typeof settings.launch_at_login_enabled === 'boolean'
          ? settings.launch_at_login_enabled
          : true,
    backendMode:
      settings.backendMode === 'attachExisting' || settings.backend_mode === 'attachExisting'
        ? 'attachExisting'
        : settings.backendMode === 'managed' || settings.backend_mode === 'managed'
          ? 'managed'
          : 'managed',
  }
}

function normalizeRuntimeBootstrapStatus(raw: unknown): DesktopRuntimeBootstrapStatus {
  if (!raw || typeof raw !== 'object') {
    return {
      backendBaseUrl: 'http://127.0.0.1:8767',
      backendWsUrl: 'ws://127.0.0.1:8767',
      backendPort: 8767,
      telegramAgentPort: 8768,
      usesIsolatedPorts: false,
      portConflictDetected: false,
      attachToExistingBackend: false,
      atlasApiKey: '',
    }
  }

  const value = raw as Record<string, unknown>
  return {
    backendBaseUrl:
      typeof value.backendBaseUrl === 'string'
        ? value.backendBaseUrl
        : typeof value.backend_base_url === 'string'
          ? value.backend_base_url
          : 'http://127.0.0.1:8767',
    backendWsUrl:
      typeof value.backendWsUrl === 'string'
        ? value.backendWsUrl
        : typeof value.backend_ws_url === 'string'
          ? value.backend_ws_url
          : 'ws://127.0.0.1:8767',
    backendPort:
      typeof value.backendPort === 'number'
        ? value.backendPort
        : typeof value.backend_port === 'number'
          ? value.backend_port
          : 8767,
    telegramAgentPort:
      typeof value.telegramAgentPort === 'number'
        ? value.telegramAgentPort
        : typeof value.telegram_agent_port === 'number'
          ? value.telegram_agent_port
          : 8768,
    usesIsolatedPorts:
      typeof value.usesIsolatedPorts === 'boolean'
        ? value.usesIsolatedPorts
        : typeof value.uses_isolated_ports === 'boolean'
          ? value.uses_isolated_ports
          : false,
    portConflictDetected:
      typeof value.portConflictDetected === 'boolean'
        ? value.portConflictDetected
        : typeof value.port_conflict_detected === 'boolean'
          ? value.port_conflict_detected
          : false,
    attachToExistingBackend:
      typeof value.attachToExistingBackend === 'boolean'
        ? value.attachToExistingBackend
        : typeof value.attach_to_existing_backend === 'boolean'
          ? value.attach_to_existing_backend
          : false,
    atlasApiKey:
      typeof value.atlasApiKey === 'string'
        ? value.atlasApiKey
        : typeof value.atlas_api_key === 'string'
          ? value.atlas_api_key
          : '',
  }
}

function normalizeVaultPathValidation(raw: unknown): DesktopVaultPathValidation {
  if (!raw || typeof raw !== 'object') {
    return {
      path: '',
      exists: false,
      isDirectory: false,
      readable: false,
      writable: false,
      valid: false,
      message: 'Vault validation failed',
    }
  }

  const result = raw as Record<string, unknown>
  return {
    path: typeof result.path === 'string' ? result.path : '',
    exists: Boolean(result.exists),
    isDirectory:
      typeof result.isDirectory === 'boolean'
        ? result.isDirectory
        : typeof result.is_directory === 'boolean'
          ? result.is_directory
          : false,
    readable: Boolean(result.readable),
    writable: Boolean(result.writable),
    valid: Boolean(result.valid),
    message: typeof result.message === 'string' ? result.message : 'Vault validation failed',
  }
}

function normalizeServiceRestartPolicy(raw: unknown): DesktopServiceRestartPolicyConfig {
  if (!raw || typeof raw !== 'object') {
    return { enabled: false }
  }
  const policy = raw as Record<string, unknown>
  return {
    enabled: Boolean(policy.enabled),
    maxAttempts:
      typeof policy.maxAttempts === 'number'
        ? policy.maxAttempts
        : typeof policy.max_attempts === 'number'
          ? policy.max_attempts
          : undefined,
  }
}

function normalizeServiceRegistry(raw: unknown): DesktopServiceRegistryConfig {
  if (!raw || typeof raw !== 'object') {
    return {
      enabledServices: [],
      autostartServices: [],
      restartPolicies: {},
    }
  }

  const registry = raw as Record<string, unknown>
  const enabledServicesRaw =
    (Array.isArray(registry.enabledServices) ? registry.enabledServices : undefined) ??
    (Array.isArray(registry.enabled_services) ? registry.enabled_services : [])
  const autostartServicesRaw =
    (Array.isArray(registry.autostartServices) ? registry.autostartServices : undefined) ??
    (Array.isArray(registry.autostart_services) ? registry.autostart_services : [])

  const enabledServices = enabledServicesRaw.filter((item): item is string => typeof item === 'string')
  const autostartServices = autostartServicesRaw.filter((item): item is string => typeof item === 'string')

  const restartPolicies: Record<string, DesktopServiceRestartPolicyConfig> = {}
  const rawPolicies =
    (registry.restartPolicies as Record<string, unknown> | undefined) ??
    (registry.restart_policies as Record<string, unknown> | undefined) ??
    {}
  for (const [serviceId, policy] of Object.entries(rawPolicies)) {
    restartPolicies[serviceId] = normalizeServiceRestartPolicy(policy)
  }

  return {
    enabledServices,
    autostartServices,
    restartPolicies,
  }
}

function normalizeServiceCatalogEntry(raw: unknown): DesktopServiceCatalogEntry {
  if (!raw || typeof raw !== 'object') {
    return {
      id: 'unknown',
      name: 'Unknown',
      cwdRelative: '.',
      defaultAutostart: false,
      defaultRestartOnCrash: false,
    }
  }
  const entry = raw as Record<string, unknown>
  return {
    id: typeof entry.id === 'string' ? entry.id : 'unknown',
    name: typeof entry.name === 'string' ? entry.name : 'Unknown',
    cwdRelative:
      typeof entry.cwdRelative === 'string'
        ? entry.cwdRelative
        : typeof entry.cwd_relative === 'string'
          ? entry.cwd_relative
          : '.',
    defaultAutostart:
      typeof entry.defaultAutostart === 'boolean'
        ? entry.defaultAutostart
        : typeof entry.default_autostart === 'boolean'
          ? entry.default_autostart
          : false,
    defaultRestartOnCrash:
      typeof entry.defaultRestartOnCrash === 'boolean'
        ? entry.defaultRestartOnCrash
        : typeof entry.default_restart_on_crash === 'boolean'
          ? entry.default_restart_on_crash
          : false,
    defaultMaxRestartAttempts:
      typeof entry.defaultMaxRestartAttempts === 'number'
        ? entry.defaultMaxRestartAttempts
        : typeof entry.default_max_restart_attempts === 'number'
          ? entry.default_max_restart_attempts
          : undefined,
  }
}

function normalizeServiceCatalog(raw: unknown): DesktopServiceCatalogEntry[] {
  if (!Array.isArray(raw)) {
    return []
  }
  return raw.map(normalizeServiceCatalogEntry)
}

export async function getDesktopRuntimeSettings(): Promise<DesktopRuntimeSettings> {
  const response = await invokeCommand<unknown>('get_runtime_settings')
  return normalizeRuntimeSettings(response)
}

export async function updateDesktopRuntimeSettings(
  patch: DesktopRuntimeSettingsPatch
): Promise<DesktopRuntimeSettings> {
  const response = await invokeCommand<unknown>('update_runtime_settings', { patch })
  return normalizeRuntimeSettings(response)
}

export async function getDesktopServiceEvents(limit = 50): Promise<DesktopServiceEvent[]> {
  const response = await invokeCommand<unknown>('get_service_events', { limit })
  return normalizeServiceEvents(response)
}

export async function getDesktopDefaultVaultPath(): Promise<string | null> {
  const response = await invokeCommand<unknown>('get_default_vault_path')
  if (typeof response === 'string' && response.trim()) {
    return response
  }
  return null
}

export async function validateDesktopVaultPath(path: string): Promise<DesktopVaultPathValidation> {
  const response = await invokeCommand<unknown>('validate_vault_path', { path })
  return normalizeVaultPathValidation(response)
}

export async function getDesktopServiceRegistry(): Promise<DesktopServiceRegistryConfig> {
  const response = await invokeCommand<unknown>('get_service_registry')
  return normalizeServiceRegistry(response)
}

export async function getDesktopServiceCatalog(): Promise<DesktopServiceCatalogEntry[]> {
  const response = await invokeCommand<unknown>('get_service_catalog')
  return normalizeServiceCatalog(response)
}

export async function updateDesktopServiceRegistry(
  registry: DesktopServiceRegistryConfig
): Promise<DesktopServiceRegistryConfig> {
  const response = await invokeCommand<unknown>('update_service_registry', { registry })
  return normalizeServiceRegistry(response)
}

export async function getDesktopRuntimeBootstrapStatus(): Promise<DesktopRuntimeBootstrapStatus> {
  const response = await invokeCommand<unknown>('get_runtime_bootstrap_status')
  return normalizeRuntimeBootstrapStatus(response)
}

export async function openExternalUrl(url: string): Promise<void> {
  // Route through the backend HTTP server instead of Tauri IPC.
  // WKWebView drops POST body for custom URL schemes (ipc://),
  // which breaks all invoke() calls with arguments in production builds.
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8767'
  const response = await fetch(`${apiBaseUrl}/api/util/open-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  })
  if (!response.ok) {
    throw new Error('Failed to open URL')
  }
}
