import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  ChevronRight,
  Hash,
  Loader2,
  Lock,
  Search,
  Settings2,
  Users,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { integrationAPI, type TelegramConversation } from '@/lib/api';
import type { TelegramFilters, TelegramFolder } from '@/types';
import { ConversationListSection } from '@/components/connectors/ConversationListSection';
import { TIME_PERIODS } from '@/lib/conversationConfigUtils';
import { useTimePeriodSelection } from '@/hooks/useTimePeriodSelection';
import { useConversationCategories } from '@/hooks/useConversationCategories';

const DEFAULT_FILTERS: TelegramFilters = {
  sync_unread_only: true,
  include_dms: true,
  include_groups: true,
  include_channels: false,
  include_muted: false,
  include_archived: false,
  mark_unread_after_sync: true,
};

const PAGE_SIZE = 100;

export interface TelegramConversationPickerProps {
  /** Fallback whitelist IDs when backend config hasn't loaded yet (edit screen uses workflow config) */
  fallbackWhitelistIds?: string[];
  /** Fallback lookback days */
  fallbackLookbackDays?: number;
  /** If provided, shows a cancel button when sync is running */
  onCancelSync?: () => Promise<void>;
  /** Notifies parent of loading/selection state changes for button enablement */
  onStatusChange?: (status: {
    loading: boolean;
    syncRunning: boolean;
    selectedCount: number;
  }) => void;
}

export interface TelegramConversationPickerHandle {
  getState(): {
    selectedIds: string[];
    lookbackDays: number;
    filters: TelegramFilters;
    conversations: TelegramConversation[];
  };
  refetch(): void;
}

export const TelegramConversationPicker = forwardRef<
  TelegramConversationPickerHandle,
  TelegramConversationPickerProps
>(function TelegramConversationPicker(
  { fallbackWhitelistIds, fallbackLookbackDays, onCancelSync, onStatusChange },
  ref,
) {
  // Conversations state
  const [privateConversations, setPrivateConversations] = useState<TelegramConversation[]>([]);
  const [groupConversations, setGroupConversations] = useState<TelegramConversation[]>([]);
  const [channelConversations, setChannelConversations] = useState<TelegramConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync-in-progress state
  const [syncRunning, setSyncRunning] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  // Backend config state
  const [backendWhitelistIds, setBackendWhitelistIds] = useState<string[]>([]);
  const [backendLookbackDays, setBackendLookbackDays] = useState<number | null>(null);

  // Folder and pagination state
  const [folders, setFolders] = useState<TelegramFolder[]>([]);
  const [activeFolderId, setActiveFolderId] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);

  // Filter settings state
  const [filters, setFilters] = useState<TelegramFilters>(DEFAULT_FILTERS);
  const [showSyncSettings, setShowSyncSettings] = useState(false);

  // Compute initial selected IDs: backend > fallback
  const initialSelectedIds = useMemo(() => {
    if (backendWhitelistIds.length > 0) {
      return new Set(backendWhitelistIds);
    }
    if (fallbackWhitelistIds && fallbackWhitelistIds.length > 0) {
      return new Set(fallbackWhitelistIds);
    }
    return new Set<string>();
  }, [backendWhitelistIds, fallbackWhitelistIds]);

  const initialLookbackDays = useMemo(() => {
    if (backendLookbackDays !== null) {
      return backendLookbackDays;
    }
    return fallbackLookbackDays ?? 7;
  }, [backendLookbackDays, fallbackLookbackDays]);

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
  } = useTimePeriodSelection(initialLookbackDays);

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
  });

  // Notify parent of status changes
  useEffect(() => {
    onStatusChange?.({ loading, syncRunning, selectedCount: allSelectedIds.length });
  }, [loading, syncRunning, allSelectedIds.length, onStatusChange]);

  // Check sync status
  const checkSyncStatus = useCallback(async (): Promise<boolean> => {
    try {
      const status = await integrationAPI.getTelegramSyncStatus();
      setSyncRunning(status.running);
      return status.running;
    } catch {
      return false;
    }
  }, []);

  // Cancel sync handler (internal — wraps onCancelSync or uses default)
  const handleCancelSync = useCallback(async () => {
    if (onCancelSync) {
      setCancelling(true);
      try {
        await onCancelSync();
        setSyncRunning(false);
      } finally {
        setCancelling(false);
      }
      return;
    }
    // Default cancel logic
    setCancelling(true);
    try {
      const result = await integrationAPI.cancelTelegramSync();
      if (result.success) {
        setSyncRunning(false);
        await new Promise((r) => setTimeout(r, 500));
        fetchConversations();
      } else {
        setError(`Failed to cancel sync: ${result.message}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel sync');
    } finally {
      setCancelling(false);
    }
  }, [onCancelSync]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch conversations with pagination support
  const fetchConversations = useCallback(
    async (options?: { append?: boolean }) => {
      const append = options?.append ?? false;

      try {
        if (append) {
          setLoadingMore(true);
        } else {
          setLoading(true);
          setOffset(0);
        }
        setError(null);

        const currentOffset = append ? offset : 0;

        // Check if a sync is running before trying to load conversations
        if (currentOffset === 0) {
          const isSyncing = await checkSyncStatus();
          if (isSyncing) {
            setLoading(false);
            return;
          }
        }

        // Fetch config on first page
        if (currentOffset === 0) {
          try {
            const config = await integrationAPI.getTelegramConfig();
            if (config) {
              setBackendWhitelistIds(config.whitelist_ids);
              setBackendLookbackDays(config.lookback_days);
            }
          } catch {
            /* config is optional */
          }
        }

        const data = await integrationAPI.listTelegramConversations({
          limit: PAGE_SIZE,
          offset: currentOffset,
          folderId: activeFolderId ?? undefined,
        });

        // Update pagination state
        setHasMore(data.has_more ?? false);
        setTotal(data.total ?? 0);
        setOffset(currentOffset + PAGE_SIZE);

        const sortByDate = (a: TelegramConversation, b: TelegramConversation) => {
          if (!a.last_message_date) return 1;
          if (!b.last_message_date) return -1;
          return (
            new Date(b.last_message_date).getTime() - new Date(a.last_message_date).getTime()
          );
        };

        const newPrivate = [...data.private].sort(sortByDate);
        const newGroups = [...data.groups].sort(sortByDate);
        const newChannels = [...data.channels].sort(sortByDate);

        if (append) {
          setPrivateConversations((prev) => [...prev, ...newPrivate]);
          setGroupConversations((prev) => [...prev, ...newGroups]);
          setChannelConversations((prev) => [...prev, ...newChannels]);
        } else {
          setPrivateConversations(newPrivate);
          setGroupConversations(newGroups);
          setChannelConversations(newChannels);
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to load Telegram conversations';
        // If 503, check sync status — it's likely a sync holding the lock
        if (message.includes('503')) {
          const isSyncing = await checkSyncStatus();
          if (isSyncing) {
            setLoading(false);
            return;
          }
        }
        setError(message);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [activeFolderId, offset, checkSyncStatus],
  );

  // Load folders and filters separately (non-blocking)
  useEffect(() => {
    integrationAPI.listTelegramFolders().then(setFolders).catch(() => {});
    integrationAPI.getTelegramFilters().then(setFilters).catch(() => {});
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refetch when folder changes (skip initial mount)
  useEffect(() => {
    const isInitialMount = activeFolderId === null && offset === 0;
    if (!isInitialMount && activeFolderId !== undefined) {
      fetchConversations();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFolderId]);

  // Expose state to parent via ref
  useImperativeHandle(
    ref,
    () => ({
      getState() {
        return {
          selectedIds: allSelectedIds,
          lookbackDays,
          filters,
          conversations: [
            ...privateConversations,
            ...groupConversations,
            ...channelConversations,
          ],
        };
      },
      refetch() {
        fetchConversations();
      },
    }),
    [
      allSelectedIds,
      lookbackDays,
      filters,
      privateConversations,
      groupConversations,
      channelConversations,
      fetchConversations,
    ],
  );

  // Category data for rendering
  const privateCategory = categories.find((c) => c.key === 'private');
  const groupsCategory = categories.find((c) => c.key === 'groups');
  const channelsCategory = categories.find((c) => c.key === 'channels');

  const showPrivateSection =
    !hasSearchQuery || (privateCategory && privateCategory.filtered.length > 0);
  const showGroupsSection =
    !hasSearchQuery || (groupsCategory && groupsCategory.filtered.length > 0);
  const showChannelsSection =
    !hasSearchQuery || (channelsCategory && channelsCategory.filtered.length > 0);

  return (
    <div className="space-y-4">
      {/* Folder chips */}
      {folders.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant={activeFolderId === null ? 'secondary' : 'outline'}
            size="sm"
            className="rounded-full h-7 text-xs"
            onClick={() => setActiveFolderId(null)}
          >
            All
          </Button>
          {folders.map((folder) => (
            <Button
              key={folder.id}
              variant={activeFolderId === folder.id ? 'secondary' : 'outline'}
              size="sm"
              className="rounded-full h-7 text-xs"
              onClick={() => setActiveFolderId(folder.id)}
            >
              {folder.title}
              {folder.count > 0 && (
                <span className="ml-1 text-muted-foreground">({folder.count})</span>
              )}
            </Button>
          ))}
        </div>
      )}

      {/* Search input */}
      <div>
        <label className="text-sm font-medium mb-2 block">Search conversations</label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            disabled={loading}
          />
        </div>
      </div>

      {/* Sync in progress state */}
      {syncRunning && (
        <div className="flex flex-col items-center justify-center py-12">
          <div className="w-16 h-16 rounded-full bg-orange-500/10 flex items-center justify-center border border-orange-500/30 mb-4">
            <Loader2 className="h-8 w-8 animate-spin text-orange-400" />
          </div>
          <p className="text-foreground font-medium mb-1">Telegram sync in progress</p>
          <p className="text-muted-foreground text-sm text-center mb-6">
            A sync is currently running. Cancel it to change your conversation selection.
          </p>
          <Button
            variant="outline"
            onClick={handleCancelSync}
            disabled={cancelling}
            className="border-orange-500/30 text-orange-300 hover:bg-orange-500/10"
          >
            {cancelling && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
            {cancelling ? 'Cancelling...' : 'Cancel Sync & Edit Conversations'}
          </Button>
        </div>
      )}

      {/* Error states */}
      {!syncRunning && error ? (
        error.includes('503') ? (
          <div className="flex items-center gap-3 rounded-md border border-blue-500/30 bg-blue-500/10 p-4 text-sm">
            <Loader2 className="h-4 w-4 text-blue-400 animate-spin shrink-0" />
            <div className="flex-1 text-blue-300">
              <span className="font-medium">Sync in progress</span>
              <span className="text-blue-300/70">
                {' '}
                — Telegram conversations are being synced. This usually takes 30–60 seconds.
              </span>
            </div>
            <Button variant="outline" size="sm" onClick={() => void fetchConversations()}>
              Retry
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <div className="flex-1 text-destructive">{error}</div>
            <Button variant="outline" size="sm" onClick={() => void fetchConversations()}>
              Retry
            </Button>
          </div>
        )
      ) : null}

      {/* Loading state */}
      {!syncRunning && loading ? (
        <div className="flex h-20 items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading Telegram conversations...
        </div>
      ) : !syncRunning ? (
        <div className="space-y-2">
          {showPrivateSection && privateCategory ? (
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
              renderIcon={() => <Lock className="h-4 w-4 text-muted-foreground" />}
              chevronDirection="down"
            />
          ) : null}

          {showGroupsSection && groupsCategory ? (
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
              renderIcon={() => <Users className="h-4 w-4 text-muted-foreground" />}
            />
          ) : null}

          {showChannelsSection && channelsCategory ? (
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
              renderIcon={() => <Hash className="h-4 w-4 text-muted-foreground" />}
            />
          ) : null}

          {hasSearchQuery && !hasAnySearchResults ? (
            <div className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
              No conversations match your search.
            </div>
          ) : null}

          {/* Load more button */}
          {hasMore && !hasSearchQuery && (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => fetchConversations({ append: true })}
              disabled={loadingMore}
            >
              {loadingMore ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Loading...
                </>
              ) : (
                `Load more (${total - offset + PAGE_SIZE} remaining)`
              )}
            </Button>
          )}
        </div>
      ) : null}

      {/* Time period picker */}
      {!syncRunning && (
        <div>
          <label className="text-sm font-medium mb-2 block">Sync messages from</label>
          <Popover open={isDatePickerOpen} onOpenChange={setIsDatePickerOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-full justify-start gap-2 bg-transparent">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">
                  {customDate
                    ? customDate.toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })
                    : TIME_PERIODS.find((p) => p.value === selectedTimePeriod)?.label ||
                      'Last 7 days'}
                </span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[280px] p-0" align="start">
              <div className="p-3 space-y-3">
                <div>
                  <p className="text-sm font-semibold mb-2">Ingestion start</p>
                  <div className="space-y-1">
                    {TIME_PERIODS.map((period) => (
                      <Button
                        key={period.value}
                        variant={
                          selectedTimePeriod === period.value && !customDate
                            ? 'secondary'
                            : 'ghost'
                        }
                        size="sm"
                        className="w-full justify-start"
                        onClick={() => {
                          setSelectedTimePeriod(period.value);
                          setCustomDate(undefined);
                          setIsCustomDateExpanded(false);
                          setIsDatePickerOpen(false);
                        }}
                      >
                        {period.label}
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="border-t pt-3">
                  <button
                    onClick={() => setIsCustomDateExpanded((prev) => !prev)}
                    className="flex items-center justify-between w-full text-sm font-semibold mb-2 hover:text-foreground/80 transition-colors"
                  >
                    <span>Custom start date</span>
                    <ChevronRight
                      className={cn(
                        'h-4 w-4 transition-transform',
                        isCustomDateExpanded && 'rotate-90',
                      )}
                    />
                  </button>
                  {isCustomDateExpanded && (
                    <CalendarComponent
                      mode="single"
                      selected={customDate}
                      onSelect={(date) => {
                        setSelectedTimePeriod('custom');
                        setCustomDate(date ?? undefined);
                        setIsDatePickerOpen(false);
                      }}
                      disabled={(date) => date > new Date()}
                      className="rounded-md"
                    />
                  )}
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      )}

      {/* Sync Settings */}
      {!syncRunning && (
        <div className="border rounded-lg overflow-hidden">
          <button
            onClick={() => setShowSyncSettings(!showSyncSettings)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition"
          >
            <div className="flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Sync Settings</span>
            </div>
            <ChevronRight
              className={cn(
                'h-4 w-4 text-muted-foreground transition-transform',
                showSyncSettings && 'rotate-90',
              )}
            />
          </button>

          {showSyncSettings && (
            <div className="px-4 pb-4 space-y-3 border-t pt-3">
              {/* Unread auto-discovery */}
              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <span className="text-sm">Auto-sync unread chats</span>
                  <p className="text-xs text-muted-foreground">
                    Automatically sync new unread conversations
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={filters.sync_unread_only}
                  onChange={(e) => setFilters({ ...filters, sync_unread_only: e.target.checked })}
                  className="w-4 h-4 rounded border-input"
                />
              </label>

              {/* Type filters - only visible when unread discovery is on */}
              {filters.sync_unread_only && (
                <div className="pl-4 space-y-2 border-l">
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-sm text-muted-foreground">Include DMs</span>
                    <input
                      type="checkbox"
                      checked={filters.include_dms}
                      onChange={(e) => setFilters({ ...filters, include_dms: e.target.checked })}
                      className="w-4 h-4 rounded border-input"
                    />
                  </label>
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-sm text-muted-foreground">Include groups</span>
                    <input
                      type="checkbox"
                      checked={filters.include_groups}
                      onChange={(e) =>
                        setFilters({ ...filters, include_groups: e.target.checked })
                      }
                      className="w-4 h-4 rounded border-input"
                    />
                  </label>
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-sm text-muted-foreground">Include channels</span>
                    <input
                      type="checkbox"
                      checked={filters.include_channels}
                      onChange={(e) =>
                        setFilters({ ...filters, include_channels: e.target.checked })
                      }
                      className="w-4 h-4 rounded border-input"
                    />
                  </label>
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-sm text-muted-foreground">Include muted</span>
                    <input
                      type="checkbox"
                      checked={filters.include_muted}
                      onChange={(e) =>
                        setFilters({ ...filters, include_muted: e.target.checked })
                      }
                      className="w-4 h-4 rounded border-input"
                    />
                  </label>
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-sm text-muted-foreground">Include archived</span>
                    <input
                      type="checkbox"
                      checked={filters.include_archived}
                      onChange={(e) =>
                        setFilters({ ...filters, include_archived: e.target.checked })
                      }
                      className="w-4 h-4 rounded border-input"
                    />
                  </label>
                </div>
              )}

              {/* Mark unread after sync */}
              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <span className="text-sm">Mark unread after sync</span>
                  <p className="text-xs text-muted-foreground">
                    Keep messages unread in Telegram app
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={filters.mark_unread_after_sync}
                  onChange={(e) =>
                    setFilters({ ...filters, mark_unread_after_sync: e.target.checked })
                  }
                  className="w-4 h-4 rounded border-input"
                />
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
