import { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Activity,
  CheckCircle,
  XCircle,
  Clock,
  RefreshCw,
  ArrowLeft,
  Server,
  Database,
  Calendar,
  FileWarning,
} from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8767';

// Types for health data (matches backend routes/health.py)
interface ServiceHealth {
  name: string;
  port: number;
  status: 'healthy' | 'unhealthy';
  listening: boolean;
}

interface JobHealth {
  label: string;
  status: 'running' | 'stopped' | 'error';
  pid: number | null;
  exit_code: number | null;
  last_run: string | null;
}

interface ConnectorFreshness {
  connector: string;
  last_sync: string | null;
  age_minutes: number | null;
  status: 'fresh' | 'stale' | 'unknown' | 'not_configured';
}

interface ErrorEntry {
  connector: string;
  timestamp: string;
  message: string;
}

interface HealthSummary {
  healthy: number;
  failing: number;
  total: number;
}

interface WorkflowInfo {
  id: string;
  name: string;
  description: string | null;
  schedule: { type: string; time?: string; day?: string; cron?: string } | null;
  enabled: boolean;
  output_path: string | null;
  config_path: string;
  last_run: string | null;
  last_status: string | null;
  last_error: string | null;
  last_duration_ms: number | null;
}

interface HealthData {
  services: ServiceHealth[];
  jobs: JobHealth[];
  freshness: ConnectorFreshness[];
  errors: ErrorEntry[];
  summary: HealthSummary;
  cached: boolean;
  timestamp: string;
}

type FilterType = 'all' | 'healthy' | 'issues';

// Map connector IDs to display names
const CONNECTOR_NAMES: Record<string, string> = {
  telegram: 'Telegram',
  slack: 'Slack',
  gmail: 'Gmail',
  calendar: 'Google Calendar',
  notion: 'Notion',
  linear: 'Linear',
  granola: 'Granola',
};

// Map job labels to friendly names
const JOB_NAMES: Record<string, string> = {
  'com.codos.granola-sync': 'Meeting Notes Sync',
  'com.codos.process-cleanup': 'Process Cleanup',
  'com.codos.telegram-agent': 'Telegram Agent',
  'com.codos.telegram-sync': 'Telegram Ingestion',
  'com.codos.atlas-alerts': 'Codos Alerts',
  'com.codos.codos-bot': 'Telegram Bot',
  'com.codos.crm-update': 'CRM Update',
  'com.codos.morning-brief': 'Morning Brief',
  'com.codos.telegram-summary': 'Telegram Summary',
  'com.codos.weekly-review': 'Weekly Review',
};

// Map service names to friendly names
const SERVICE_NAMES: Record<string, string> = {
  'gateway-backend': 'API Server',
  'frontend': 'Dashboard',
};

// Map job labels to categories
type JobCategory = 'Running Services' | 'Ingestion' | 'Base Workflows' | 'Other';
const JOB_CATEGORIES: Record<string, JobCategory> = {
  // Running Services
  'com.codos.telegram-agent': 'Running Services',
  'com.codos.codos-bot': 'Running Services',
  // Ingestion (only jobs NOT replaced by scheduled workflows)
  'com.codos.telegram-sync': 'Ingestion',
  'com.codos.granola-sync': 'Ingestion',
  // Base Workflows
  'com.codos.morning-brief': 'Base Workflows',
  'com.codos.telegram-summary': 'Base Workflows',
  'com.codos.weekly-review': 'Base Workflows',
  'com.codos.crm-update': 'Base Workflows',
  'com.codos.atlas-alerts': 'Base Workflows',
  'com.codos.process-cleanup': 'Base Workflows',
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

type ServiceStatus = 'healthy' | 'unhealthy';
type JobStatus = 'running' | 'stopped' | 'error';
type FreshnessStatus = 'fresh' | 'stale' | 'unknown' | 'not_configured';
type AllStatus = ServiceStatus | JobStatus | FreshnessStatus;

function StatusIndicator({ status }: { status: AllStatus }) {
  if (status === 'healthy' || status === 'fresh' || status === 'running') {
    return <div className="h-2.5 w-2.5 rounded-full bg-green-500" />;
  }
  if (status === 'unhealthy' || status === 'error') {
    return <div className="h-2.5 w-2.5 rounded-full bg-red-500" />;
  }
  if (status === 'stale') {
    return <div className="h-2.5 w-2.5 rounded-full bg-yellow-500" />;
  }
  if (status === 'not_configured') {
    return <div className="h-2.5 w-2.5 rounded-full bg-gray-500" />;
  }
  return <div className="h-2.5 w-2.5 rounded-full bg-gray-400" />;
}

function StatusBadge({ status }: { status: AllStatus }) {
  if (status === 'healthy' || status === 'fresh' || status === 'running') {
    const label = status === 'healthy' ? 'Healthy' : status === 'fresh' ? 'Fresh' : 'Running';
    return (
      <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
        {label}
      </Badge>
    );
  }
  if (status === 'unhealthy' || status === 'error') {
    return (
      <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
        {status === 'unhealthy' ? 'Unhealthy' : 'Error'}
      </Badge>
    );
  }
  if (status === 'stale') {
    return (
      <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
        Stale
      </Badge>
    );
  }
  if (status === 'not_configured') {
    return (
      <Badge className="bg-white/10 text-gray-400 border-white/20">
        Not configured
      </Badge>
    );
  }
  if (status === 'stopped') {
    return (
      <Badge className="bg-white/10 text-gray-400 border-white/20">
        Stopped
      </Badge>
    );
  }
  return (
    <Badge className="bg-white/10 text-gray-500 border-white/10">
      Unknown
    </Badge>
  );
}

export function HealthPage() {
  const [healthData, setHealthData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [userWorkflows, setUserWorkflows] = useState<WorkflowInfo[]>([]);
  const [userWorkflowsLoading, setUserWorkflowsLoading] = useState(true);

  const fetchUserWorkflows = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/workflows`);
      if (!response.ok) {
        throw new Error('Failed to fetch user workflows');
      }
      const data: WorkflowInfo[] = await response.json();
      setUserWorkflows(data);
    } catch (err) {
      console.error('Error fetching user workflows:', err);
      setUserWorkflows([]);
    } finally {
      setUserWorkflowsLoading(false);
    }
  }, []);

  const fetchHealthData = useCallback(async (silent = false) => {
    try {
      if (!silent) {
        setError(null);
      }
      if (!silent && !healthData) {
        setLoading(true);
      }
      if (silent) {
        setRefreshing(true);
      }

      const response = await fetch(`${API_BASE_URL}/api/health/full`);

      if (!response.ok) {
        throw new Error('Failed to fetch health data');
      }

      const data: HealthData = await response.json();
      setHealthData(data);
    } catch (err) {
      console.error('Error fetching health data:', err);
      if (!silent) {
        setError(err instanceof Error ? err.message : 'Failed to load health data');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [healthData]);

  // Initial fetch and auto-refresh every 30 seconds
  useEffect(() => {
    fetchHealthData();
    fetchUserWorkflows();

    const interval = setInterval(() => {
      fetchHealthData(true);
      fetchUserWorkflows();
    }, 30000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only
  }, []);

  // Filter helpers
  const isServiceHealthy = (item: ServiceHealth): boolean => item.status === 'healthy';
  const isJobHealthy = (item: JobHealth): boolean => item.status === 'running';
  const isFreshnessHealthy = (item: ConnectorFreshness): boolean => item.status === 'fresh';

  const hasServiceIssue = (item: ServiceHealth): boolean => item.status === 'unhealthy';
  const hasJobIssue = (item: JobHealth): boolean => item.status === 'error';
  const hasFreshnessIssue = (item: ConnectorFreshness): boolean => item.status === 'stale';

  // Filtered data
  const filteredServices = healthData?.services.filter((s) => {
    if (activeFilter === 'all') return true;
    if (activeFilter === 'healthy') return isServiceHealthy(s);
    if (activeFilter === 'issues') return hasServiceIssue(s);
    return true;
  }) || [];

  const filteredJobs = healthData?.jobs.filter((j) => {
    if (activeFilter === 'all') return true;
    if (activeFilter === 'healthy') return isJobHealthy(j);
    if (activeFilter === 'issues') return hasJobIssue(j);
    return true;
  }) || [];

  const filteredFreshness = healthData?.freshness.filter((d) => {
    if (activeFilter === 'all') return true;
    if (activeFilter === 'healthy') return isFreshnessHealthy(d);
    if (activeFilter === 'issues') return hasFreshnessIssue(d);
    return true;
  }) || [];

  const filteredErrors = activeFilter === 'healthy' ? [] : (healthData?.errors || []);
  const codosBotJob = healthData?.jobs.find((job) => job.label === 'com.codos.codos-bot') || null;
  const filteredBackgroundJobs = filteredJobs.filter(
    (job) => JOB_CATEGORIES[job.label] === 'Running Services' && job.label !== 'com.codos.codos-bot'
  );

  // Loading state
  if (loading) {
    return (
      <div className="w-full h-full overflow-auto bg-[#0a0a0f] min-h-screen">
        <div className="p-6 space-y-6">
          {/* Header skeleton */}
          <div className="space-y-2">
            <Skeleton className="h-8 w-8 bg-white/10" />
            <Skeleton className="h-8 w-48 bg-white/10" />
            <Skeleton className="h-5 w-96 bg-white/10" />
          </div>

          {/* Summary skeleton */}
          <div className="grid grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-24 w-full bg-white/10" />
            ))}
          </div>

          {/* Filter tabs skeleton */}
          <Skeleton className="h-10 w-64 bg-white/10" />

          {/* Cards skeleton */}
          <div className="space-y-4">
            {[...Array(4)].map((_, i) => (
              <Card key={i} className="p-6 shadow-none bg-white/5 border-white/10">
                <div className="space-y-4">
                  <Skeleton className="h-6 w-40 bg-white/10" />
                  <div className="space-y-3">
                    {[...Array(3)].map((_, j) => (
                      <div key={j} className="flex items-center gap-4">
                        <Skeleton className="h-10 w-10 rounded-lg bg-white/10" />
                        <div className="flex-1 space-y-2">
                          <Skeleton className="h-5 w-32 bg-white/10" />
                          <Skeleton className="h-4 w-48 bg-white/10" />
                        </div>
                        <Skeleton className="h-6 w-20 bg-white/10" />
                      </div>
                    ))}
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
    <div className="w-full h-full overflow-auto bg-[#0a0a0f] min-h-screen">
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="space-y-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => (window.location.hash = '#/agents')}
            className="gap-2 -ml-2 text-gray-400 hover:text-white hover:bg-white/5"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Dashboard
          </Button>

          <div className="flex items-center justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <Activity className="h-7 w-7 text-orange-500" />
                <h1 className="text-2xl font-semibold leading-8 text-white">System Health</h1>
              </div>
              <p className="text-base font-normal leading-5 text-gray-400">
                Monitor the health of your Codos services, scheduled jobs, and data freshness
              </p>
            </div>

            <Button
              variant="outline"
              onClick={() => fetchHealthData(true)}
              disabled={refreshing}
              className="gap-2 border-white/10 text-gray-300 hover:bg-white/5 hover:text-white"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>

        {/* Error alert */}
        {error && (
          <Alert className="bg-red-500/20 border-red-500/30 text-red-400">
            <XCircle className="h-4 w-4 text-red-400" />
            <AlertDescription className="text-red-400">{error}</AlertDescription>
          </Alert>
        )}

        {/* Summary Cards */}
        {healthData && (
          <div className="grid grid-cols-3 gap-4">
            <Card className="p-4 shadow-none bg-white/5 border-white/10">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-green-500/20">
                  <CheckCircle className="h-5 w-5 text-green-400" />
                </div>
                <div>
                  <p className="text-2xl font-semibold text-green-400">
                    {healthData.summary.healthy}
                  </p>
                  <p className="text-sm text-gray-400">Healthy</p>
                </div>
              </div>
            </Card>

            <Card className="p-4 shadow-none bg-white/5 border-white/10">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-red-500/20">
                  <XCircle className="h-5 w-5 text-red-400" />
                </div>
                <div>
                  <p className="text-2xl font-semibold text-red-400">
                    {healthData.summary.failing}
                  </p>
                  <p className="text-sm text-gray-400">Failing</p>
                </div>
              </div>
            </Card>

            <Card className="p-4 shadow-none bg-white/5 border-white/10">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-white/10">
                  <Server className="h-5 w-5 text-gray-300" />
                </div>
                <div>
                  <p className="text-2xl font-semibold text-white">
                    {healthData.summary.total}
                  </p>
                  <p className="text-sm text-gray-400">Total Components</p>
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* Filter tabs */}
        <Tabs
          value={activeFilter}
          onValueChange={(value) => setActiveFilter(value as FilterType)}
        >
          <TabsList className="bg-white/5 border border-white/10 rounded-lg p-1 h-10">
            <TabsTrigger
              value="all"
              className="data-[state=active]:bg-white/10 data-[state=active]:text-white text-gray-400 shadow-none rounded-md px-3 py-1.5"
            >
              All
            </TabsTrigger>
            <TabsTrigger
              value="healthy"
              className="data-[state=active]:bg-white/10 data-[state=active]:text-white text-gray-400 shadow-none rounded-md px-3 py-1.5"
            >
              Healthy
            </TabsTrigger>
            <TabsTrigger
              value="issues"
              className="data-[state=active]:bg-white/10 data-[state=active]:text-white text-gray-400 shadow-none rounded-md px-3 py-1.5"
            >
              Issues
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Running Services */}
        {filteredServices.length > 0 && (
          <Card className="p-6 shadow-none bg-white/5 border-white/10">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Server className="h-5 w-5 text-gray-400" />
                <h2 className="text-lg font-medium text-white">Running Services</h2>
              </div>

              <div className="space-y-3">
                {filteredServices.map((service) => (
                  <div
                    key={service.name}
                    className="flex items-center justify-between p-3 rounded-lg bg-white/5 hover:bg-white/10 transition"
                  >
                    <div className="flex items-center gap-3">
                      <StatusIndicator status={service.status} />
                      <div>
                        <p className="font-medium text-white">{SERVICE_NAMES[service.name] || service.name}</p>
                        <p className="text-sm text-gray-400">
                          Port {service.port}
                        </p>
                      </div>
                    </div>
                    <StatusBadge status={service.status} />
                  </div>
                ))}
              </div>
            </div>
          </Card>
        )}

        {/* Running Services (daemon jobs) */}
        {codosBotJob && (
          <Card className="p-6 shadow-none bg-white/5 border-white/10">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Server className="h-5 w-5 text-gray-400" />
                <h2 className="text-lg font-medium text-white">Telegram Bot</h2>
              </div>

              <div
                className="flex items-center justify-between p-3 rounded-lg bg-white/5 hover:bg-white/10 transition"
              >
                <div className="flex items-center gap-3">
                  <StatusIndicator status={codosBotJob.status} />
                  <div>
                    <p className="font-medium text-white">{JOB_NAMES[codosBotJob.label] || codosBotJob.label}</p>
                    <div className="flex items-center gap-2 text-sm text-gray-400">
                      {codosBotJob.pid && (
                        <>
                          <span>PID: {codosBotJob.pid}</span>
                          <span className="text-gray-600">|</span>
                        </>
                      )}
                      {codosBotJob.exit_code !== null && (
                        <span className={codosBotJob.exit_code === 0 ? 'text-green-400' : 'text-red-400'}>
                          Exit: {codosBotJob.exit_code}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <StatusBadge status={codosBotJob.status} />
              </div>
            </div>
          </Card>
        )}

        {/* Running Services (daemon jobs) */}
        {filteredBackgroundJobs.length > 0 && (
          <Card className="p-6 shadow-none bg-white/5 border-white/10">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Server className="h-5 w-5 text-gray-400" />
                <h2 className="text-lg font-medium text-white">Background Services</h2>
              </div>

              <div className="space-y-3">
                {filteredBackgroundJobs.map((job) => (
                  <div
                    key={job.label}
                    className="flex items-center justify-between p-3 rounded-lg bg-white/5 hover:bg-white/10 transition"
                  >
                    <div className="flex items-center gap-3">
                      <StatusIndicator status={job.status} />
                      <div>
                        <p className="font-medium text-white">{JOB_NAMES[job.label] || job.label}</p>
                        <div className="flex items-center gap-2 text-sm text-gray-400">
                          {job.pid && (
                            <>
                              <span>PID: {job.pid}</span>
                              <span className="text-gray-600">|</span>
                            </>
                          )}
                          {job.exit_code !== null && (
                            <span className={job.exit_code === 0 ? 'text-green-400' : 'text-red-400'}>
                              Exit: {job.exit_code}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <StatusBadge status={job.status} />
                  </div>
                ))}
              </div>
            </div>
          </Card>
        )}

        {/* Ingestion Jobs */}
        {filteredJobs.filter(j => JOB_CATEGORIES[j.label] === 'Ingestion').length > 0 && (
          <Card className="p-6 shadow-none bg-white/5 border-white/10">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Database className="h-5 w-5 text-gray-400" />
                <h2 className="text-lg font-medium text-white">Ingestion</h2>
              </div>

              <div className="space-y-3">
                {filteredJobs.filter(j => JOB_CATEGORIES[j.label] === 'Ingestion').map((job) => (
                  <div
                    key={job.label}
                    className="flex items-center justify-between p-3 rounded-lg bg-white/5 hover:bg-white/10 transition"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`h-2.5 w-2.5 rounded-full ${
                        job.status === 'running' ? 'bg-green-500' :
                        job.status === 'error' || (job.exit_code !== null && job.exit_code !== 0) ? 'bg-red-500' :
                        job.last_run ? 'bg-green-500' : 'bg-gray-400'
                      }`} />
                      <div>
                        <p className="font-medium text-white">{JOB_NAMES[job.label] || job.label}</p>
                      </div>
                    </div>
                    <span className="text-sm text-gray-400">
                      {job.status === 'running' ? (
                        <span className="text-green-400">Running</span>
                      ) : job.status === 'error' || (job.exit_code !== null && job.exit_code !== 0) ? (
                        <span className="text-red-400">Error (exit {job.exit_code})</span>
                      ) : job.last_run ? (
                        <>ran {getRelativeTime(job.last_run)}</>
                      ) : (
                        'Never ran'
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        )}

        {/* Base Workflow Jobs */}
        {filteredJobs.filter(j => JOB_CATEGORIES[j.label] === 'Base Workflows').length > 0 && (
          <Card className="p-6 shadow-none bg-white/5 border-white/10">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-gray-400" />
                <h2 className="text-lg font-medium text-white">Base Workflows</h2>
              </div>

              <div className="space-y-3">
                {filteredJobs.filter(j => JOB_CATEGORIES[j.label] === 'Base Workflows').map((job) => (
                  <div
                    key={job.label}
                    className="flex items-center justify-between p-3 rounded-lg bg-white/5 hover:bg-white/10 transition"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`h-2.5 w-2.5 rounded-full ${
                        job.status === 'running' ? 'bg-green-500' :
                        job.status === 'error' || (job.exit_code !== null && job.exit_code !== 0) ? 'bg-red-500' :
                        job.last_run ? 'bg-green-500' : 'bg-gray-400'
                      }`} />
                      <div>
                        <p className="font-medium text-white">{JOB_NAMES[job.label] || job.label}</p>
                      </div>
                    </div>
                    <span className="text-sm text-gray-400">
                      {job.status === 'running' ? (
                        <span className="text-green-400">Running</span>
                      ) : job.status === 'error' || (job.exit_code !== null && job.exit_code !== 0) ? (
                        <span className="text-red-400">Error (exit {job.exit_code})</span>
                      ) : job.last_run ? (
                        <>ran {getRelativeTime(job.last_run)}</>
                      ) : (
                        'Never ran'
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        )}

        {/* Workflows */}
        {!userWorkflowsLoading && (
          <Card className="p-6 shadow-none bg-white/5 border-white/10">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-gray-400" />
                <h2 className="text-lg font-medium text-white">Workflows</h2>
              </div>

              {userWorkflows.length === 0 ? (
                <p className="text-sm text-gray-500 py-2">No workflows configured</p>
              ) : (
                <div className="space-y-3">
                  {userWorkflows.map((workflow) => {
                    const status = workflow.last_status;
                    const isSuccess = status === 'success';
                    const isError = status === 'error';
                    const isSkipped = status === 'skipped';
                    const hasRun = workflow.last_run !== null;

                    return (
                      <div
                        key={workflow.id}
                        className="flex items-center justify-between p-3 rounded-lg bg-white/5 hover:bg-white/10 transition"
                      >
                        <div className="flex items-center gap-3">
                          <div className={`h-2.5 w-2.5 rounded-full ${
                            !workflow.enabled ? 'bg-gray-500' :
                            isError ? 'bg-red-500' :
                            isSuccess ? 'bg-green-500' :
                            isSkipped ? 'bg-yellow-500' :
                            hasRun ? 'bg-green-500' : 'bg-gray-400'
                          }`} />
                          <div>
                            <p className="font-medium text-white">{workflow.name}</p>
                            {workflow.last_error && isError && (
                              <p className="text-xs text-red-400 mt-0.5 max-w-md truncate">{workflow.last_error}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {hasRun && (
                            <Badge className={
                              isError ? 'bg-red-500/20 text-red-400 border-red-500/30' :
                              isSkipped ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' :
                              isSuccess ? 'bg-green-500/20 text-green-400 border-green-500/30' :
                              'bg-white/10 text-gray-400 border-white/20'
                            }>
                              {isError ? 'Error' : isSkipped ? 'Skipped' : isSuccess ? 'Success' : status || 'Unknown'}
                            </Badge>
                          )}
                          <span className="text-sm text-gray-400 min-w-[80px] text-right">
                            {hasRun ? getRelativeTime(workflow.last_run) : 'Never ran'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </Card>
        )}

        {/* Data Freshness */}
        {filteredFreshness.length > 0 && (
          <Card className="p-6 shadow-none bg-white/5 border-white/10">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Database className="h-5 w-5 text-gray-400" />
                <h2 className="text-lg font-medium text-white">Data Freshness</h2>
              </div>

              <div className="space-y-3">
                {filteredFreshness.map((item) => (
                  <div
                    key={item.connector}
                    className="flex items-center justify-between p-3 rounded-lg bg-white/5 hover:bg-white/10 transition"
                  >
                    <div className="flex items-center gap-3">
                      <StatusIndicator status={item.status} />
                      <div>
                        <p className="font-medium text-white">
                          {CONNECTOR_NAMES[item.connector] || item.connector}
                        </p>
                        <div className="flex items-center gap-2 text-sm text-gray-400">
                          {item.last_sync ? (
                            <>
                              <Clock className="h-3.5 w-3.5" />
                              <span>Last sync: {getRelativeTime(item.last_sync)}</span>
                              {item.age_minutes !== null && (
                                <span className="text-gray-500">({item.age_minutes} min)</span>
                              )}
                            </>
                          ) : (
                            <span>Never synced</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <StatusBadge status={item.status} />
                  </div>
                ))}
              </div>
            </div>
          </Card>
        )}

        {/* Recent Errors */}
        {filteredErrors.length > 0 && (
          <Card className="p-6 shadow-none bg-red-500/10 border-red-500/30">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <FileWarning className="h-5 w-5 text-red-400" />
                <h2 className="text-lg font-medium text-red-400">Recent Errors</h2>
              </div>

              <div className="space-y-3">
                {filteredErrors.map((error, index) => (
                  <div
                    key={index}
                    className="p-3 rounded-lg bg-red-500/10 border border-red-500/20"
                  >
                    <div className="flex items-start gap-3">
                      <XCircle className="h-4 w-4 text-red-400 mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-medium text-white">
                            {CONNECTOR_NAMES[error.connector] || error.connector}
                          </span>
                          <span className="text-xs text-gray-500">
                            {getRelativeTime(error.timestamp)}
                          </span>
                        </div>
                        <p className="text-sm text-gray-400 break-words font-mono text-xs">
                          {error.message}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        )}

        {/* Empty state */}
        {healthData &&
          filteredServices.length === 0 &&
          filteredJobs.length === 0 &&
          filteredFreshness.length === 0 &&
          filteredErrors.length === 0 && (
            <div className="text-center py-12">
              <p className="text-gray-400">
                {activeFilter === 'healthy'
                  ? 'No healthy components to display.'
                  : activeFilter === 'issues'
                  ? 'No issues found. All systems are healthy!'
                  : 'No health data available.'}
              </p>
            </div>
          )}

        {/* Last updated */}
        {healthData && (
          <div className="text-center text-xs text-gray-500 pt-2">
            Last updated: {new Date(healthData.timestamp).toLocaleTimeString()}
            <span className="mx-2">|</span>
            Auto-refresh every 30 seconds
          </div>
        )}

        {/* Build info */}
        <div className="text-center text-xs text-gray-600 pt-1 pb-4">
          v{__APP_VERSION__} &middot; Build: {__BUILD_HASH__} @ {new Date(__BUILD_DATETIME__).toLocaleString()}
        </div>
      </div>
    </div>
  );
}
