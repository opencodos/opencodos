import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { integrationAPI, workflowAPI } from '@/lib/api';
import { isDesktopRuntimeAvailable, openExternalUrl } from '@/lib/desktopRuntime';
import type { Workflow } from '@/types';

// Helper to safely access conversation_filters from workflow config
function getChannelCount(config: Record<string, unknown> | undefined): number {
  if (!config || typeof config !== 'object') return 0;

  const filters = config.conversation_filters;
  if (!filters || typeof filters !== 'object') return 0;

  const include = (filters as { include?: unknown }).include;
  if (!Array.isArray(include)) return 0;

  return include.length;
}

function getTimeSince(dateString: string | null | undefined): string | null {
  if (!dateString) return null;
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return null;

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();

  // If date is in the future or less than 1 minute ago, it's likely a fallback/invalid
  if (diffMs < 60000) return null;

  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 60) return `${diffMins} min ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
}

import { WorkflowDetailModal } from '@/components/workflows/WorkflowDetailModal';
import { Loader2, XCircle, AlertTriangle, Search, Pencil, Unplug, Clock, ArrowLeft } from 'lucide-react';
import { TelegramAuthModal } from './TelegramAuthModal';
import { SERVICE_ICONS } from './service-icons';

interface Integration {
  service: string;
  name: string;
  description: string;
  icon: string;
}

interface ConnectedIntegration {
  service: string;
  account_id: string;
  status: string;
  connected_at: string;
  error?: string | null;
}

// Cache interfaces (matching DocumentContext pattern)
interface IntegrationsCache {
  available: Integration[];
  connected: ConnectedIntegration[];
  supportedServices: Set<string>;
  lastFetched: number;
}

interface WorkflowsCache {
  workflows: Workflow[];
  lastFetched: number;
}

// Cache TTL: 5 minutes (connectors only change on explicit user actions, which invalidate cache)
const CACHE_TTL = 5 * 60 * 1000;

// Module-level caches (persist across component mounts, like DocumentContext)
let integrationsCache: IntegrationsCache | null = null;
let workflowsCache: WorkflowsCache | null = null;

// Fallback list of all supported integrations
const FALLBACK_INTEGRATIONS: Integration[] = [
  {
    service: 'slack',
    name: 'Slack',
    description: 'Team communication',
    icon: 'message-square',
  },
  {
    service: 'telegram',
    name: 'Telegram',
    description: 'Messaging platform',
    icon: 'send',
  },
  {
    service: 'notion',
    name: 'Notion',
    description: 'Workspace management',
    icon: 'book',
  },
  {
    service: 'gmail',
    name: 'Gmail',
    description: 'Email management',
    icon: 'mail',
  },
  {
    service: 'googlecalendar',
    name: 'Google Calendar',
    description: 'Calendar management',
    icon: 'calendar',
  },
];

export function ConnectorsPage() {
  const [availableIntegrations, setAvailableIntegrations] =
    useState<Integration[]>(FALLBACK_INTEGRATIONS);
  const [connectedIntegrations, setConnectedIntegrations] = useState<ConnectedIntegration[]>([]);
  const [supportedServices, setSupportedServices] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [connectingService, setConnectingService] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showTelegramAuthModal, setShowTelegramAuthModal] = useState(false);
  const [slackWorkflow, setSlackWorkflow] = useState<Workflow | null>(null);
  const [slackModalOpen, setSlackModalOpen] = useState(false);
  const [loadingSlackWorkflow, setLoadingSlackWorkflow] = useState(false);
  const [telegramWorkflow, setTelegramWorkflow] = useState<Workflow | null>(null);
  const [telegramModalOpen, setTelegramModalOpen] = useState(false);
  const [loadingTelegramWorkflow, setLoadingTelegramWorkflow] = useState(false);
  const [hoveredError, setHoveredError] = useState<string | null>(null);
  const [disconnectingService, setDisconnectingService] = useState<string | null>(null);
  const [telegramChannelCount, setTelegramChannelCount] = useState<number>(0);
  const [telegramLastSync, setTelegramLastSync] = useState<string | null>(null);

  useEffect(() => {
    setConnectingService(null);
  }, []);

  // Filter and search state
  const [activeFilter, setActiveFilter] = useState<'all' | 'inactive' | 'active'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch available and connected integrations
  const fetchIntegrations = async (skipCache = false) => {
    const fetchAndUpdate = async (silent = false) => {
      try {
        if (!silent) {
          // Only show loading skeleton if we don't have cached data
          if (!integrationsCache) {
            setLoading(true);
          }
          setError(null);
        }

        const available = await integrationAPI.getAvailableIntegrations();

        // Track which services are supported by the backend
        const backendServices = new Set<string>(
          available.map((integration: Integration) => integration.service),
        );
        setSupportedServices(backendServices);

        // Merge backend integrations with fallback list
        const mergedIntegrations = [
          ...available,
          ...FALLBACK_INTEGRATIONS.filter((fallback) => !backendServices.has(fallback.service)),
        ];

        // Sort to prioritize Slack, Telegram, Notion first
        const priorityOrder = ['slack', 'telegram', 'notion'];
        const sortedIntegrations = mergedIntegrations.sort((a, b) => {
          const aIndex = priorityOrder.indexOf(a.service);
          const bIndex = priorityOrder.indexOf(b.service);

          // If both are priority services, sort by priority order
          if (aIndex !== -1 && bIndex !== -1) {
            return aIndex - bIndex;
          }

          // If only a is priority, it comes first
          if (aIndex !== -1) return -1;

          // If only b is priority, it comes first
          if (bIndex !== -1) return 1;

          // Otherwise maintain original order
          return 0;
        });

        setAvailableIntegrations(sortedIntegrations);

        // Fetch connected integrations
        const connected = await integrationAPI.getConnectedIntegrations();
        console.log('[ConnectorsPage] Connected integrations:', connected);
        setConnectedIntegrations(connected);

        // Fetch Telegram config for channel count and last sync (if Telegram is connected)
        if (connected.some((c: ConnectedIntegration) => c.service === 'telegram')) {
          try {
            const [telegramConfig, telegramSync] = await Promise.all([
              integrationAPI.getTelegramConfig(),
              integrationAPI.getTelegramLastSync(),
            ]);
            setTelegramChannelCount(telegramConfig.whitelist_ids?.length || 0);
            setTelegramLastSync(telegramSync.last_sync_iso);
          } catch {
            // Ignore errors fetching telegram config
          }
        }

        // Update module-level cache
        integrationsCache = {
          available: sortedIntegrations,
          connected,
          supportedServices: backendServices,
          lastFetched: Date.now(),
        };
      } catch (err) {
        if (!silent) {
          console.error('Error fetching integrations:', err);
          setError(err instanceof Error ? err.message : 'Failed to load integrations from server');

          // Still show fallback integrations even if backend fails
          setAvailableIntegrations(FALLBACK_INTEGRATIONS);
        }
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    };

    // Check cache first (if not forcing refresh)
    if (!skipCache && integrationsCache) {
      const now = Date.now();
      const cacheAge = now - integrationsCache.lastFetched;
      const hasCachedErrors = integrationsCache.connected.some(
        (integration) => integration.error,
      );

      if (cacheAge < CACHE_TTL && !hasCachedErrors) {
        console.log('[ConnectorsPage] Using cached integrations data');
        setAvailableIntegrations(integrationsCache.available);
        setConnectedIntegrations(integrationsCache.connected);
        setSupportedServices(integrationsCache.supportedServices);
        setLoading(false);
        void fetchAndUpdate(true);
        return;
      }
    }

    await fetchAndUpdate(false);
  };

  const openSlackWorkflowModal = async (workflowId: number | null) => {
    console.log('[Connectors] Loading Slack workflow config modal for workflow', workflowId);
    try {
      setLoadingSlackWorkflow(true);

      // If workflowId is provided, fetch existing workflow
      // If null, open modal with no workflow (create mode)
      if (workflowId !== null) {
        const workflow = await workflowAPI.get(workflowId);
        console.log('[Connectors] Loaded workflow details', workflow);
        setSlackWorkflow(workflow);
      } else {
        console.log('[Connectors] Opening modal in create mode (no workflow)');
        setSlackWorkflow(null);
      }

      setSlackModalOpen(true);
    } catch (err) {
      console.error('Error loading Slack workflow for configuration:', err);
    } finally {
      setLoadingSlackWorkflow(false);
    }
  };

  const openTelegramWorkflowModal = async (workflowId: number | null) => {
    console.log('[Connectors] Loading Telegram workflow config modal for workflow', workflowId);
    try {
      setLoadingTelegramWorkflow(true);

      // If workflowId is provided, fetch existing workflow
      // If null, open modal with no workflow (create mode)
      if (workflowId !== null) {
        const workflow = await workflowAPI.get(workflowId);
        console.log('[Connectors] Loaded workflow details', workflow);
        setTelegramWorkflow(workflow);
      } else {
        console.log('[Connectors] Opening modal in create mode (no workflow)');
        setTelegramWorkflow(null);
      }

      setTelegramModalOpen(true);
    } catch (err) {
      console.error('Error loading Telegram workflow for configuration:', err);
    } finally {
      setLoadingTelegramWorkflow(false);
    }
  };

  // Connect to a service
  const handleConnect = async (service: string) => {
    try {
      setConnectingService(service);
      setError(null);

      // Special handling for Telegram (QR code auth instead of OAuth popup)
      if (service === 'telegram') {
        setShowTelegramAuthModal(true);
        setConnectingService(null); // Clear immediately since modal handles the flow
        return;
      }

      const result = await integrationAPI.connectIntegration(service);

      // Open OAuth URL — prefer Tauri command (opens in default browser),
      // fall back to window.open() for browser-only mode.
      let popupRef: Window | null = null;
      if (isDesktopRuntimeAvailable()) {
        try {
          await openExternalUrl(result.redirect_url);
        } catch {
          setError('Failed to open browser. Please try again.');
          setConnectingService(null);
          return;
        }
      } else {
        popupRef = window.open(
          result.redirect_url,
          '_blank',
          'width=500,height=600,scrollbars=yes,resizable=yes',
        );
      }

      let finalized = false;
      const finalizeConnection = async () => {
        if (finalized) return;
        finalized = true;
        setConnectingService(null);
        console.log('[Connectors] OAuth flow completed for', service);

        // Autobind account ID (no picker). This keeps accounts isolated per install.
        try {
          const autobind = await integrationAPI.autobindIntegration(service);
          console.log('[Connectors] Autobind result:', autobind);
        } catch (err) {
          console.error('[Connectors] Autobind failed:', err);
        }

        // Refresh integrations and workflows to check if connection was successful (skip cache)
        await fetchIntegrations(true);
        await fetchWorkflows(true);

        // For Slack, open configuration modal (create or update based on existing workflow)
        if (service === 'slack') {
          try {
            // Check if workflow already exists for this service
            const workflows = await workflowAPI.list();
            const existingWorkflow = workflows.find((w) =>
              w.name.toLowerCase().includes(`${service} ingestion`),
            );

            if (existingWorkflow) {
              console.log(`[Connectors] Found existing ${service} workflow`, existingWorkflow.id);
              await openSlackWorkflowModal(existingWorkflow.id);
            } else {
              console.log(
                `[Connectors] No existing ${service} workflow, opening modal in create mode`,
              );
              await openSlackWorkflowModal(null);
            }
          } catch (err) {
            console.error(`Error handling ${service} workflow configuration:`, err);
          }
        }
      };

      if (!popupRef && !isDesktopRuntimeAvailable()) {
        // Popup blocked in browser mode; continue with local placeholder flow
        await finalizeConnection();
        return;
      }

      if (popupRef) {
        // Browser mode: poll for popup closure
        const checkClosed = setInterval(async () => {
          if (popupRef?.closed) {
            clearInterval(checkClosed);
            await finalizeConnection();
          }
        }, 1000);
      } else {
        // Desktop mode: poll backend for connection status since we can't track browser tab
        const pollInterval = setInterval(async () => {
          try {
            const status = await integrationAPI.getIntegrationStatus(service);
            if (status.connected) {
              clearInterval(pollInterval);
              await finalizeConnection();
            }
          } catch {
            // Keep polling on transient errors
          }
        }, 2000);

        // Timeout after 120s
        setTimeout(() => {
          clearInterval(pollInterval);
          if (!finalized) {
            finalized = true;
            setConnectingService(null);
            // Still try to finalize in case OAuth completed
            finalizeConnection();
          }
        }, 120000);
      }
    } catch (err) {
      console.error(`Error connecting to ${service}:`, err);
      setError(err instanceof Error ? err.message : `Failed to connect to ${service}`);
      setConnectingService(null);
    }
  };

  // Disconnect from a service
  const handleDisconnect = async (service: string) => {
    try {
      setDisconnectingService(service);
      setError(null);

      const result = await integrationAPI.disconnectIntegration(service);
      console.log('[Connectors] Disconnect result:', result);

      // Refresh integrations to update UI (skip cache)
      await fetchIntegrations(true);
    } catch (err) {
      console.error(`Error disconnecting from ${service}:`, err);
      setError(err instanceof Error ? err.message : `Failed to disconnect from ${service}`);
    } finally {
      setDisconnectingService(null);
    }
  };

  // Check if a service is connected
  const isConnected = (service: string) => {
    return connectedIntegrations.some((integration) => integration.service === service);
  };

  // Get connection details for a service
  const getConnectionDetails = (service: string) => {
    return connectedIntegrations.find((integration) => integration.service === service);
  };

  const [workflows, setWorkflows] = useState<Workflow[]>([]);

  const fetchWorkflows = async (skipCache = false) => {
    try {
      // Check cache first (if not forcing refresh)
      if (!skipCache && workflowsCache) {
        const now = Date.now();
        const cacheAge = now - workflowsCache.lastFetched;

        if (cacheAge < CACHE_TTL) {
          console.log('[ConnectorsPage] Using cached workflows data');
          setWorkflows(workflowsCache.workflows);
          return;
        }
      }

      const workflowList = await workflowAPI.list();
      setWorkflows(workflowList);

      // Update module-level cache
      workflowsCache = {
        workflows: workflowList,
        lastFetched: Date.now(),
      };
    } catch (err) {
      console.error('Error fetching workflows:', err);
    }
  };

  useEffect(() => {
    fetchIntegrations();
    fetchWorkflows();
  }, []);

  // Filter integrations based on tab and search query
  const filteredIntegrations = availableIntegrations.filter((integration) => {
    // Search filter
    const matchesSearch = integration.name.toLowerCase().includes(searchQuery.toLowerCase());

    // Tab filter
    const connected = isConnected(integration.service);
    const matchesFilter =
      activeFilter === 'all' ||
      (activeFilter === 'active' && connected) ||
      (activeFilter === 'inactive' && !connected);

    return matchesSearch && matchesFilter;
  });

  if (loading) {
    return (
      <div className="w-full h-full overflow-auto">
        <div className="p-6 space-y-6">
          {/* Header skeleton */}
          <div className="space-y-2">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-5 w-96" />
          </div>

          {/* Filter tabs and search skeleton */}
          <div className="flex items-center justify-between gap-4">
            <Skeleton className="h-10 w-64" />
            <Skeleton className="h-10 w-64" />
          </div>

          {/* Cards skeleton */}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-6">
            {[...Array(6)].map((_, i) => (
              <Card key={i} className="flex flex-col gap-3 p-6 shadow-none">
                <Skeleton className="h-9 w-9" />
                <div className="flex flex-col gap-1">
                  <Skeleton className="h-6 w-24" />
                  <Skeleton className="h-5 w-full" />
                </div>
                <div className="flex flex-col gap-3 mt-4">
                  <Skeleton className="h-9 w-full" />
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
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold leading-8">Connectors</h1>
            <p className="text-base font-normal leading-5 text-[#737373]">
              You can connect your Atlas account to other apps and services.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => window.location.hash = '/agents'}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Main
            </Button>
            <Button variant="outline" onClick={() => window.location.hash = '/schedules'}>
              <Clock className="h-4 w-4 mr-2" />
              Manage Schedules
            </Button>
          </div>
        </div>

        {error && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Filter tabs and search */}
        <div className="flex items-center justify-between gap-4">
          <Tabs
            value={activeFilter}
            onValueChange={(value) => setActiveFilter(value as typeof activeFilter)}
          >
            <TabsList className="bg-transparent border border-[#333333] rounded-lg p-1 h-10">
              <TabsTrigger
                value="all"
                className="data-[state=active]:bg-black data-[state=active]:text-white data-[state=active]:border data-[state=active]:border-white shadow-none rounded-md px-3 py-1.5"
              >
                All
              </TabsTrigger>
              <TabsTrigger
                value="inactive"
                className="data-[state=active]:bg-black data-[state=active]:text-white data-[state=active]:border data-[state=active]:border-white shadow-none rounded-md px-3 py-1.5"
              >
                Inactive
              </TabsTrigger>
              <TabsTrigger
                value="active"
                className="data-[state=active]:bg-black data-[state=active]:text-white data-[state=active]:border data-[state=active]:border-white shadow-none rounded-md px-3 py-1.5"
              >
                Active
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 shadow-none"
            />
          </div>
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-6">
          {filteredIntegrations.map((integration) => {
            const IconComponent = SERVICE_ICONS[integration.service as keyof typeof SERVICE_ICONS];
            const connected = isConnected(integration.service);
            const connecting = connectingService === integration.service;
            const isSupported = supportedServices.has(integration.service);
            const connectionDetails = getConnectionDetails(integration.service);
            const hasError = connectionDetails?.error;

            // Debug logging
            if (integration.service === 'telegram') {
              console.log('[ConnectorsPage] Telegram render:', {
                integration,
                connectionDetails,
                hasError,
                errorValue: connectionDetails?.error,
                errorType: typeof connectionDetails?.error,
              });
            }

            const isWorkflowService = integration.service === 'telegram';

            return (
              <Card
                key={integration.service}
                className={`flex flex-col gap-3 p-6 shadow-none ${!isSupported ? 'opacity-50' : ''} ${
                  hasError ? 'border-amber-400' : ''
                }`}
              >
                {/* Icon - left aligned */}
                <div className="flex items-start">
                  {IconComponent && (
                    <IconComponent className={`h-9 w-9 ${!isSupported ? 'grayscale' : ''}`} />
                  )}
                </div>

                {/* Name and Error - left aligned */}
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="text-base font-normal leading-6 text-foreground">
                      {integration.name}
                    </span>
                    {hasError && (
                      <div className="relative">
                        <AlertTriangle
                          className="h-4 w-4 text-amber-600 cursor-help"
                          onMouseEnter={() => setHoveredError(integration.service)}
                          onMouseLeave={() => setHoveredError(null)}
                        />
                        {hoveredError === integration.service && (
                          <div className="absolute left-1/2 -translate-x-1/2 top-6 z-10 max-w-xs text-xs text-amber-900 bg-amber-50 border border-amber-300 px-3 py-2 rounded-md shadow-lg whitespace-normal break-words">
                            {connectionDetails.error}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Description - left aligned */}
                  <p className="text-sm font-normal leading-5 text-muted-foreground">
                    {integration.description}
                  </p>
                </div>

                {/* Action Section */}
                <div className="flex flex-col gap-3 mt-4">
                  {!isSupported ? (
                    <span className="text-xs text-muted-foreground">Coming Soon</span>
                  ) : connected ? (
                    isWorkflowService ? (
                      // Slack/Telegram: Show channel count + Edit button
                      <div className="flex items-center justify-between border rounded-md px-3 py-2.5">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-1.5">
                            <div className="h-2 w-2 rounded-full bg-green-500" />
                            <span className="text-sm font-medium text-foreground">{integration.service === 'telegram'
                              ? telegramChannelCount
                              : getChannelCount(workflows.find(w =>
                                  w.name.toLowerCase().includes(`${integration.service} ingestion`)
                                )?.config)} channels</span>
                          </div>
                          {(() => {
                            const timestamp = getTimeSince(
                              integration.service === 'telegram'
                                ? telegramLastSync
                                : workflows.find(w =>
                                    w.name.toLowerCase().includes(`${integration.service} ingestion`)
                                  )?.updated_at
                            );
                            return timestamp ? (
                              <span className="text-xs text-muted-foreground ml-3.5">
                                Updated {timestamp}
                              </span>
                            ) : null;
                          })()}
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              if (integration.service === 'slack') {
                                const wf = workflows.find(w => w.name.toLowerCase().includes('slack ingestion'));
                                openSlackWorkflowModal(wf?.id ?? null);
                              } else {
                                const wf = workflows.find(w => w.name.toLowerCase().includes('telegram ingestion'));
                                openTelegramWorkflowModal(wf?.id ?? null);
                              }
                            }}
                            className="gap-1.5"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDisconnect(integration.service)}
                            disabled={disconnectingService === integration.service}
                            className="gap-1 text-red-600 hover:text-red-700 hover:bg-red-50/10 h-7 text-xs"
                          >
                            {disconnectingService === integration.service ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Unplug className="h-3 w-3" />
                            )}
                            Disconnect
                          </Button>
                        </div>
                      </div>
                    ) : (
                      // Other MCPs: Show Connected status with Disconnect button
                      <div className="flex items-center justify-between border rounded-md px-3 py-2.5">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-1.5">
                            <div className="h-2 w-2 rounded-full bg-green-500" />
                            <span className="text-sm font-medium text-foreground">Connected</span>
                          </div>
                          {(() => {
                            const timestamp = getTimeSince(
                              workflows.find(w => w.name.toLowerCase().includes(`${integration.service}`))?.updated_at ||
                              connectionDetails?.connected_at
                            );
                            return timestamp ? (
                              <span className="text-xs text-muted-foreground ml-3.5">
                                Updated {timestamp}
                              </span>
                            ) : null;
                          })()}
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDisconnect(integration.service)}
                          disabled={disconnectingService === integration.service}
                          className="gap-1 text-red-600 hover:text-red-700 hover:bg-red-50"
                        >
                          {disconnectingService === integration.service ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Unplug className="h-4 w-4" />
                          )}
                          Disconnect
                        </Button>
                      </div>
                    )
                  ) : (
                    <Button
                      onClick={() => handleConnect(integration.service)}
                      disabled={connecting || !isSupported}
                      size="sm"
                      className="bg-black text-white hover:bg-gray-800 w-fit"
                    >
                      {connecting ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Connecting...
                        </>
                      ) : (
                        'Connect'
                      )}
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>

        {filteredIntegrations.length === 0 && !loading && (
          <div className="text-center py-12">
            <p className="text-muted-foreground">
              {searchQuery || activeFilter !== 'all'
                ? 'No connectors match your search or filter.'
                : 'No integrations available at the moment.'}
            </p>
          </div>
        )}

        {/* Telegram QR Code Auth Modal */}
        <TelegramAuthModal
          open={showTelegramAuthModal}
          onOpenChange={setShowTelegramAuthModal}
          onSuccess={async () => {
            setShowTelegramAuthModal(false);
            await fetchIntegrations(true); // Refresh connection status (skip cache)
            await fetchWorkflows(true); // Refresh workflows (skip cache)

            // Open configuration modal (create or update based on existing workflow)
            try {
              // Check if workflow already exists for Telegram
              const workflows = await workflowAPI.list();
              const existingWorkflow = workflows.find((w) =>
                w.name.toLowerCase().includes('telegram ingestion'),
              );

              if (existingWorkflow) {
                // Workflow exists, open modal for reconfiguration
                console.log('[Connectors] Found existing telegram workflow', existingWorkflow.id);
                await openTelegramWorkflowModal(existingWorkflow.id);
              } else {
                // No workflow exists - open modal in create mode
                console.log(
                  '[Connectors] No existing telegram workflow, opening modal in create mode',
                );
                await openTelegramWorkflowModal(null);
              }
            } catch (err) {
              console.error('Error handling telegram workflow configuration:', err);
            }
          }}
        />

        {loadingSlackWorkflow && (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-background/60">
            <div className="flex items-center gap-2 rounded-md border bg-background px-4 py-3 shadow-md">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Loading Slack configuration…</span>
            </div>
          </div>
        )}

        {slackModalOpen && (
          <WorkflowDetailModal
            workflow={slackWorkflow}
            service="slack"
            isOpen={slackModalOpen}
            onClose={() => {
              setSlackModalOpen(false);
              setSlackWorkflow(null);
            }}
            onSave={() => {
              fetchIntegrations(true);
              fetchWorkflows(true);
              setSlackModalOpen(false);
              setSlackWorkflow(null);
            }}
          />
        )}

        {loadingTelegramWorkflow && (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-background/60">
            <div className="flex items-center gap-2 rounded-md border bg-background px-4 py-3 shadow-md">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Loading Telegram configuration…</span>
            </div>
          </div>
        )}

        {telegramModalOpen && (
          <WorkflowDetailModal
            workflow={telegramWorkflow}
            service="telegram"
            isOpen={telegramModalOpen}
            onClose={() => {
              setTelegramModalOpen(false);
              setTelegramWorkflow(null);
            }}
            onSave={() => {
              fetchIntegrations(true);
              fetchWorkflows(true);
              setTelegramModalOpen(false);
              setTelegramWorkflow(null);
            }}
          />
        )}
      </div>
    </div>
  );
}
