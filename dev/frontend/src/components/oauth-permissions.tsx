import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Calendar, ChevronRight, Hash, Loader2, Lock, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { integrationAPI, type SlackConversation } from '@/lib/api';
import type { SlackWorkflowConfig, Workflow } from '@/types';
import { ConversationListSection } from '@/components/connectors/ConversationListSection';
import { TIME_PERIODS } from '@/lib/conversationConfigUtils';
import { useTimePeriodSelection } from '@/hooks/useTimePeriodSelection';
import { useConversationCategories } from '@/hooks/useConversationCategories';

interface OAuthPermissionsProps {
  workflow: Workflow | null;
  onClose: () => void;
  onSaved: () => void;
}

export function OAuthPermissions({ workflow, onClose, onSaved }: OAuthPermissionsProps) {
  const workflowConfig = useMemo(
    () => (workflow?.config || {}) as Partial<SlackWorkflowConfig>,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workflow?.config ? JSON.stringify(workflow.config) : ''],
  );

  // State for backend config (loaded from YAML)
  const [backendWhitelist, setBackendWhitelist] = useState<string[]>([]);

  const initialSelectedIds = useMemo(() => {
    // First check workflow config, then backend config
    const workflowInclude = workflowConfig.conversation_filters?.include ?? [];
    if (workflowInclude.length > 0) {
      return new Set(workflowInclude.map(String));
    }
    // Fall back to backend config whitelist
    if (backendWhitelist.length > 0) {
      return new Set(backendWhitelist);
    }
    return new Set<string>();
  }, [workflowConfig.conversation_filters?.include?.join(','), backendWhitelist.join(',')]);

  const initialLookbackDays = useMemo(() => {
    return workflowConfig.initial_lookback_days ?? 7;
  }, [workflowConfig.initial_lookback_days]);

  const [channels, setChannels] = useState<SlackConversation[]>([]);
  const [directMessages, setDirectMessages] = useState<SlackConversation[]>([]);
  const [teamId, setTeamId] = useState<string>(workflowConfig.team_id ?? '');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

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
    selectionInitialized,
  } = useConversationCategories({
    categories: [
      { key: 'channels', conversations: channels, defaultOpen: true },
      { key: 'dms', conversations: directMessages, defaultOpen: false },
    ],
    initialSelectedIds,
    loading,
  });

  const fetchConversations = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch conversations and saved config in parallel
      const [data, savedConfig] = await Promise.all([
        integrationAPI.listSlackConversations(),
        integrationAPI.getSlackConfig(),
      ]);

      // Store team_id from API response
      if (data.team_id) {
        setTeamId(data.team_id);
      }

      const fetchedChannels = [...data.public_channels, ...data.private_channels].sort((a, b) =>
        a.name.localeCompare(b.name),
      );
      const fetchedDms = [...data.dms].sort((a, b) => a.name.localeCompare(b.name));

      setChannels(fetchedChannels);
      setDirectMessages(fetchedDms);

      // Store backend whitelist for initial selection
      if (savedConfig.whitelist_ids.length > 0) {
        setBackendWhitelist(savedConfig.whitelist_ids);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load Slack conversations';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  // Special handling for Slack: auto-select all channels when no previous selections
  useEffect(() => {
    if (!selectionInitialized) return;
    if (workflow !== null && initialSelectedIds.size > 0) return;

    const channelIds = channels.map((c) => c.id);
    if (channelIds.length > 0) {
      // Auto-select all channels by default (create mode or update mode with no saved selections)
      toggleAllInCategory('channels');
    }
  }, [selectionInitialized, workflow, initialSelectedIds.size, channels.length]);

  const handleSave = async () => {
    try {
      setSaving(true);
      setSaveError(null);

      const updatedConfig: SlackWorkflowConfig = {
        target_group_id: '',
        target_parent_document_id: '',
        initial_lookback_days: lookbackDays,
        conversation_filters: {
          include: allSelectedIds,
          exclude: [],
        },
        team_id: teamId,
      };

      // Save to backend config.yaml (persistent storage for sync script)
      const configResult = await integrationAPI.saveSlackConfig({
        include_conversations: allSelectedIds,
        lookback_days: lookbackDays,
      });

      if (!configResult.success) {
        throw new Error(configResult.message || 'Failed to save config');
      }

      // Extract service name from workflow name (e.g., "Slack ingestion" → "slack")
      // If workflow is null (create mode), default to 'slack'
      const serviceName = workflow
        ? workflow.name.toLowerCase().replace(' ingestion', '')
        : 'slack';

      // Call sync-workflows endpoint with service and config (for UI state)
      await integrationAPI.syncWorkflows({
        service_name: serviceName,
        config: updatedConfig,
        workflow_id: workflow?.id ?? undefined,
      });

      onSaved();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update workflow';
      setSaveError(message);
    } finally {
      setSaving(false);
    }
  };

  // Find category data
  const channelsCategory = categories.find((c) => c.key === 'channels');
  const dmsCategory = categories.find((c) => c.key === 'dms');

  const showChannelsSection =
    !hasSearchQuery || (channelsCategory && channelsCategory.filtered.length > 0);
  const showDmsSection = !hasSearchQuery || (dmsCategory && dmsCategory.filtered.length > 0);

  return (
    <Card className="w-full max-w-xl max-h-[85vh] flex flex-col overflow-hidden">
      <CardHeader className="space-y-4 pb-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center">
              <svg viewBox="0 0 24 24" className="h-8 w-8">
                <path
                  fill="#E01E5A"
                  d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z"
                />
                <path
                  fill="#36C5F0"
                  d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z"
                />
                <path
                  fill="#2EB67D"
                  d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z"
                />
                <path
                  fill="#ECB22E"
                  d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"
                />
              </svg>
            </div>
            <span className="text-xl font-semibold">Slack</span>
          </div>
          <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-1.5">
            <div className="flex h-5 w-5 items-center justify-center rounded bg-background text-xs font-medium">
              A
            </div>
            <span className="text-sm text-muted-foreground">Atlas&apos;s Workspace</span>
          </div>
        </div>

        <div>
          <h2 className="text-xl font-semibold text-balance">
            Allow &quot;Atlas&quot; to access these channels
          </h2>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 overflow-y-auto flex-1">
        <div>
          <label className="text-sm font-medium mb-2 block">Select channels</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search channels or DMs"
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
            <Button variant="outline" size="sm" onClick={fetchConversations}>
              Retry
            </Button>
          </div>
        ) : null}

        {loading ? (
          <div className="flex h-20 items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading Slack conversations...
          </div>
        ) : (
          <div className="space-y-2">
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
                renderIcon={(conversation) =>
                  conversation.type === 'private_channel' ? (
                    <Lock className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <Hash className="h-4 w-4 text-muted-foreground" />
                  )
                }
                chevronDirection="down"
              />
            ) : null}

            {showDmsSection && dmsCategory ? (
              <ConversationListSection
                title="Direct Messages"
                conversations={dmsCategory.filtered}
                selectedIds={dmsCategory.selected}
                selectedCount={dmsCategory.selectedCount}
                selectedLabel={(count) =>
                  `${count} ${count === 1 ? 'conversation' : 'conversations'} selected`
                }
                allSelected={dmsCategory.allSelected}
                toggleAll={() => toggleAllInCategory('dms')}
                onToggle={(id) => toggleConversation('dms', id)}
                emptyMessage="No direct messages available."
                isOpen={dmsCategory.isOpen}
                onOpenChange={() => toggleCategoryOpen('dms')}
                renderIcon={() => <Lock className="h-4 w-4 text-muted-foreground" />}
              />
            ) : null}

            {hasSearchQuery && !hasAnySearchResults ? (
              <div className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
                No conversations match your search.
              </div>
            ) : null}
          </div>
        )}

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
            className="flex-1 bg-[#1a1d29] hover:bg-[#1a1d29]/90 text-white"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {workflow === null ? 'Create Workflow' : 'Update Workflow'}
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
