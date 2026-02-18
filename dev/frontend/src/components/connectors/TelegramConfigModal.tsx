import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { integrationAPI, workflowAPI, type TelegramConversation } from '@/lib/api';
import type { ConversationWorkflowConfig, TelegramFilters, TelegramFolder, Workflow } from '@/types';
import { ConversationListSection } from '@/components/connectors/ConversationListSection';
import telegramIcon from '@/assets/telegramIcon.svg';
import { TIME_PERIODS } from '@/lib/conversationConfigUtils';
import { useTimePeriodSelection } from '@/hooks/useTimePeriodSelection';
import { useConversationCategories } from '@/hooks/useConversationCategories';

interface TelegramConfigModalProps {
  workflow: Workflow | null;
  onClose: () => void;
  onSaved: () => void;
}

const DEFAULT_FILTERS: TelegramFilters = {
  sync_unread_only: true,
  include_dms: true,
  include_groups: true,
  include_channels: false,
  include_muted: false,
  include_archived: false,
  mark_unread_after_sync: true,
};

export function TelegramConfigModal({ workflow, onClose, onSaved }: TelegramConfigModalProps) {
  const workflowConfig = useMemo(
    () => (workflow?.config || {}) as Partial<ConversationWorkflowConfig>,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workflow?.config ? JSON.stringify(workflow.config) : ''],
  );

  // State for backend config (fetched from server)
  const [backendWhitelistIds, setBackendWhitelistIds] = useState<string[]>([]);
  const [backendLookbackDays, setBackendLookbackDays] = useState<number | null>(null);

  // Merge workflow config with backend whitelist - backend takes precedence
  const initialSelectedIds = useMemo(() => {
    // Prefer backend whitelist if available, otherwise fall back to workflow config
    if (backendWhitelistIds.length > 0) {
      return new Set(backendWhitelistIds);
    }
    const include = workflowConfig.conversation_filters?.include ?? [];
    return new Set(include.map(String));
  }, [backendWhitelistIds, workflowConfig.conversation_filters?.include?.join(',')]);

  const initialLookbackDays = useMemo(() => {
    // Prefer backend lookback days if available
    if (backendLookbackDays !== null) {
      return backendLookbackDays;
    }
    return workflowConfig.initial_lookback_days ?? 7;
  }, [backendLookbackDays, workflowConfig.initial_lookback_days]);

  const [privateConversations, setPrivateConversations] = useState<TelegramConversation[]>([]);
  const [groupConversations, setGroupConversations] = useState<TelegramConversation[]>([]);
  const [channelConversations, setChannelConversations] = useState<TelegramConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Sync settings state
  const [showSyncSettings, setShowSyncSettings] = useState(false);
  const [filters, setFilters] = useState<TelegramFilters>(DEFAULT_FILTERS);

  // Folder and pagination state
  const [folders, setFolders] = useState<TelegramFolder[]>([]);
  const [activeFolderId, setActiveFolderId] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const PAGE_SIZE = 100;

  // Use shared time period selection hook
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

  // Use shared conversation categories hook
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

  const fetchConversations = useCallback(async (options?: { append?: boolean }) => {
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

      // Fetch conversations and config in parallel (folders loaded separately)
      const [data, config] = await Promise.all([
        integrationAPI.listTelegramConversations({
          limit: PAGE_SIZE,
          offset: currentOffset,
          folderId: activeFolderId ?? undefined,
        }),
        currentOffset === 0 ? integrationAPI.getTelegramConfig() : Promise.resolve(null),
      ]);

      // Set backend config first (before setting loading=false)
      if (config) {
        setBackendWhitelistIds(config.whitelist_ids);
        setBackendLookbackDays(config.lookback_days);
      }

      // Update pagination state
      setHasMore(data.has_more ?? false);
      setTotal(data.total ?? 0);
      setOffset(currentOffset + PAGE_SIZE);

      const sortByDate = (a: TelegramConversation, b: TelegramConversation) => {
        if (!a.last_message_date) return 1;
        if (!b.last_message_date) return -1;
        return new Date(b.last_message_date).getTime() - new Date(a.last_message_date).getTime();
      };

      const newPrivate = [...data.private].sort(sortByDate);
      const newGroups = [...data.groups].sort(sortByDate);
      const newChannels = [...data.channels].sort(sortByDate);

      if (append) {
        // Append to existing lists
        setPrivateConversations((prev) => [...prev, ...newPrivate]);
        setGroupConversations((prev) => [...prev, ...newGroups]);
        setChannelConversations((prev) => [...prev, ...newChannels]);
      } else {
        setPrivateConversations(newPrivate);
        setGroupConversations(newGroups);
        setChannelConversations(newChannels);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load Telegram conversations';
      setError(message);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [activeFolderId, offset]);

  // Load folders and filters separately (non-blocking)
  useEffect(() => {
    integrationAPI.listTelegramFolders().then(setFolders).catch(() => {
      // Folders are optional - ignore errors
    });
    integrationAPI.getTelegramFilters().then(setFilters).catch(() => {
      // Filters optional - use defaults on error
    });
  }, []);

  useEffect(() => {
    fetchConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refetch when folder changes
  const handleFolderChange = useCallback((folderId: number | null) => {
    setActiveFolderId(folderId);
  }, []);

  useEffect(() => {
    if (activeFolderId !== null || offset === 0) {
      // Skip the initial mount - fetchConversations already runs
      return;
    }
  }, [activeFolderId, offset]);

  // Refetch when folder changes
  useEffect(() => {
    // Skip initial mount
    const isInitialMount = activeFolderId === null && offset === 0;
    if (!isInitialMount && activeFolderId !== undefined) {
      fetchConversations();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFolderId]);

  const handleSave = async () => {
    try {
      setSaving(true);
      setSaveError(null);

      const updatedConfig: ConversationWorkflowConfig = {
        target_group_id: '',
        target_parent_document_id: '',
        initial_lookback_days: lookbackDays,
        conversation_filters: {
          include: allSelectedIds,
          exclude: [],
        },
      };

      if (!workflow?.id) {
        throw new Error('No Telegram workflow found. Please refresh and try again.');
      }

      // Save to local workflow storage
      await workflowAPI.updateWorkflow(workflow.id, { config: updatedConfig });

      // Build conversation details from selected IDs (avoids re-fetching on backend)
      const allConversations = [...privateConversations, ...groupConversations, ...channelConversations];
      const selectedSet = new Set(allSelectedIds);
      const conversationDetails = allConversations
        .filter((c) => selectedSet.has(c.id))
        .map((c) => ({ id: c.id, name: c.name, type: c.type }));

      // Also persist to backend
      const backendResult = await integrationAPI.saveTelegramConfig({
        include_conversations: allSelectedIds,
        lookback_days: lookbackDays,
        conversation_details: conversationDetails,
      });

      if (!backendResult.success) {
        console.warn('Failed to save config to backend:', backendResult.message);
        // Don't fail the save - local storage was updated successfully
      }

      // Save sync filters
      const filtersResult = await integrationAPI.saveTelegramFilters(filters);
      if (!filtersResult.success) {
        console.warn('Failed to save filters to backend');
      }

      onSaved();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update workflow';
      setSaveError(message);
    } finally {
      setSaving(false);
    }
  };

  const canSave = workflow !== null;

  // Find category data
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
    <Card className="w-full max-w-xl max-h-[85vh] flex flex-col overflow-hidden bg-background border-border">
      <CardHeader className="space-y-4 pb-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center">
              <img src={telegramIcon} alt="Telegram" className="h-8 w-8" />
            </div>
            <span className="text-xl font-semibold">Telegram</span>
          </div>
        </div>

        <div>
          <h2 className="text-xl font-semibold text-balance">Select conversations to sync</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Choose which private chats, groups, and channels to import
          </p>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 overflow-y-auto flex-1">
        {/* Folder chips */}
        {folders.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant={activeFolderId === null ? 'secondary' : 'outline'}
              size="sm"
              className="rounded-full h-7 text-xs"
              onClick={() => handleFolderChange(null)}
            >
              All
            </Button>
            {folders.map((folder) => (
              <Button
                key={folder.id}
                variant={activeFolderId === folder.id ? 'secondary' : 'outline'}
                size="sm"
                className="rounded-full h-7 text-xs"
                onClick={() => handleFolderChange(folder.id)}
              >
                {folder.title}
                {folder.count > 0 && (
                  <span className="ml-1 text-muted-foreground">({folder.count})</span>
                )}
              </Button>
            ))}
          </div>
        )}

        <div>
          <label className="text-sm font-medium mb-2 block">Search conversations</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search conversations"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="pl-9"
              disabled={loading}
            />
          </div>
        </div>

        {error ? (
          <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <div className="flex-1 text-destructive">{error}</div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void fetchConversations();
              }}
            >
              Retry
            </Button>
          </div>
        ) : null}

        {!workflow ? (
          <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
            Telegram is connected, but the workflow record is still provisioning. Please close this
            dialog and try again once the connection finishes syncing.
          </div>
        ) : null}

        {loading ? (
          <div className="flex h-20 items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading Telegram conversations...
          </div>
        ) : (
          <div className="space-y-2">
            {showPrivateSection && privateCategory ? (
              <ConversationListSection
                title="Private Chats"
                conversations={privateCategory.filtered}
                selectedIds={privateCategory.selected}
                selectedCount={privateCategory.selectedCount}
                selectedLabel={(count) => `${count} ${count === 1 ? 'chat' : 'chats'} selected`}
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
                selectedLabel={(count) => `${count} ${count === 1 ? 'group' : 'groups'} selected`}
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
                selectedLabel={(count) =>
                  `${count} ${count === 1 ? 'channel' : 'channels'} selected`
                }
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
                  `Load ${PAGE_SIZE} more conversations (${total - offset + PAGE_SIZE} remaining)`
                )}
              </Button>
            )}
          </div>
        )}

        {/* Sync Settings */}
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
                showSyncSettings && 'rotate-90'
              )}
            />
          </button>

          {showSyncSettings && (
            <div className="px-4 pb-4 space-y-3 border-t pt-3">
              {/* Unread auto-discovery */}
              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <span className="text-sm">Auto-sync unread chats</span>
                  <p className="text-xs text-muted-foreground">Automatically sync new unread conversations</p>
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
                      onChange={(e) => setFilters({ ...filters, include_groups: e.target.checked })}
                      className="w-4 h-4 rounded border-input"
                    />
                  </label>
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-sm text-muted-foreground">Include channels</span>
                    <input
                      type="checkbox"
                      checked={filters.include_channels}
                      onChange={(e) => setFilters({ ...filters, include_channels: e.target.checked })}
                      className="w-4 h-4 rounded border-input"
                    />
                  </label>
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-sm text-muted-foreground">Include muted</span>
                    <input
                      type="checkbox"
                      checked={filters.include_muted}
                      onChange={(e) => setFilters({ ...filters, include_muted: e.target.checked })}
                      className="w-4 h-4 rounded border-input"
                    />
                  </label>
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-sm text-muted-foreground">Include archived</span>
                    <input
                      type="checkbox"
                      checked={filters.include_archived}
                      onChange={(e) => setFilters({ ...filters, include_archived: e.target.checked })}
                      className="w-4 h-4 rounded border-input"
                    />
                  </label>
                </div>
              )}

              {/* Mark unread after sync */}
              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <span className="text-sm">Mark unread after sync</span>
                  <p className="text-xs text-muted-foreground">Keep messages unread in Telegram app</p>
                </div>
                <input
                  type="checkbox"
                  checked={filters.mark_unread_after_sync}
                  onChange={(e) => setFilters({ ...filters, mark_unread_after_sync: e.target.checked })}
                  className="w-4 h-4 rounded border-input"
                />
              </label>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 pt-2">
          <Popover open={isDatePickerOpen} onOpenChange={setIsDatePickerOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" className="flex-1 justify-start gap-2 bg-transparent">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">
                  {customDate
                    ? customDate.toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })
                    : TIME_PERIODS.find((period) => period.value === selectedTimePeriod)?.label ||
                      'Select start'}
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
                          selectedTimePeriod === period.value && !customDate ? 'secondary' : 'ghost'
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

          <Button variant="outline" className="flex-1" onClick={onClose} disabled={saving}>
            Cancel
          </Button>

          <Button
            className="flex-1 bg-[#0088cc] hover:bg-[#0088cc]/90 text-white"
            onClick={handleSave}
            disabled={saving || !canSave}
          >
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Update Workflow
          </Button>
        </div>

        {saveError ? (
          <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" />
            <span>{saveError}</span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
