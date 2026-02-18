import { useState, useEffect, useCallback, useMemo } from 'react'
import { Search, Lock, Users, Hash, Loader2, AlertTriangle, Calendar, ChevronRight, Settings2 } from 'lucide-react'
import { integrationAPI, type TelegramConversation } from '@/lib/api'
import { useConversationCategories } from '@/hooks/useConversationCategories'
import { useTimePeriodSelection } from '@/hooks/useTimePeriodSelection'
import { TIME_PERIODS } from '@/lib/conversationConfigUtils'
import { ConversationListSection } from '@/components/connectors/ConversationListSection'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar as CalendarComponent } from '@/components/ui/calendar'
import { cn } from '@/lib/utils'
import { API_BASE_URL } from '@/lib/api'

interface TelegramFilters {
  sync_unread_only: boolean
  include_dms: boolean
  include_groups: boolean
  include_channels: boolean
  include_muted: boolean
  include_archived: boolean
  mark_unread_after_sync: boolean
}

const DEFAULT_FILTERS: TelegramFilters = {
  sync_unread_only: true,
  include_dms: true,
  include_groups: true,
  include_channels: false,
  include_muted: false,
  include_archived: false,
  mark_unread_after_sync: true,
}

interface TelegramConversationStepProps {
  connectors: string[]
  onComplete: () => void
  onSkip: () => void
}

export function TelegramConversationStep({
  connectors,
  onComplete,
  onSkip,
}: TelegramConversationStepProps) {
  const telegramEnabled = connectors.includes('telegram')

  // Sync-in-progress state
  const [syncRunning, setSyncRunning] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  // Conversations state
  const [privateConversations, setPrivateConversations] = useState<TelegramConversation[]>([])
  const [groupConversations, setGroupConversations] = useState<TelegramConversation[]>([])
  const [channelConversations, setChannelConversations] = useState<TelegramConversation[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Backend config state
  const [backendWhitelistIds, setBackendWhitelistIds] = useState<string[]>([])
  const [backendLookbackDays, setBackendLookbackDays] = useState<number | null>(null)

  // Filter settings state
  const [filters, setFilters] = useState<TelegramFilters>(DEFAULT_FILTERS)
  const [showAdvanced, setShowAdvanced] = useState(false)

  // Compute initial selected IDs from backend
  const initialSelectedIds = useMemo(() => {
    if (backendWhitelistIds.length > 0) {
      return new Set(backendWhitelistIds)
    }
    return new Set<string>()
  }, [backendWhitelistIds])

  const initialLookbackDays = useMemo(() => {
    return backendLookbackDays ?? 7
  }, [backendLookbackDays])

  // Time period selection
  const {
    selectedTimePeriod,
    setSelectedTimePeriod,
    customDate,
    setCustomDate,
    isCustomDateExpanded,
    setIsCustomDateExpanded,
    isDatePickerOpen,
    setIsDatePickerOpen,
    lookbackDays,
  } = useTimePeriodSelection(initialLookbackDays)

  // Conversation categories hook
  const {
    searchQuery,
    setSearchQuery,
    categories,
    hasSearchQuery,
    hasAnySearchResults,
    allSelectedIds,
    toggleConversation,
    toggleAllInCategory,
    toggleCategoryOpen,
  } = useConversationCategories({
    categories: [
      { key: 'private', conversations: privateConversations, defaultOpen: true },
      { key: 'groups', conversations: groupConversations, defaultOpen: false },
      { key: 'channels', conversations: channelConversations, defaultOpen: false },
    ],
    initialSelectedIds,
    loading,
  })

  const checkSyncStatus = useCallback(async (): Promise<boolean> => {
    try {
      const status = await integrationAPI.getTelegramSyncStatus()
      setSyncRunning(status.running)
      return status.running
    } catch {
      return false
    }
  }, [])

  const handleCancelSync = useCallback(async () => {
    setCancelling(true)
    try {
      const result = await integrationAPI.cancelTelegramSync()
      if (result.success) {
        setSyncRunning(false)
        // Small delay for lock to release, then load conversations
        await new Promise(r => setTimeout(r, 500))
        fetchConversations()
      } else {
        setError(`Failed to cancel sync: ${result.message}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel sync')
    } finally {
      setCancelling(false)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const fetchConversations = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      // Check if a sync is running before trying to load conversations
      const isSyncing = await checkSyncStatus()
      if (isSyncing) {
        setLoading(false)
        return
      }

      // Fetch conversations, config, and filters in parallel
      const [data, config, filtersRes] = await Promise.all([
        integrationAPI.listTelegramConversations({ limit: 100, offset: 0 }),
        integrationAPI.getTelegramConfig(),
        fetch(`${API_BASE_URL}/api/setup/schedules/telegram/filters`).then(r => r.ok ? r.json() : null).catch(() => null),
      ])

      // Set backend config
      if (config) {
        setBackendWhitelistIds(config.whitelist_ids)
        setBackendLookbackDays(config.lookback_days)
      }

      // Set filter settings
      if (filtersRes) {
        setFilters(filtersRes)
      }

      // Sort by last message date
      const sortByDate = (a: TelegramConversation, b: TelegramConversation) => {
        if (!a.last_message_date) return 1
        if (!b.last_message_date) return -1
        return new Date(b.last_message_date).getTime() - new Date(a.last_message_date).getTime()
      }

      setPrivateConversations([...data.private].sort(sortByDate))
      setGroupConversations([...data.groups].sort(sortByDate))
      setChannelConversations([...data.channels].sort(sortByDate))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load Telegram conversations'
      // If 503, check sync status — it's likely a sync holding the lock
      if (message.includes('503')) {
        const isSyncing = await checkSyncStatus()
        if (isSyncing) {
          setLoading(false)
          return
        }
      }
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [checkSyncStatus])

  useEffect(() => {
    if (telegramEnabled) {
      fetchConversations()
    }
  }, [telegramEnabled, fetchConversations])

  const handleSave = async () => {
    try {
      setSaving(true)
      setSaveError(null)

      // Build conversation details for fast save (avoids re-fetching from Telegram)
      const allConversations = [...privateConversations, ...groupConversations, ...channelConversations]
      const selectedSet = new Set(allSelectedIds)
      const conversationDetails = allConversations
        .filter(c => selectedSet.has(c.id))
        .map(c => ({ id: c.id, name: c.name, type: c.type }))

      // Save both whitelist config and filter settings in parallel
      const [result, filtersRes] = await Promise.all([
        integrationAPI.saveTelegramConfig({
          include_conversations: allSelectedIds,
          lookback_days: lookbackDays,
          conversation_details: conversationDetails,
        }),
        fetch(`${API_BASE_URL}/api/setup/schedules/telegram/filters`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(filters),
        }),
      ])

      if (!result.success) {
        setSaveError(result.message || 'Failed to save configuration')
        return
      }

      if (!filtersRes.ok) {
        setSaveError('Failed to save sync settings')
        return
      }

      onComplete()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save configuration'
      setSaveError(message)
    } finally {
      setSaving(false)
    }
  }

  // Find category data
  const privateCategory = categories.find((c) => c.key === 'private')
  const groupsCategory = categories.find((c) => c.key === 'groups')
  const channelsCategory = categories.find((c) => c.key === 'channels')

  const showPrivateSection = !hasSearchQuery || (privateCategory && privateCategory.filtered.length > 0)
  const showGroupsSection = !hasSearchQuery || (groupsCategory && groupsCategory.filtered.length > 0)
  const showChannelsSection = !hasSearchQuery || (channelsCategory && channelsCategory.filtered.length > 0)

  // Not enabled state
  if (!telegramEnabled) {
    return (
      <div className="space-y-6">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-light mb-2 text-white">Select Telegram Chats</h1>
          <p className="text-gray-400">Telegram connector not selected</p>
        </div>

        <div className="flex flex-col items-center justify-center py-12">
          <div className="w-16 h-16 rounded-full bg-gray-500/20 flex items-center justify-center border border-gray-500/30 mb-4">
            <svg className="w-8 h-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-gray-400 text-center">
            You didn't select Telegram as a connector.
            <br />
            You can skip this step.
          </p>
        </div>

        <button
          onClick={onSkip}
          className="w-full py-3 bg-white/10 text-white rounded-lg font-medium hover:bg-white/20 transition"
        >
          Skip
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-light mb-2 text-white">Select Telegram Chats</h1>
        <p className="text-gray-400">Select chats to always sync, plus optionally auto-discover unread ones</p>
      </div>

      {/* Search input */}
      <div>
        <label className="block text-sm text-gray-400 mb-2">Search conversations</label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            disabled={loading}
            className="w-full bg-black border border-atlas-border rounded-lg pl-10 pr-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-white/30"
          />
        </div>
      </div>

      {/* Sync in progress state */}
      {syncRunning && (
        <div className="flex flex-col items-center justify-center py-12">
          <div className="w-16 h-16 rounded-full bg-orange-500/10 flex items-center justify-center border border-orange-500/30 mb-4">
            <Loader2 className="h-8 w-8 animate-spin text-orange-400" />
          </div>
          <p className="text-white font-medium mb-1">Telegram sync in progress</p>
          <p className="text-gray-400 text-sm text-center mb-6">
            A sync is currently running. Cancel it to change your conversation selection.
          </p>
          <button
            onClick={handleCancelSync}
            disabled={cancelling}
            className="px-6 py-2.5 bg-orange-500/20 hover:bg-orange-500/30 border border-orange-500/30 rounded-lg text-orange-300 text-sm font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {cancelling && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {cancelling ? 'Cancelling...' : 'Cancel Sync & Edit Conversations'}
          </button>
        </div>
      )}

      {/* Error state */}
      {!syncRunning && error && (
        <div className="flex items-center gap-2 p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
          <AlertTriangle className="h-4 w-4 text-red-400" />
          <span className="flex-1 text-sm text-red-400">{error}</span>
          <button
            onClick={fetchConversations}
            className="text-sm text-red-400 hover:text-red-300 underline"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading state */}
      {!syncRunning && loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400 mr-2" />
          <span className="text-gray-400">Loading conversations...</span>
        </div>
      ) : !syncRunning ? (
        <div className="space-y-2 max-h-[300px] overflow-y-auto">
          {/* Private Chats */}
          {showPrivateSection && privateCategory && (
            <ConversationListSection
              title="Private Chats"
              conversations={privateCategory.filtered}
              selectedIds={privateCategory.selected}
              selectedCount={privateCategory.selectedCount}
              allSelected={privateCategory.allSelected}
              toggleAll={() => toggleAllInCategory('private')}
              onToggle={(id) => toggleConversation('private', id)}
              emptyMessage="No private chats available."
              isOpen={privateCategory.isOpen}
              onOpenChange={() => toggleCategoryOpen('private')}
              renderIcon={() => <Lock className="h-4 w-4 text-gray-500" />}
              chevronDirection="down"
            />
          )}

          {/* Groups */}
          {showGroupsSection && groupsCategory && (
            <ConversationListSection
              title="Groups"
              conversations={groupsCategory.filtered}
              selectedIds={groupsCategory.selected}
              selectedCount={groupsCategory.selectedCount}
              allSelected={groupsCategory.allSelected}
              toggleAll={() => toggleAllInCategory('groups')}
              onToggle={(id) => toggleConversation('groups', id)}
              emptyMessage="No groups available."
              isOpen={groupsCategory.isOpen}
              onOpenChange={() => toggleCategoryOpen('groups')}
              renderIcon={() => <Users className="h-4 w-4 text-gray-500" />}
            />
          )}

          {/* Channels */}
          {showChannelsSection && channelsCategory && (
            <ConversationListSection
              title="Channels"
              conversations={channelsCategory.filtered}
              selectedIds={channelsCategory.selected}
              selectedCount={channelsCategory.selectedCount}
              allSelected={channelsCategory.allSelected}
              toggleAll={() => toggleAllInCategory('channels')}
              onToggle={(id) => toggleConversation('channels', id)}
              emptyMessage="No channels available."
              isOpen={channelsCategory.isOpen}
              onOpenChange={() => toggleCategoryOpen('channels')}
              renderIcon={() => <Hash className="h-4 w-4 text-gray-500" />}
            />
          )}

          {/* No search results */}
          {hasSearchQuery && !hasAnySearchResults && (
            <div className="text-center py-8 text-gray-500 text-sm">
              No conversations match your search.
            </div>
          )}
        </div>
      ) : null}

      {/* Lookback days selector */}
      {!syncRunning && <div>
        <label className="block text-sm text-gray-400 mb-2">Sync messages from</label>
        <Popover open={isDatePickerOpen} onOpenChange={setIsDatePickerOpen}>
          <PopoverTrigger asChild>
            <button className="w-full flex items-center gap-2 bg-black border border-atlas-border rounded-lg px-4 py-3 text-left hover:border-white/30 transition">
              <Calendar className="h-4 w-4 text-gray-500" />
              <span className="text-white text-sm">
                {customDate
                  ? customDate.toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })
                  : TIME_PERIODS.find((p) => p.value === selectedTimePeriod)?.label || 'Last 7 days'}
              </span>
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-[280px] p-0 bg-black border border-atlas-border" align="start">
            <div className="p-3 space-y-3">
              <div>
                <p className="text-sm font-semibold text-white mb-2">Ingestion start</p>
                <div className="space-y-1">
                  {TIME_PERIODS.map((period) => (
                    <button
                      key={period.value}
                      onClick={() => {
                        setSelectedTimePeriod(period.value)
                        setCustomDate(undefined)
                        setIsCustomDateExpanded(false)
                        setIsDatePickerOpen(false)
                      }}
                      className={cn(
                        'w-full text-left px-3 py-2 rounded text-sm transition',
                        selectedTimePeriod === period.value && !customDate
                          ? 'bg-white/10 text-white'
                          : 'text-gray-400 hover:bg-white/5 hover:text-white'
                      )}
                    >
                      {period.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="border-t border-atlas-border pt-3">
                <button
                  onClick={() => setIsCustomDateExpanded((prev) => !prev)}
                  className="flex items-center justify-between w-full text-sm font-semibold text-white mb-2 hover:text-gray-300 transition"
                >
                  <span>Custom start date</span>
                  <ChevronRight
                    className={cn(
                      'h-4 w-4 transition-transform',
                      isCustomDateExpanded && 'rotate-90'
                    )}
                  />
                </button>
                {isCustomDateExpanded && (
                  <CalendarComponent
                    mode="single"
                    selected={customDate}
                    onSelect={(date) => {
                      setSelectedTimePeriod('custom')
                      setCustomDate(date ?? undefined)
                      setIsDatePickerOpen(false)
                    }}
                    disabled={(date) => date > new Date()}
                    className="rounded-md"
                  />
                )}
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>}

      {!syncRunning && <>
      {/* Sync Settings */}
      <div className="border border-atlas-border rounded-lg overflow-hidden">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition"
        >
          <div className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-gray-400" />
            <span className="text-sm text-white">Sync Settings</span>
          </div>
          <ChevronRight
            className={cn(
              'h-4 w-4 text-gray-400 transition-transform',
              showAdvanced && 'rotate-90'
            )}
          />
        </button>

        {showAdvanced && (
          <div className="px-4 pb-4 space-y-3 border-t border-atlas-border pt-3">
            {/* Unread auto-discovery */}
            <label className="flex items-center justify-between cursor-pointer group">
              <div>
                <span className="text-sm text-white">Auto-sync unread chats</span>
                <p className="text-xs text-gray-500">Automatically sync new unread conversations</p>
              </div>
              <input
                type="checkbox"
                checked={filters.sync_unread_only}
                onChange={(e) => setFilters({ ...filters, sync_unread_only: e.target.checked })}
                className="w-4 h-4 rounded border-gray-600 bg-transparent text-orange-500 focus:ring-orange-500/20"
              />
            </label>

            {/* Type filters - only visible when unread discovery is on */}
            {filters.sync_unread_only && (
              <div className="pl-4 space-y-2 border-l border-atlas-border">
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-sm text-gray-400">Include DMs</span>
                  <input
                    type="checkbox"
                    checked={filters.include_dms}
                    onChange={(e) => setFilters({ ...filters, include_dms: e.target.checked })}
                    className="w-4 h-4 rounded border-gray-600 bg-transparent text-orange-500 focus:ring-orange-500/20"
                  />
                </label>
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-sm text-gray-400">Include groups</span>
                  <input
                    type="checkbox"
                    checked={filters.include_groups}
                    onChange={(e) => setFilters({ ...filters, include_groups: e.target.checked })}
                    className="w-4 h-4 rounded border-gray-600 bg-transparent text-orange-500 focus:ring-orange-500/20"
                  />
                </label>
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-sm text-gray-400">Include channels</span>
                  <input
                    type="checkbox"
                    checked={filters.include_channels}
                    onChange={(e) => setFilters({ ...filters, include_channels: e.target.checked })}
                    className="w-4 h-4 rounded border-gray-600 bg-transparent text-orange-500 focus:ring-orange-500/20"
                  />
                </label>
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-sm text-gray-400">Include muted</span>
                  <input
                    type="checkbox"
                    checked={filters.include_muted}
                    onChange={(e) => setFilters({ ...filters, include_muted: e.target.checked })}
                    className="w-4 h-4 rounded border-gray-600 bg-transparent text-orange-500 focus:ring-orange-500/20"
                  />
                </label>
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-sm text-gray-400">Include archived</span>
                  <input
                    type="checkbox"
                    checked={filters.include_archived}
                    onChange={(e) => setFilters({ ...filters, include_archived: e.target.checked })}
                    className="w-4 h-4 rounded border-gray-600 bg-transparent text-orange-500 focus:ring-orange-500/20"
                  />
                </label>
              </div>
            )}

            {/* Mark unread after sync */}
            <label className="flex items-center justify-between cursor-pointer group">
              <div>
                <span className="text-sm text-white">Mark unread after sync</span>
                <p className="text-xs text-gray-500">Keep messages unread in Telegram app</p>
              </div>
              <input
                type="checkbox"
                checked={filters.mark_unread_after_sync}
                onChange={(e) => setFilters({ ...filters, mark_unread_after_sync: e.target.checked })}
                className="w-4 h-4 rounded border-gray-600 bg-transparent text-orange-500 focus:ring-orange-500/20"
              />
            </label>
          </div>
        )}
      </div>

      {/* Save error */}
      {saveError && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
          <p className="text-red-400 text-sm text-center">{saveError}</p>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-3 pt-4">
        <button
          onClick={onSkip}
          disabled={saving}
          className="flex-1 py-3 bg-transparent border border-atlas-border text-gray-400 rounded-lg font-medium hover:border-gray-500 hover:text-gray-300 transition disabled:opacity-50"
        >
          Skip
        </button>
        <button
          onClick={handleSave}
          disabled={saving || loading}
          className="flex-1 py-3 bg-white text-black rounded-lg font-medium hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {saving ? 'Saving...' : 'Save & Continue'}
        </button>
      </div>

      <p className="text-center text-xs text-gray-600">
        {allSelectedIds.length} conversation{allSelectedIds.length !== 1 ? 's' : ''} selected
      </p>
      </>}
    </div>
  )
}
