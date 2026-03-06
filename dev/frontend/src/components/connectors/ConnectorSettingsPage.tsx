import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronLeft, Pencil } from 'lucide-react';
import { integrationAPI, workflowAPI } from '@/lib/api';
import type { Workflow } from '@/types';
import { WorkflowDetailModal } from '@/components/workflows/WorkflowDetailModal';
import { SERVICE_ICONS } from './service-icons';

// Helper to safely access conversation_filters from workflow config
function getChannelCount(config: Record<string, unknown> | undefined): number {
  if (!config || typeof config !== 'object') return 0;

  const filters = config.conversation_filters;
  if (!filters || typeof filters !== 'object') return 0;

  const include = (filters as { include?: unknown }).include;
  if (!Array.isArray(include)) return 0;

  return include.length;
}

interface ConnectorSettingsPageProps {
  service: string;
  onBack: () => void;
}

// Cache interfaces (matching ConnectorsPage pattern)
interface ConnectionDetails {
  service: string;
  description?: string;
  connected_at?: string;
}

interface ConnectionDetailsCache {
  service: string;
  details: ConnectionDetails;
  lastFetched: number;
}

interface WorkflowCache {
  service: string;
  workflow: Workflow | null;
  lastFetched: number;
}

// Cache TTL: 5 minutes (same as ConnectorsPage)
const CACHE_TTL = 5 * 60 * 1000;

// Module-level caches (persist across component mounts)
const connectionDetailsCache = new Map<string, ConnectionDetailsCache>();
const workflowCache = new Map<string, WorkflowCache>();

export function ConnectorSettingsPage({ service, onBack }: ConnectorSettingsPageProps) {
  const [loading, setLoading] = useState(true);
  const [connectionDetails, setConnectionDetails] = useState<ConnectionDetails | null>(null);
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [showWorkflowModal, setShowWorkflowModal] = useState(false);
  const [telegramChannelCount, setTelegramChannelCount] = useState<number | null>(null);

  const serviceName = service.charAt(0).toUpperCase() + service.slice(1);
  const hasWorkflowSupport = service === 'slack' || service === 'telegram';
  const IconComponent = SERVICE_ICONS[service];

  const fetchConnectionDetails = useCallback(
    async (skipCache = false) => {
      try {
        // Check cache first (if not forcing refresh)
        if (!skipCache && connectionDetailsCache.has(service)) {
          const cached = connectionDetailsCache.get(service)!;
          const now = Date.now();
          const cacheAge = now - cached.lastFetched;

          if (cacheAge < CACHE_TTL) {
            console.log('[ConnectorSettingsPage] Using cached connection details for', service);
            setConnectionDetails(cached.details);
            setLoading(false);
            return;
          }
        }

        // Only show loading skeleton if we don't have cached data
        const hasCached = connectionDetailsCache.has(service);
        if (!hasCached) {
          setLoading(true);
        }

        const connected = await integrationAPI.getConnectedIntegrations();
        const details = connected.find((c: ConnectionDetails) => c.service === service) ?? null;
        setConnectionDetails(details);

        if (details) {
          // Update cache
          connectionDetailsCache.set(service, {
            service,
            details,
            lastFetched: Date.now(),
          });
        }
      } catch (err) {
        console.error('Error fetching connection details:', err);
      } finally {
        setLoading(false);
      }
    },
    [service],
  );

  const fetchWorkflow = useCallback(
    async (skipCache = false) => {
      try {
        // Check cache first (if not forcing refresh)
        if (!skipCache && workflowCache.has(service)) {
          const cached = workflowCache.get(service)!;
          const now = Date.now();
          const cacheAge = now - cached.lastFetched;

          if (cacheAge < CACHE_TTL) {
            console.log('[ConnectorSettingsPage] Using cached workflow for', service);
            setWorkflow(cached.workflow);
            return;
          }
        }

        const workflows = await workflowAPI.list();
        const serviceWorkflow = workflows.find((w) =>
          w.name.toLowerCase().includes(`${service} ingestion`),
        );

        let fullWorkflow: Workflow | null = null;
        if (serviceWorkflow) {
          // Fetch full workflow details to get the complete config
          fullWorkflow = await workflowAPI.get(serviceWorkflow.id);
          setWorkflow(fullWorkflow);
        }

        // Update cache (even if null)
        workflowCache.set(service, {
          service,
          workflow: fullWorkflow,
          lastFetched: Date.now(),
        });
      } catch (err) {
        console.error('Error fetching workflow:', err);
      }
    },
    [service],
  );

  useEffect(() => {
    fetchConnectionDetails();
    if (hasWorkflowSupport) {
      fetchWorkflow();
    }
    // Fetch telegram config to get accurate channel count, fall back to workflow
    if (service === 'telegram') {
      integrationAPI.getTelegramConfig().then((config) => {
        if (config.whitelist_ids.length > 0) {
          setTelegramChannelCount(config.whitelist_ids.length);
        }
      }).catch(() => {});
    }
  }, [service, fetchConnectionDetails, fetchWorkflow, hasWorkflowSupport]);

  const handleDisconnect = async () => {
    try {
      await integrationAPI.disconnectIntegration(service);

      // Clear cache for this service
      connectionDetailsCache.delete(service);
      workflowCache.delete(service);

      // Navigate back to connectors page
      onBack();
    } catch (err) {
      console.error('Error disconnecting:', err);
    }
  };

  const openWorkflowModal = async () => {
    if (workflow) {
      const fullWorkflow = await workflowAPI.get(workflow.id);
      setWorkflow(fullWorkflow);
    }
    setShowWorkflowModal(true);
  };

  if (loading) {
    return (
      <div className="w-full h-full overflow-auto bg-background flex justify-center">
        <div className="w-full max-w-[800px] px-16 py-6 space-y-6">
          {/* Back button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="gap-2 -ml-2 w-[55px] h-[20px] text-[#6B7280] p-0 hover:bg-transparent"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </Button>

          {/* Header skeleton */}
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-4">
              <Skeleton className="h-[42px] w-[42px] rounded-lg" />
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-8 w-32" />
                <Skeleton className="h-6 w-96" />
              </div>
            </div>
            <Skeleton className="h-9 w-24" />
          </div>

          {/* Status card skeleton */}
          <div className="border rounded-md bg-white border-[#E5E5E5]">
            <div className="flex items-center justify-between py-2 px-3 gap-1.5">
              <div className="flex items-center gap-3">
                <Skeleton className="h-2 w-2 rounded-full mx-2" />
                <Skeleton className="h-5 w-48" />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!connectionDetails) {
    return (
      <div className="w-full h-full overflow-auto">
        <div className="p-6">
          <div className="flex items-center gap-2 mb-6">
            <Button
              variant="ghost"
              size="sm"
              onClick={onBack}
              className="gap-2 -ml-2 w-[55px] h-[20px] text-[#6B7280] p-0 hover:bg-transparent"
            >
              <ChevronLeft className="h-4 w-4" />
              Back
            </Button>
          </div>
          <div>Connector not found or not connected</div>
        </div>
      </div>
    );
  }

  const getTimeSince = (timestamp: string) => {
    const now = new Date();
    const then = new Date(timestamp);
    const diffMs = now.getTime() - then.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins} min ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  };

  return (
    <>
      <div className="w-full h-full overflow-auto bg-background flex justify-center">
        <div className="w-full max-w-[800px] px-16 py-6 space-y-6">
          {/* Back button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="gap-2 -ml-2 w-[55px] h-[20px] text-[#6B7280] p-0 hover:bg-transparent"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </Button>

          {/* Header with icon, title, and disconnect button */}
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-4">
              {IconComponent ? (
                <IconComponent className="h-[42px] w-[42px]" />
              ) : (
                <div className="h-[42px] w-[42px] rounded-lg bg-muted flex items-center justify-center">
                  <span className="text-2xl">{serviceName[0]}</span>
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <h1 className="text-2xl font-semibold leading-8 text-[#0A0A0A]">{serviceName}</h1>
                <p className="text-base font-normal leading-6 text-[#737373]">
                  {connectionDetails.description ||
                    `Link your ${serviceName} account to view, reply, and automate your communication.`}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDisconnect}
              className="text-red-600 border-red-200 hover:bg-red-50"
            >
              Disconnect
            </Button>
          </div>

          {/* Connection status card (for Slack/Telegram with workflows) */}
          {hasWorkflowSupport && workflow && (() => {
            const workflowCount = getChannelCount(workflow.config);
            const channelCount = service === 'telegram'
              ? Math.max(workflowCount, telegramChannelCount ?? 0)
              : workflowCount;
            const isActive = channelCount > 0;
            return (
            <div className="border rounded-md bg-white border-[#E5E5E5]">
              <div className="flex items-center justify-between py-2 px-3 gap-1.5">
                <div className="flex items-center gap-1.5">
                  <div className="relative flex items-center justify-center mx-2">
                    {isActive && (
                      <span
                        className="absolute w-[12px] h-[12px] rounded-full animate-[ping_2s_cubic-bezier(0,0,0.2,1)_infinite]"
                        style={{ backgroundColor: '#2EB67D40' }}
                      />
                    )}
                    <div
                      className={`relative h-2 w-2 rounded-full ${isActive ? 'bg-green-600' : 'bg-yellow-500'}`}
                    />
                  </div>
                  <div>
                    <span className="text-sm font-normal leading-5">
                      Connected {channelCount} channels
                    </span>
                    <span className="text-sm font-normal leading-5 text-muted-foreground ml-2">
                      last update {getTimeSince(workflow.updated_at)}
                    </span>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={openWorkflowModal}
                  className="h-[30px] px-[13px] py-[7px] gap-2 rounded-md border border-[#E5E5E5] bg-white shadow-none"
                >
                  <Pencil className="h-4 w-4" />
                  <span className="text-sm font-normal leading-5">Edit</span>
                </Button>
              </div>
            </div>
            );
          })()}

          {/* Connected status for non-workflow connectors */}
          {!hasWorkflowSupport && (
            <div className="border rounded-md bg-white border-[#E5E5E5]">
              <div className="flex items-center py-2 px-3 gap-3">
                <div className="h-2 w-2 rounded-full bg-green-600 mx-2" />
                <span className="text-sm font-normal leading-5">Connected</span>
                {connectionDetails.connected_at && (
                  <span className="text-sm font-normal leading-5 text-muted-foreground">
                    since {new Date(connectionDetails.connected_at).toLocaleDateString()}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Workflow edit modal for Slack/Telegram */}
      {hasWorkflowSupport && workflow && (
        <WorkflowDetailModal
          workflow={workflow}
          isOpen={showWorkflowModal}
          onClose={() => {
            setShowWorkflowModal(false);
            fetchWorkflow(true); // Refresh after edit (skip cache)
          }}
          onSave={() => {
            setShowWorkflowModal(false);
            fetchConnectionDetails(true); // Refresh connection details (skip cache)
            fetchWorkflow(true); // Refresh workflow data (skip cache)
            // Refresh telegram channel count — prefer backend, fall back to workflow
            if (service === 'telegram') {
              integrationAPI.getTelegramConfig().then((config) => {
                if (config.whitelist_ids.length > 0) {
                  setTelegramChannelCount(config.whitelist_ids.length);
                }
              }).catch(() => {});
            }
          }}
        />
      )}
    </>
  );
}
