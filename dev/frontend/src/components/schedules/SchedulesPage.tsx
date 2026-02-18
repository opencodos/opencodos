import { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ArrowLeft,
  Clock,
  Play,
  Pause,
  RefreshCw,
  XCircle,
  Loader2,
  Calendar,
} from 'lucide-react';
import { SERVICE_ICONS } from '@/components/connectors/service-icons';
import { API_BASE_URL } from '@/lib/api';
import { SyncProgressModal } from './SyncProgressModal';

interface SchedulePreset {
  id: string;
  label: string;
  description: string;
}

interface InstalledSchedule {
  connector: string;
  name: string;
  preset_id: string | null;
  preset_label: string | null;
  is_active: boolean;
  last_sync: string | null;
  next_sync: string | null;
  supports_sync: boolean;
}

interface ConnectorPresets {
  connector: string;
  name: string;
  default_preset: string;
  presets: SchedulePreset[];
  supports_sync: boolean;
}

interface PresetsResponse {
  connectors: ConnectorPresets[];
}

interface InstalledResponse {
  schedules: InstalledSchedule[];
}

const CONNECTOR_NAMES: Record<string, string> = {
  telegram: 'Telegram',
  slack: 'Slack',
  gmail: 'Gmail',
  calendar: 'Google Calendar',
  googlecalendar: 'Google Calendar',
  notion: 'Notion',
  linear: 'Linear',
  googledrive: 'Google Drive',
  gdrive: 'Google Drive',
  granola: 'Granola',
  github: 'GitHub',
};

function getRelativeTime(dateString: string | null): string | null {
  if (!dateString) return null;

  const date = new Date(dateString);
  if (isNaN(date.getTime())) return null;

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const isPast = diffMs > 0;
  const absDiffMs = Math.abs(diffMs);

  const absDiffMins = Math.floor(absDiffMs / 60000);
  if (absDiffMins < 1) return isPast ? 'just now' : 'in a moment';
  if (absDiffMins < 60) {
    return isPast ? `${absDiffMins} min ago` : `in ${absDiffMins} min`;
  }

  const absDiffHours = Math.floor(absDiffMins / 60);
  if (absDiffHours < 24) {
    return isPast
      ? `${absDiffHours} hour${absDiffHours > 1 ? 's' : ''} ago`
      : `in ${absDiffHours} hour${absDiffHours > 1 ? 's' : ''}`;
  }

  const absDiffDays = Math.floor(absDiffHours / 24);
  return isPast
    ? `${absDiffDays} day${absDiffDays > 1 ? 's' : ''} ago`
    : `in ${absDiffDays} day${absDiffDays > 1 ? 's' : ''}`;
}

function getAbsoluteTime(dateString: string | null): string | null {
  if (!dateString) return null;

  const date = new Date(dateString);
  if (isNaN(date.getTime())) return null;

  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function SchedulesPage() {
  const [installedSchedules, setInstalledSchedules] = useState<InstalledSchedule[]>([]);
  const [presets, setPresets] = useState<ConnectorPresets[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('all');

  // Action states
  const [updatingConnector, setUpdatingConnector] = useState<string | null>(null);
  const [disablingConnector, setDisablingConnector] = useState<string | null>(null);

  // Sync modal state
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [syncConnector, setSyncConnector] = useState<string | null>(null);
  const [syncConnectorName, setSyncConnectorName] = useState<string>('');

  // Telegram filter state
  const [telegramFilters, setTelegramFilters] = useState({
    sync_unread_only: false,
    include_dms: true,
    include_groups: true,
    include_channels: false,
    include_muted: false,
    include_archived: false,
    mark_unread_after_sync: false,
  });
  const [filtersLoading, setFiltersLoading] = useState(false);
  const [filtersSaving, setFiltersSaving] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setError(null);

      const [installedRes, presetsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/setup/schedules/installed`),
        fetch(`${API_BASE_URL}/api/setup/schedules/presets`),
      ]);

      if (!installedRes.ok) {
        throw new Error('Failed to fetch installed schedules');
      }
      if (!presetsRes.ok) {
        throw new Error('Failed to fetch schedule presets');
      }

      const installedData: InstalledResponse = await installedRes.json();
      const presetsData: PresetsResponse = await presetsRes.json();

      setInstalledSchedules(installedData.schedules || []);
      setPresets(presetsData.connectors || []);
    } catch (err) {
      console.error('Error fetching schedules:', err);
      setError(err instanceof Error ? err.message : 'Failed to load schedules');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const fetchTelegramFilters = useCallback(async () => {
    try {
      setFiltersLoading(true);
      const res = await fetch(`${API_BASE_URL}/api/setup/schedules/telegram/filters`);
      if (res.ok) {
        const data = await res.json();
        setTelegramFilters(data);
      }
    } catch (err) {
      console.error('Error fetching telegram filters:', err);
    } finally {
      setFiltersLoading(false);
    }
  }, []);

  const saveTelegramFilters = async (newFilters: typeof telegramFilters) => {
    try {
      setFiltersSaving(true);
      const res = await fetch(`${API_BASE_URL}/api/setup/schedules/telegram/filters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newFilters),
      });
      if (res.ok) {
        setTelegramFilters(newFilters);
      }
    } catch (err) {
      console.error('Error saving telegram filters:', err);
    } finally {
      setFiltersSaving(false);
    }
  };

  const handleFilterChange = (key: keyof typeof telegramFilters, value: boolean) => {
    const newFilters = { ...telegramFilters, [key]: value };
    saveTelegramFilters(newFilters);
  };

  useEffect(() => {
    fetchTelegramFilters();
  }, [fetchTelegramFilters]);

  const handleRunNow = async (connector: string, connectorName: string) => {
    setSyncConnector(connector);
    setSyncConnectorName(connectorName);
    setSyncModalOpen(true);
  };

  const handleSyncModalClose = () => {
    setSyncModalOpen(false);
    setSyncConnector(null);
    setSyncConnectorName('');
    // Refresh data after sync completes
    fetchData();
  };

  const handleChangeSchedule = async (connector: string, presetId: string) => {
    try {
      setUpdatingConnector(connector);
      setError(null);

      const response = await fetch(`${API_BASE_URL}/api/setup/schedules/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selections: [{ connector, preset_id: presetId }],
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update schedule');
      }

      // Refresh data
      await fetchData();
    } catch (err) {
      console.error('Error updating schedule:', err);
      setError(err instanceof Error ? err.message : 'Failed to update schedule');
    } finally {
      setUpdatingConnector(null);
    }
  };

  const handleDisable = async (connector: string) => {
    try {
      setDisablingConnector(connector);
      setError(null);

      const response = await fetch(`${API_BASE_URL}/api/setup/schedules/${connector}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to disable schedule');
      }

      // Refresh data
      await fetchData();
    } catch (err) {
      console.error('Error disabling schedule:', err);
      setError(err instanceof Error ? err.message : 'Failed to disable schedule');
    } finally {
      setDisablingConnector(null);
    }
  };


  const getPresetsForConnector = (connector: string): SchedulePreset[] => {
    const connectorPresets = presets.find((p) => p.connector === connector);
    return connectorPresets?.presets || [];
  };

  const getScheduleStatus = (
    schedule: InstalledSchedule
  ): 'active' | 'inactive' | 'not-set' => {
    if (!schedule.supports_sync) return 'not-set';
    if (!schedule.preset_id) return 'not-set';
    return schedule.is_active ? 'active' : 'inactive';
  };

  // Filter schedules
  const filteredSchedules = installedSchedules.filter((schedule) => {
    const status = getScheduleStatus(schedule);

    if (activeFilter === 'all') return true;
    if (activeFilter === 'active') return status === 'active';
    if (activeFilter === 'inactive') return status === 'inactive' || status === 'not-set';

    return true;
  });

  // Loading state
  if (loading) {
    return (
      <div className="w-full h-full overflow-auto">
        <div className="p-6 space-y-6">
          {/* Header skeleton */}
          <div className="space-y-2">
            <Skeleton className="h-8 w-8" />
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-5 w-96" />
          </div>

          {/* Filter tabs skeleton */}
          <Skeleton className="h-10 w-64" />

          {/* Cards skeleton */}
          <div className="space-y-4">
            {[...Array(4)].map((_, i) => (
              <Card key={i} className="p-6 shadow-none">
                <div className="flex items-start gap-4">
                  <Skeleton className="h-10 w-10 rounded-lg" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-4 w-64" />
                  </div>
                  <div className="flex gap-2">
                    <Skeleton className="h-9 w-32" />
                    <Skeleton className="h-9 w-24" />
                    <Skeleton className="h-9 w-20" />
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full overflow-auto">
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="space-y-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => (window.location.hash = '#/connectors')}
            className="gap-2 -ml-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Connectors
          </Button>

          <div className="space-y-2">
            <h1 className="text-2xl font-semibold leading-8">Schedules</h1>
            <p className="text-base font-normal leading-5 text-[#737373]">
              Manage automatic sync schedules for your connectors
            </p>
          </div>
        </div>

        {/* Error alert */}
        {error && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Filter tabs */}
        <Tabs
          value={activeFilter}
          onValueChange={(value) => setActiveFilter(value as typeof activeFilter)}
        >
          <TabsList className="bg-transparent border border-[#E5E7EB] rounded-lg p-1 h-10">
            <TabsTrigger
              value="all"
              className="data-[state=active]:bg-[#F5F5F5] shadow-none rounded-md px-3 py-1.5"
            >
              All
            </TabsTrigger>
            <TabsTrigger
              value="active"
              className="data-[state=active]:bg-[#F5F5F5] shadow-none rounded-md px-3 py-1.5"
            >
              Active
            </TabsTrigger>
            <TabsTrigger
              value="inactive"
              className="data-[state=active]:bg-[#F5F5F5] shadow-none rounded-md px-3 py-1.5"
            >
              Inactive
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Schedule cards */}
        <div className="space-y-4">
          {filteredSchedules.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">
                {activeFilter !== 'all'
                  ? 'No schedules match this filter.'
                  : 'No connectors available. Connect some services first.'}
              </p>
            </div>
          ) : (
            filteredSchedules.map((schedule) => {
              const IconComponent =
                SERVICE_ICONS[schedule.connector as keyof typeof SERVICE_ICONS];
              const status = getScheduleStatus(schedule);
              const connectorPresets = getPresetsForConnector(schedule.connector);
              const isUpdating = updatingConnector === schedule.connector;
              const isDisabling = disablingConnector === schedule.connector;
              const isRunning = syncModalOpen && syncConnector === schedule.connector;
              const isActioning = isUpdating || isDisabling || isRunning;

              return (
                <Card
                  key={schedule.connector}
                  className={`p-6 shadow-none ${!schedule.supports_sync ? 'opacity-60' : ''}`}
                >
                  <div className="flex items-start gap-4">
                    {/* Connector icon */}
                    <div className="flex-shrink-0">
                      {IconComponent ? (
                        <IconComponent
                          className={`h-10 w-10 ${!schedule.supports_sync ? 'grayscale' : ''}`}
                        />
                      ) : (
                        <div className="h-10 w-10 rounded-lg bg-secondary flex items-center justify-center">
                          <Calendar className="h-5 w-5 text-muted-foreground" />
                        </div>
                      )}
                    </div>

                    {/* Connector info */}
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-base font-medium text-foreground">
                          {schedule.name ||
                            CONNECTOR_NAMES[schedule.connector] ||
                            schedule.connector}
                        </span>

                        {/* Status badge */}
                        {!schedule.supports_sync ? (
                          <Badge variant="secondary" className="bg-gray-100 text-gray-600">
                            Coming Soon
                          </Badge>
                        ) : status === 'active' ? (
                          <Badge className="bg-green-100 text-green-700 border-green-200">
                            Active
                          </Badge>
                        ) : status === 'inactive' ? (
                          <Badge variant="secondary" className="bg-yellow-100 text-yellow-700 border-yellow-200">
                            Inactive
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">
                            Not Set
                          </Badge>
                        )}
                      </div>

                      {/* Schedule description */}
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        {schedule.preset_label && schedule.supports_sync && (
                          <span className="flex items-center gap-1.5">
                            <Clock className="h-3.5 w-3.5" />
                            {schedule.preset_label}
                          </span>
                        )}

                        {schedule.last_sync && (
                          <span>
                            Last sync: {getRelativeTime(schedule.last_sync)}
                          </span>
                        )}

                        {schedule.next_sync && schedule.is_active && (
                          <span>
                            Next sync: {getRelativeTime(schedule.next_sync)} ({getAbsoluteTime(schedule.next_sync)})
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {schedule.supports_sync ? (
                        <>
                          {/* Change Schedule dropdown */}
                          <Select
                            value={schedule.preset_id || ''}
                            onValueChange={(value) =>
                              handleChangeSchedule(schedule.connector, value)
                            }
                            disabled={isActioning}
                          >
                            <SelectTrigger className="w-[160px] h-9">
                              {isUpdating ? (
                                <div className="flex items-center gap-2">
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                  <span>Updating...</span>
                                </div>
                              ) : (
                                <SelectValue placeholder="Change Schedule" />
                              )}
                            </SelectTrigger>
                            <SelectContent>
                              {connectorPresets.map((preset) => (
                                <SelectItem key={preset.id} value={preset.id}>
                                  {preset.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>

                          {/* Run Now button */}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleRunNow(
                              schedule.connector,
                              schedule.name || CONNECTOR_NAMES[schedule.connector] || schedule.connector
                            )}
                            disabled={isActioning}
                            className="gap-1.5"
                          >
                            {isRunning ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Play className="h-4 w-4" />
                            )}
                            Run Now
                          </Button>

                          {/* Disable button */}
                          {schedule.is_active && schedule.preset_id && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleDisable(schedule.connector)}
                              disabled={isActioning}
                              className="gap-1.5 text-red-600 hover:text-red-700 hover:bg-red-50"
                            >
                              {isDisabling ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Pause className="h-4 w-4" />
                              )}
                              Disable
                            </Button>
                          )}
                        </>
                      ) : (
                        <span className="text-sm text-muted-foreground">
                          Sync not available
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Telegram Filter Settings */}
                  {schedule.connector === 'telegram' && schedule.supports_sync && (
                    <div className="mt-4 pt-4 border-t border-gray-200">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-sm font-medium text-gray-700">Sync Settings</span>
                        {(filtersLoading || filtersSaving) && (
                          <Loader2 className="h-3 w-3 animate-spin text-gray-400" />
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={telegramFilters.sync_unread_only}
                            onChange={(e) => handleFilterChange('sync_unread_only', e.target.checked)}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            disabled={filtersLoading || filtersSaving}
                          />
                          <span className="text-sm text-gray-600">Unread only</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={telegramFilters.mark_unread_after_sync}
                            onChange={(e) => handleFilterChange('mark_unread_after_sync', e.target.checked)}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            disabled={filtersLoading || filtersSaving}
                          />
                          <span className="text-sm text-gray-600">Keep unread after sync</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={telegramFilters.include_dms}
                            onChange={(e) => handleFilterChange('include_dms', e.target.checked)}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            disabled={filtersLoading || filtersSaving}
                          />
                          <span className="text-sm text-gray-600">Include DMs</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={telegramFilters.include_groups}
                            onChange={(e) => handleFilterChange('include_groups', e.target.checked)}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            disabled={filtersLoading || filtersSaving}
                          />
                          <span className="text-sm text-gray-600">Include Groups</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={telegramFilters.include_channels}
                            onChange={(e) => handleFilterChange('include_channels', e.target.checked)}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            disabled={filtersLoading || filtersSaving}
                          />
                          <span className="text-sm text-gray-600">Include Channels</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={telegramFilters.include_archived}
                            onChange={(e) => handleFilterChange('include_archived', e.target.checked)}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            disabled={filtersLoading || filtersSaving}
                          />
                          <span className="text-sm text-gray-600">Include Archived</span>
                        </label>
                      </div>
                    </div>
                  )}
                </Card>
              );
            })
          )}
        </div>

        {/* Refresh button */}
        <div className="flex justify-center pt-4">
          <Button
            variant="outline"
            onClick={fetchData}
            disabled={loading}
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Sync Progress Modal */}
      {syncConnector && (
        <SyncProgressModal
          connector={syncConnector}
          connectorName={syncConnectorName}
          isOpen={syncModalOpen}
          onClose={handleSyncModalClose}
        />
      )}
    </div>
  );
}
