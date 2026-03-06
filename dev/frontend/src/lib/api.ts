import type {
  Agent,
  ConversationWorkflowConfig,
  SlackWorkflowConfig,
  TelegramFolder,
  Workflow,
  Session,
  SessionDetail,
  SessionListResponse,
  CreateSessionResponse,
  ActivateSessionResponse,
  DeleteSessionResponse,
  ClientMessage,
  ServerMessage,
} from '@/types'

import { getDesktopAtlasApiKey } from '@/lib/desktopRuntimeBootstrap'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8767'
const WS_BASE_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8767'
const authHeaders = (): Record<string, string> => {
  const key = getDesktopAtlasApiKey() || import.meta.env.VITE_ATLAS_API_KEY || ''
  return key ? { 'X-Atlas-Key': key } : {}
}

function withAtlasApiKey(url: string): string {
  const atlasKey = (getDesktopAtlasApiKey() || import.meta.env.VITE_ATLAS_API_KEY || '').trim()
  if (!atlasKey) return url

  try {
    const parsed = new URL(url)
    parsed.searchParams.set('atlas_key', atlasKey)
    return parsed.toString()
  } catch {
    const separator = url.includes('?') ? '&' : '?'
    return `${url}${separator}atlas_key=${encodeURIComponent(atlasKey)}`
  }
}

export type SlackConversation =
  | {
      id: string
      name: string
      type: 'public_channel'
      member_count?: number
    }
  | {
      id: string
      name: string
      type: 'private_channel'
      member_count?: number
    }
  | {
      id: string
      name: string
      type: 'dm'
      member_count?: number
    }

export interface SlackConversationsResponse {
  team_id: string
  public_channels: SlackConversation[]
  private_channels: SlackConversation[]
  dms: SlackConversation[]
}

export type TelegramConversation =
  | {
      id: string
      name: string
      type: 'private'
      member_count?: number
      last_message_date?: string
    }
  | {
      id: string
      name: string
      type: 'group'
      member_count?: number
      last_message_date?: string
    }
  | {
      id: string
      name: string
      type: 'channel'
      member_count?: number
      last_message_date?: string
    }

export interface TelegramConversationsResponse {
  private: TelegramConversation[]
  groups: TelegramConversation[]
  channels: TelegramConversation[]
}

export interface AgentSessionAttachment {
  attachment_id: string
  name: string
  path: string
  mime: string
  size: number
}

export interface Integration {
  service: string
  name: string
  description: string
  icon: string
}

export interface ConnectedIntegration {
  service: string
  account_id: string
  status: string
  connected_at: string
  error?: string | null
}

export const API_ENDPOINTS = {
  integrations: '/api/integrations',
  integrationsConnected: '/api/integrations/connected',
  integrationConnect: (service: string) => `/api/integrations/${service}/connect`,
  integrationDisconnect: (service: string) => `/api/integrations/${service}`,
  integrationDisconnectLegacy: (service: string) => `/api/integrations/${service}/disconnect`,
  integrationStatus: (service: string) => `/api/integrations/${service}/status`,
  slackConversations: '/api/integrations/slack/conversations',
  telegramConversations: '/api/integrations/telegram/conversations',
  telegramFolders: '/telegram/folders',
  syncWorkflows: '/api/integrations/sync-workflows',
  workflows: '/workflows',
  workflow: (id: number) => `/workflows/${id}`,
  telegramAuthInitiate: '/telegram/auth/initiate',
  telegramAuthPoll: (authRequestId: string) => `/telegram/auth/poll/${authRequestId}`,
  telegramAuth2fa: '/telegram/auth/2fa',
  telegramAuthComplete: '/telegram/auth/complete',
  telegramAuthStatus: '/telegram/auth/status',
} as const

const STORAGE_KEYS = {
  connected: 'connector-ui-connected',
  workflows: 'connector-ui-workflows',
  authRequests: 'connector-ui-telegram-auth',
  workflowId: 'connector-ui-workflow-id',
} as const

const AUTH_URLS: Record<string, string> = {
  slack: 'https://example.com/oauth/slack',
  notion: 'https://example.com/oauth/notion',
  linear: 'https://example.com/oauth/linear',
  github: 'https://example.com/oauth/github',
  granola: 'https://example.com/oauth/granola',
}

const DEFAULT_AVAILABLE_INTEGRATIONS: Integration[] = [
  { service: 'slack', name: 'Slack', description: 'Team communication', icon: 'message-square' },
  { service: 'telegram', name: 'Telegram', description: 'Messaging platform', icon: 'send' },
  { service: 'notion', name: 'Notion', description: 'Workspace management', icon: 'book' },
  {
    service: 'google',
    name: 'Google Workspace',
    description: 'Gmail, Calendar, Drive, Docs, Sheets',
    icon: 'google',
  },
  {
    service: 'granola',
    name: 'Granola',
    description: 'Meeting transcription and notes',
    icon: 'mic',
  },
  { service: 'linear', name: 'Linear', description: 'Issue tracking', icon: 'list' },
]

function nowIso(): string {
  return new Date().toISOString()
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function saveJson<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value))
}

function getConnectedMap(): Record<string, ConnectedIntegration> {
  return loadJson<Record<string, ConnectedIntegration>>(STORAGE_KEYS.connected, {})
}

function setConnectedMap(next: Record<string, ConnectedIntegration>) {
  saveJson(STORAGE_KEYS.connected, next)
}

function getWorkflows(): Workflow[] {
  return loadJson<Workflow[]>(STORAGE_KEYS.workflows, [])
}

function setWorkflows(workflows: Workflow[]) {
  saveJson(STORAGE_KEYS.workflows, workflows)
}

function getNextWorkflowId(): number {
  const current = loadJson<number>(STORAGE_KEYS.workflowId, 1)
  saveJson(STORAGE_KEYS.workflowId, current + 1)
  return current
}

export function ensureWorkflow(service: string, config?: Partial<ConversationWorkflowConfig | SlackWorkflowConfig>) {
  const workflows = getWorkflows()
  const name = `${service} ingestion`
  const existing = workflows.find((workflow) => workflow.name.toLowerCase() === name)

  if (existing) {
    if (config) {
      existing.config = { ...(existing.config || {}), ...config }
      existing.updated_at = nowIso()
      setWorkflows([...workflows])
    }
    return existing
  }

  const created: Workflow = {
    id: getNextWorkflowId(),
    name,
    schedule: 3600,
    user_id: 'local-user',
    description: `Sync data from ${service}`,
    config: config ?? {},
    created_at: nowIso(),
    updated_at: nowIso(),
  }

  setWorkflows([...workflows, created])
  return created
}

function updateWorkflowById(
  id: number,
  updater: (workflow: Workflow) => Workflow | null,
): Workflow | null {
  const workflows = getWorkflows()
  const index = workflows.findIndex((workflow) => workflow.id === id)
  if (index === -1) return null

  const updated = updater(workflows[index])
  if (!updated) return null

  workflows[index] = updated
  setWorkflows([...workflows])
  return updated
}

// Mock data removed - now fetching from real backend

export const integrationAPI = {
  async getAvailableIntegrations(): Promise<Integration[]> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/integrations`, {
        headers: authHeaders(),
      })
      if (response.ok) {
        return await response.json() as Integration[]
      }
    } catch (error) {
      console.error('Failed to fetch available integrations:', error)
    }
    return DEFAULT_AVAILABLE_INTEGRATIONS
  },

  async getConnectedIntegrations(): Promise<ConnectedIntegration[]> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/integrations/connected`)
      if (response.ok) {
        const data = await response.json() as ConnectedIntegration[]
        // Update localStorage cache with fresh data
        const newMap: Record<string, ConnectedIntegration> = {}
        for (const item of data) {
          newMap[item.service] = item
        }
        setConnectedMap(newMap)
        return data
      }
    } catch (error) {
      console.error('Failed to fetch connected integrations:', error)
    }
    // Fallback to localStorage if backend unavailable
    return Object.values(getConnectedMap())
  },

  async connectIntegration(service: string): Promise<{ redirect_url: string; connection_id: string }> {
    try {
      const url = `${API_BASE_URL}${API_ENDPOINTS.integrationConnect(service)}`
      let response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      if (response.status === 404) {
        const fallbackUrl = url.replace('/api/integrations/', '/integrations/')
        response = await fetch(fallbackUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (!response.ok) {
        throw new Error(`Connect failed: ${response.status}`)
      }

      const data = await response.json() as { redirect_url?: string; connection_id?: string }
      if (!data.redirect_url) {
        throw new Error('Connect response missing redirect_url')
      }


      return {
        redirect_url: data.redirect_url,
        connection_id: data.connection_id ?? `${service}-connection`,
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Connect failed:')) {
        throw new Error('Connect endpoint is not available on the backend. Configure Composio OAuth and enable /api/integrations/{service}/connect.')
      }

      // Fall back to local stub only if backend is unreachable
      const connected = getConnectedMap()
      if (!connected[service]) {
        connected[service] = {
          service,
          account_id: `${service}-local`,
          status: 'connected',
          connected_at: nowIso(),
        }
        setConnectedMap(connected)
      }

      if (service === 'slack') {
        ensureWorkflow('slack')
      }

      const redirectUrl = AUTH_URLS[service] ?? `https://example.com/oauth/${service}`

      return {
        redirect_url: redirectUrl,
        connection_id: `${service}-connection`,
      }
    }
  },

  async autobindIntegration(service: string): Promise<{ success: boolean; account_id?: string; message?: string }> {
    try {
      const url = `${API_BASE_URL}/api/integrations/${service}/autobind`
      const response = await fetch(url, { method: 'POST' })
      if (!response.ok) {
        return { success: false, message: `Autobind failed: ${response.status}` }
      }
      const data = await response.json() as { success: boolean; account_id?: string; message?: string }
      return data
    } catch (error) {
      return { success: false, message: String(error) }
    }
  },

  async disconnectIntegration(service: string): Promise<{ success: boolean; message: string }> {
    try {
      // All services (including telegram) use the unified backend endpoint
      const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.integrationDisconnect(service)}`, {
        method: 'DELETE',
        headers: authHeaders(),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})) as { detail?: string }
        throw new Error(errorData.detail || `Failed to disconnect: ${response.status}`)
      }

      const data = await response.json() as { success: boolean; message: string }

      // Clear local storage on success
      if (data.success) {
        const connected = getConnectedMap()
        if (connected[service]) {
          delete connected[service]
          setConnectedMap(connected)
        }
      }

      return data
    } catch (error) {
      // If backend fails, still clear local storage as fallback
      const connected = getConnectedMap()
      if (connected[service]) {
        delete connected[service]
        setConnectedMap(connected)
      }

      return {
        success: true,
        message: error instanceof Error ? error.message : `Disconnected ${service}`,
      }
    }
  },

  async getIntegrationStatus(service: string): Promise<{
    connected: boolean
    status: string
    account_id?: string
    connected_at?: string
    error?: string
  }> {
    const connected = getConnectedMap()[service]
    if (!connected) {
      return { connected: false, status: 'disconnected' }
    }

    return {
      connected: true,
      status: connected.status,
      account_id: connected.account_id,
      connected_at: connected.connected_at,
      error: connected.error ?? undefined,
    }
  },

  async listSlackConversations(): Promise<SlackConversationsResponse> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/integrations/slack/conversations`)
      if (!response.ok) {
        throw new Error(`Failed to list Slack conversations: ${response.status}`)
      }
      return await response.json()
    } catch (error) {
      console.error('Failed to fetch Slack conversations:', error)
      // Return empty response on error
      return {
        team_id: '',
        public_channels: [],
        private_channels: [],
        dms: [],
      }
    }
  },

  async getSlackConfig(): Promise<{
    whitelist_ids: string[]
    lookback_days: number
  }> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/integrations/slack/config`)
      if (!response.ok) {
        return { whitelist_ids: [], lookback_days: 7 }
      }
      return await response.json()
    } catch {
      return { whitelist_ids: [], lookback_days: 7 }
    }
  },

  async saveSlackConfig(config: {
    include_conversations: string[]
    lookback_days: number
  }): Promise<{ success: boolean; message?: string }> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/integrations/slack/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})) as { detail?: string }
        return { success: false, message: errorData.detail || `Failed to save config: ${response.status}` }
      }

      return { success: true }
    } catch (error) {
      return { success: false, message: String(error) }
    }
  },

  async listTelegramFolders(): Promise<TelegramFolder[]> {
    try {
      const response = await fetch(`${API_BASE_URL}/telegram/folders`, { headers: authHeaders() })
      if (!response.ok) {
        // Folders endpoint may not exist on older backends
        return []
      }
      return await response.json()
    } catch {
      return []
    }
  },

  async listTelegramConversations(params?: {
    limit?: number
    offset?: number
    folderId?: number
  }): Promise<TelegramConversationsResponse & { has_more?: boolean; total?: number }> {
    const query = new URLSearchParams()
    if (params?.limit) query.set('limit', String(params.limit))
    if (params?.offset) query.set('offset', String(params.offset))
    if (params?.folderId !== undefined) query.set('folder_id', String(params.folderId))

    const queryString = query.toString()
    const url = `${API_BASE_URL}/telegram/conversations${queryString ? `?${queryString}` : ''}`

    const response = await fetch(url, { headers: authHeaders() })
    if (!response.ok) {
      throw new Error(`Failed to list Telegram conversations: ${response.status}`)
    }

    const data = await response.json() as {
      conversations?: Array<{
        id: number | string
        name: string
        type: 'private' | 'group' | 'channel'
        unread_count?: number
        last_message_date?: string
      }>
      has_more?: boolean
      total?: number
    } | Array<{
      id: number | string
      name: string
      type: 'private' | 'group' | 'channel'
      unread_count?: number
    }>

    // Handle both old (array) and new (paginated object) response formats
    const conversations = Array.isArray(data) ? data : (data.conversations ?? [])
    const hasMore = Array.isArray(data) ? false : (data.has_more ?? false)
    const total = Array.isArray(data) ? conversations.length : (data.total ?? conversations.length)

    // Transform flat list to grouped format expected by UI
    const result: TelegramConversationsResponse & { has_more?: boolean; total?: number } = {
      private: [],
      groups: [],
      channels: [],
      has_more: hasMore,
      total,
    }

    for (const conv of conversations) {
      const formatted: TelegramConversation = {
        id: String(conv.id),
        name: conv.name,
        type: conv.type,
        member_count: conv.unread_count,
        last_message_date: 'last_message_date' in conv ? (conv.last_message_date as string | undefined) : undefined,
      }

      if (conv.type === 'private') {
        result.private.push(formatted as TelegramConversation & { type: 'private' })
      } else if (conv.type === 'group') {
        result.groups.push(formatted as TelegramConversation & { type: 'group' })
      } else if (conv.type === 'channel') {
        result.channels.push(formatted as TelegramConversation & { type: 'channel' })
      }
    }

    return result
  },

  async getTelegramSyncStatus(): Promise<{ running: boolean; pid: number | null }> {
    const response = await fetch(`${API_BASE_URL}/telegram/sync/status`, { headers: authHeaders() })
    if (!response.ok) return { running: false, pid: null }
    return response.json()
  },

  async cancelTelegramSync(): Promise<{ success: boolean; message: string }> {
    const response = await fetch(`${API_BASE_URL}/telegram/sync/cancel`, { method: 'POST', headers: authHeaders() })
    if (!response.ok) return { success: false, message: `HTTP ${response.status}` }
    return response.json()
  },

  async syncWorkflows(params?: {
    service_name?: string
    config?: ConversationWorkflowConfig
    workflow_id?: number
  }): Promise<{
    message: string
    workflows: Array<{
      service: string
      workflow_id: number
      workflow_name: string
      action: 'created' | 'updated'
    }>
  }> {
    if (!params?.service_name) {
      return { message: 'No service provided', workflows: [] }
    }

    const service = params.service_name.toLowerCase()
    const workflow = params.workflow_id
      ? updateWorkflowById(params.workflow_id, (existing) => ({
          ...existing,
          config: { ...(existing.config || {}), ...(params.config || {}) },
          updated_at: nowIso(),
        }))
      : ensureWorkflow(service, params.config)

    if (!workflow) {
      return { message: 'Workflow not found', workflows: [] }
    }

    return {
      message: 'Workflow updated',
      workflows: [
        {
          service,
          workflow_id: workflow.id,
          workflow_name: workflow.name,
          action: params.workflow_id ? 'updated' : 'created',
        },
      ],
    }
  },

  async initiateTelegramAuth(): Promise<{
    auth_request_id: string
    qr_url: string
    expires_at: string
  }> {
    const response = await fetch(`${API_BASE_URL}/telegram/auth/initiate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
    })

    if (!response.ok) {
      throw new Error(`Failed to initiate Telegram auth: ${response.status}`)
    }

    const data = await response.json() as {
      qr_image?: string
      status: string
      message?: string
    }

    // Backend returns qr_image as base64, UI expects qr_url as image src
    return {
      auth_request_id: 'stateful', // Server is stateful, no ID needed
      qr_url: data.qr_image ? `data:image/png;base64,${data.qr_image}` : '',
      expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    }
  },

  async pollTelegramAuth(_authRequestId: string): Promise<{
    status: 'pending' | 'completed' | 'requires_2fa' | 'expired'
    session_string?: string
    username?: string
    telegram_user_id?: number
  }> {
    const response = await fetch(`${API_BASE_URL}/telegram/auth/status`, { headers: authHeaders() })

    if (!response.ok) {
      throw new Error(`Failed to poll Telegram auth: ${response.status}`)
    }

    const data = await response.json() as {
      status: 'not_started' | 'pending' | 'waiting' | 'needs_2fa' | 'authenticated' | 'expired' | 'error'
      username?: string
      user_id?: number
      message?: string
    }

    // Map backend status to UI status
    const statusMap: Record<string, 'pending' | 'completed' | 'requires_2fa' | 'expired'> = {
      not_started: 'pending',
      pending: 'pending',
      waiting: 'pending',
      needs_2fa: 'requires_2fa',
      authenticated: 'completed',
      expired: 'expired',
      error: 'expired',
    }

    const uiStatus = statusMap[data.status] || 'pending'

    // If authenticated, mark as connected in local storage
    if (data.status === 'authenticated') {
      const connected = getConnectedMap()
      connected.telegram = {
        service: 'telegram',
        account_id: data.username || 'telegram-user',
        status: 'connected',
        connected_at: nowIso(),
      }
      setConnectedMap(connected)
      ensureWorkflow('telegram')
    }

    return {
      status: uiStatus,
      username: data.username,
      telegram_user_id: data.user_id,
    }
  },

  async submitTelegram2FA(
    _authRequestId: string,
    password: string,
  ): Promise<{
    status: 'completed' | 'invalid_password'
    session_string?: string
    username?: string
    telegram_user_id?: number
    error?: string
  }> {
    const response = await fetch(`${API_BASE_URL}/telegram/auth/2fa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ password }),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as { detail?: string }
      return {
        status: 'invalid_password',
        error: errorData.detail || `2FA failed: ${response.status}`,
      }
    }

    const data = await response.json() as {
      status: string
      username?: string
      user_id?: number
    }

    if (data.status === 'authenticated') {
      const connected = getConnectedMap()
      connected.telegram = {
        service: 'telegram',
        account_id: data.username || 'telegram-user',
        status: 'connected',
        connected_at: nowIso(),
      }
      setConnectedMap(connected)
      ensureWorkflow('telegram')
    }

    return {
      status: data.status === 'authenticated' ? 'completed' : 'invalid_password',
      username: data.username,
      telegram_user_id: data.user_id,
    }
  },

  async completeTelegramAuth(_authRequestId: string): Promise<{
    status: string
    connected_account_id?: string
    username?: string
    telegram_user_id?: number
  }> {
    // Get current status from backend
    const statusResponse = await fetch(`${API_BASE_URL}/telegram/auth/status`, { headers: authHeaders() })
    const data = await statusResponse.json() as {
      status: string
      username?: string
      user_id?: number
    }

    if (data.status === 'authenticated') {
      const connected = getConnectedMap()
      connected.telegram = {
        service: 'telegram',
        account_id: data.username || 'telegram-user',
        status: 'connected',
        connected_at: nowIso(),
      }
      setConnectedMap(connected)
      ensureWorkflow('telegram')
    }

    return {
      status: data.status === 'authenticated' ? 'connected' : data.status,
      connected_account_id: data.username,
      username: data.username,
      telegram_user_id: data.user_id,
    }
  },

  async saveTelegramConfig(config: {
    include_conversations: string[]
    lookback_days: number
    conversation_details?: Array<{ id: string; name: string; type: string }>
  }): Promise<{ success: boolean; message?: string }> {
    try {
      const response = await fetch(`${API_BASE_URL}/telegram/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(config),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})) as { detail?: string }
        return { success: false, message: errorData.detail || `Failed to save config: ${response.status}` }
      }

      return { success: true }
    } catch (error) {
      return { success: false, message: String(error) }
    }
  },

  async getTelegramConfig(): Promise<{
    whitelist_ids: string[]
    lookback_days: number
  }> {
    try {
      const response = await fetch(`${API_BASE_URL}/telegram/config`, { headers: authHeaders() })
      if (!response.ok) {
        return { whitelist_ids: [], lookback_days: 7 }
      }
      return await response.json()
    } catch {
      return { whitelist_ids: [], lookback_days: 7 }
    }
  },

  async getTelegramLastSync(): Promise<{
    last_sync: number | null
    last_sync_iso: string | null
  }> {
    try {
      const response = await fetch(`${API_BASE_URL}/telegram/last-sync`, { headers: authHeaders() })
      if (!response.ok) {
        return { last_sync: null, last_sync_iso: null }
      }
      return await response.json()
    } catch {
      return { last_sync: null, last_sync_iso: null }
    }
  },

  async getTelegramFilters(): Promise<{
    sync_unread_only: boolean
    include_dms: boolean
    include_groups: boolean
    include_channels: boolean
    include_muted: boolean
    include_archived: boolean
    mark_unread_after_sync: boolean
  }> {
    const defaults = {
      sync_unread_only: true,
      include_dms: true,
      include_groups: true,
      include_channels: false,
      include_muted: false,
      include_archived: false,
      mark_unread_after_sync: true,
    }
    try {
      const response = await fetch(`${API_BASE_URL}/api/setup/schedules/telegram/filters`)
      if (!response.ok) {
        return defaults
      }
      return await response.json()
    } catch {
      return defaults
    }
  },

  async saveTelegramFilters(filters: {
    sync_unread_only: boolean
    include_dms: boolean
    include_groups: boolean
    include_channels: boolean
    include_muted: boolean
    include_archived: boolean
    mark_unread_after_sync: boolean
  }): Promise<{ success: boolean }> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/setup/schedules/telegram/filters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(filters),
      })
      return { success: response.ok }
    } catch {
      return { success: false }
    }
  },

  async getTelegramStatus(): Promise<{
    connected: boolean
    username?: string
    telegram_user_id?: number
  }> {
    try {
      const response = await fetch(`${API_BASE_URL}/telegram/auth/status`, { headers: authHeaders() })

      if (!response.ok) {
        return { connected: false }
      }

      const data = await response.json() as {
        status: string
        username?: string
        user_id?: number
      }

      const isConnected = data.status === 'authenticated'

      // Sync local storage with backend state
      if (isConnected) {
        const connected = getConnectedMap()
        if (!connected.telegram) {
          connected.telegram = {
            service: 'telegram',
            account_id: data.username || 'telegram-user',
            status: 'connected',
            connected_at: nowIso(),
          }
          setConnectedMap(connected)
        }
      }

      return {
        connected: isConnected,
        username: data.username,
        telegram_user_id: data.user_id,
      }
    } catch {
      // If backend is not available, fall back to local state
      const connected = getConnectedMap().telegram
      if (!connected) {
        return { connected: false }
      }
      return { connected: true }
    }
  },
}

export const schedulesAPI = {
  getInstalled: () =>
    fetch(`${API_BASE_URL}/api/setup/schedules/installed`).then((r) => r.json()),

  getPresets: () =>
    fetch(`${API_BASE_URL}/api/setup/schedules/presets`).then((r) => r.json()),

  install: (selections: Array<{ connector: string; preset_id: string }>) =>
    fetch(`${API_BASE_URL}/api/setup/schedules/install`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schedules: selections }),
    }).then((r) => r.json()),

  uninstall: (connector: string) =>
    fetch(`${API_BASE_URL}/api/setup/schedules/${connector}`, {
      method: 'DELETE',
    }).then((r) => r.json()),

  runNow: (connector: string) =>
    fetch(`${API_BASE_URL}/api/setup/sync/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectors: [connector] }),
    }).then((r) => r.json()),
}

export const workflowAPI = {
  async list(): Promise<Workflow[]> {
    return getWorkflows()
  },

  async get(id: number): Promise<Workflow> {
    const workflow = getWorkflows().find((item) => item.id === id)
    if (!workflow) {
      throw new Error('Workflow not found')
    }
    return workflow
  },

  async updateWorkflow(
    id: number,
    data: { config: Partial<ConversationWorkflowConfig | SlackWorkflowConfig> },
  ): Promise<Workflow> {
    const updated = updateWorkflowById(id, (workflow) => ({
      ...workflow,
      config: { ...(workflow.config || {}), ...(data.config || {}) },
      updated_at: nowIso(),
    }))

    if (!updated) {
      throw new Error('Workflow not found')
    }

    return updated
  },
}

// ==================== Agent Config API ====================

export const agentConfigAPI = {
  async getAgents(): Promise<Agent[]> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/agents/config`, {
        headers: authHeaders(),
      })
      if (!response.ok) throw new Error(`Failed to fetch agents: ${response.status}`)
      const data = await response.json()
      return (data.agents ?? data) as Agent[]
    } catch (error) {
      console.error('Failed to fetch agents:', error)
      return []
    }
  },

  async getAgent(id: string): Promise<Agent> {
    const response = await fetch(`${API_BASE_URL}/api/agents/config/${id}`, {
      headers: authHeaders(),
    })
    if (!response.ok) throw new Error(`Failed to fetch agent: ${response.status}`)
    return await response.json() as Agent
  },

  async createAgent(data: Omit<Agent, 'memory'>): Promise<Agent> {
    const response = await fetch(`${API_BASE_URL}/api/agents/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(data),
    })
    if (!response.ok) throw new Error(`Failed to create agent: ${response.status}`)
    return await response.json() as Agent
  },

  async deleteAgent(id: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/api/agents/config/${id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    })
    if (!response.ok) throw new Error(`Failed to delete agent: ${response.status}`)
  },

  async updateAgent(id: string, data: { prompt?: string; name?: string; role?: string }): Promise<Agent> {
    const response = await fetch(`${API_BASE_URL}/api/agents/config/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(data),
    })
    if (!response.ok) throw new Error(`Failed to update agent: ${response.status}`)
    return await response.json() as Agent
  },

  async updateMemory(id: string, content: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/api/agents/config/${id}/memory`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ content }),
    })
    if (!response.ok) throw new Error(`Failed to update memory: ${response.status}`)
  },
}

// ==================== Skills API ====================

export interface SkillInfo {
  id: string
  name: string
  trigger: string
  description: string
  category: string
}

export const skillsAPI = {
  async listSkills(): Promise<SkillInfo[]> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/skills`, { headers: authHeaders() })
      if (!response.ok) return []
      return await response.json() as SkillInfo[]
    } catch {
      return []
    }
  },
}

// ==================== Agent Chat API ====================

export interface ChatSession {
  id: string
  title: string
  agent_id: string
  created_at: string
  message_count: number
}

export interface ChatMessage {
  id?: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  agent_id?: string
  tool_calls?: Array<{
    id: string
    name: string
    status: 'running' | 'complete' | 'error'
    file?: string
    progress?: number
  }>
}

export interface StreamEvent {
  type: 'token' | 'tool_call' | 'tool_result' | 'complete' | 'error'
  content?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  tool_id?: string
  success?: boolean
  message?: Record<string, unknown>
  error?: string
}

export const agentAPI = {
  async getSessions(): Promise<ChatSession[]> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/chat/sessions`)
      if (!response.ok) throw new Error('Failed to fetch sessions')
      const data = await response.json() as { sessions: ChatSession[] }
      return data.sessions
    } catch (error) {
      console.error('Failed to fetch sessions:', error)
      return []
    }
  },

  async createSession(title?: string, agentId: string = 'engineer'): Promise<ChatSession | null> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/chat/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, agent_id: agentId }),
      })
      if (!response.ok) throw new Error('Failed to create session')
      const data = await response.json() as { session: ChatSession }
      return data.session
    } catch (error) {
      console.error('Failed to create session:', error)
      return null
    }
  },

  async getMessages(sessionId: string): Promise<ChatMessage[]> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/chat/sessions/${sessionId}/messages`)
      if (!response.ok) throw new Error('Failed to fetch messages')
      const data = await response.json() as { messages: ChatMessage[] }
      return data.messages
    } catch (error) {
      console.error('Failed to fetch messages:', error)
      return []
    }
  },

  streamChat(
    sessionId: string,
    message: string,
    agentId: string,
    onEvent: (event: StreamEvent) => void,
    onError?: (error: Error) => void,
    onComplete?: () => void
  ): () => void {
    const controller = new AbortController()

    const fetchStream = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/chat/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: sessionId,
            message,
            agent_id: agentId,
          }),
          signal: controller.signal,
        })

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }

        const reader = response.body?.getReader()
        if (!reader) throw new Error('No response body')

        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6)) as StreamEvent
                onEvent(data)
                if (data.type === 'complete') {
                  onComplete?.()
                }
              } catch {
                // Skip invalid JSON
              }
            }
          }
        }

        onComplete?.()
      } catch (error) {
        if (error instanceof Error && error.name !== 'AbortError') {
          onError?.(error)
        }
      }
    }

    fetchStream()

    // Return cleanup function
    return () => controller.abort()
  },
}

// ==================== Agent Sessions API (WebSocket-based) ====================

export const agentSessionsAPI = {
  /**
   * Get all chat sessions
   */
  async getSessions(): Promise<Session[]> {
    const response = await fetch(`${API_BASE_URL}/api/agents/sessions`, {
      headers: authHeaders(),
    })
    if (!response.ok) {
      throw new Error(`Failed to fetch sessions: ${response.status}`)
    }
    const data = await response.json() as SessionListResponse
    return data.sessions
  },

  /**
   * Create a new chat session
   */
  async createSession(title: string = 'New Chat', agentId: string = 'engineer'): Promise<CreateSessionResponse> {
    const response = await fetch(`${API_BASE_URL}/api/agents/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ title, agent_id: agentId }),
    })
    if (!response.ok) {
      throw new Error(`Failed to create session: ${response.status}`)
    }
    return await response.json() as CreateSessionResponse
  },

  /**
   * Get session details including messages
   */
  async getSession(sessionId: string): Promise<SessionDetail> {
    const response = await fetch(`${API_BASE_URL}/api/agents/sessions/${sessionId}`, {
      headers: authHeaders(),
    })
    if (!response.ok) {
      throw new Error(`Failed to fetch session: ${response.status}`)
    }
    return await response.json() as SessionDetail
  },

  /**
   * Delete (kill) a session
   */
  async deleteSession(sessionId: string): Promise<DeleteSessionResponse> {
    const response = await fetch(`${API_BASE_URL}/api/agents/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: authHeaders(),
    })
    if (!response.ok) {
      throw new Error(`Failed to delete session: ${response.status}`)
    }
    return await response.json() as DeleteSessionResponse
  },

  /**
   * Activate/resume an existing session
   */
  async activateSession(sessionId: string, agentId: string = 'engineer'): Promise<ActivateSessionResponse> {
    const response = await fetch(`${API_BASE_URL}/api/agents/sessions/${sessionId}/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ agent_id: agentId }),
    })
    if (!response.ok) {
      throw new Error(`Failed to activate session: ${response.status}`)
    }
    return await response.json() as ActivateSessionResponse
  },

  /**
   * Update session title
   */
  async updateTitle(sessionId: string, title: string): Promise<{ ok: boolean; session_id: string; title: string }> {
    const response = await fetch(`${API_BASE_URL}/api/agents/sessions/${sessionId}/title?title=${encodeURIComponent(title)}`, {
      method: 'POST',
      headers: authHeaders(),
    })
    if (!response.ok) {
      throw new Error(`Failed to update title: ${response.status}`)
    }
    return await response.json()
  },

  /**
   * Upload an attachment for a session.
   */
  async uploadAttachment(sessionId: string, file: File): Promise<AgentSessionAttachment> {
    const formData = new FormData()
    formData.append('file', file)

    const response = await fetch(`${API_BASE_URL}/api/agents/sessions/${sessionId}/attachments`, {
      method: 'POST',
      headers: authHeaders(),
      body: formData,
    })

    if (!response.ok) {
      throw new Error(`Failed to upload attachment: ${response.status}`)
    }

    return await response.json() as AgentSessionAttachment
  },

  /**
   * Get WebSocket URL for a session
   */
  getWebSocketUrl(sessionId: string): string {
    return withAtlasApiKey(`${WS_BASE_URL}/ws/agent/${sessionId}`)
  },
}

// ==================== WebSocket Connection Manager ====================

export type WebSocketMessageHandler = (message: ServerMessage) => void
export type WebSocketErrorHandler = (error: Event) => void
export type WebSocketCloseHandler = (event: CloseEvent) => void
export type WebSocketOpenHandler = () => void

export interface AgentWebSocketOptions {
  onMessage?: WebSocketMessageHandler
  onError?: WebSocketErrorHandler
  onClose?: WebSocketCloseHandler
  onOpen?: WebSocketOpenHandler
  reconnectAttempts?: number
  reconnectDelay?: number
}

export class AgentWebSocket {
  private ws: WebSocket | null = null
  private sessionId: string
  private options: AgentWebSocketOptions
  private reconnectCount = 0
  private isManualClose = false

  constructor(sessionId: string, options: AgentWebSocketOptions = {}) {
    this.sessionId = sessionId
    this.options = {
      reconnectAttempts: 3,
      reconnectDelay: 1000,
      ...options,
    }
  }

  /**
   * Connect to the WebSocket
   */
  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return // Already connected
    }

    const url = agentSessionsAPI.getWebSocketUrl(this.sessionId)
    this.ws = new WebSocket(url)
    this.isManualClose = false

    this.ws.onopen = () => {
      this.reconnectCount = 0
      this.options.onOpen?.()
    }

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as ServerMessage
        this.options.onMessage?.(message)
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error)
      }
    }

    this.ws.onerror = (error) => {
      this.options.onError?.(error)
    }

    this.ws.onclose = (event) => {
      this.options.onClose?.(event)

      // Attempt reconnection if not manually closed
      if (!this.isManualClose && this.reconnectCount < (this.options.reconnectAttempts ?? 3)) {
        this.reconnectCount++
        setTimeout(() => {
          this.connect()
        }, this.options.reconnectDelay)
      }
    }
  }

  /**
   * Send a message through the WebSocket
   */
  send(message: ClientMessage): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      console.warn('WebSocket not connected')
      return false
    }

    try {
      this.ws.send(JSON.stringify(message))
      return true
    } catch (error) {
      console.error('Failed to send WebSocket message:', error)
      return false
    }
  }

  /**
   * Send a chat message
   */
  sendMessage(content: string, agentId: string, messageId?: string): boolean {
    return this.send({
      type: 'message',
      content,
      agent_id: agentId,
      message_id: messageId,
    })
  }

  /**
   * Respond to a permission request
   */
  respondToPermission(toolUseId: string, approved: boolean, reason?: string): boolean {
    return this.send({
      type: 'permission_response',
      tool_use_id: toolUseId,
      approved,
      reason,
    })
  }

  /**
   * Activate the session
   */
  activate(agentId: string): boolean {
    return this.send({
      type: 'activate',
      agent_id: agentId,
    })
  }

  /**
   * Close the WebSocket connection
   */
  close(): void {
    this.isManualClose = true
    this.ws?.close()
    this.ws = null
  }

  /**
   * Check if connected
   */
  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  /**
   * Get current ready state
   */
  get readyState(): number | undefined {
    return this.ws?.readyState
  }
}

// ==================== Inbox API (Vault-based) ====================

export const inboxAPI = {
  async getConversations(): Promise<import('@/types/inbox').ConversationsResponse> {
    const resp = await fetch(`${API_BASE_URL}/api/inbox/conversations`, {
      headers: authHeaders(),
    })
    if (!resp.ok) throw new Error(`Failed to fetch conversations: ${resp.status}`)
    return resp.json()
  },

  async getMessages(filename: string): Promise<import('@/types/inbox').MessagesResponse> {
    const resp = await fetch(`${API_BASE_URL}/api/inbox/conversations/${encodeURIComponent(filename)}/messages`, {
      headers: authHeaders(),
    })
    if (!resp.ok) throw new Error(`Failed to fetch messages: ${resp.status}`)
    return resp.json()
  },

  async getSuggestions(): Promise<import('@/types/inbox').SuggestionsResponse> {
    try {
      const resp = await fetch(`${API_BASE_URL}/api/inbox/suggestions`, {
        headers: authHeaders(),
      })
      if (!resp.ok) return { suggestions: [], generated: null }
      return resp.json()
    } catch {
      return { suggestions: [], generated: null }
    }
  },

  async sendMessage(chatId: number, message: string, replyToMessageId?: number): Promise<{ success: boolean; error?: string }> {
    try {
      const body: Record<string, unknown> = { chat_id: chatId, message }
      if (replyToMessageId !== undefined) body.reply_to_message_id = replyToMessageId
      const resp = await fetch(`${API_BASE_URL}/api/inbox/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      })
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}))
        return { success: false, error: data.detail || 'Failed to send' }
      }
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  },
}

// Export base URLs for external use
export { API_BASE_URL, WS_BASE_URL }
