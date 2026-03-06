import { useState, useEffect } from 'react';
import type { ConversationWorkflowConfig, SlackWorkflowConfig, Workflow } from '@/types';
import { workflowAPI } from '@/lib/api';
import { getWorkflowSchema, getDefaultConfig, type FormField } from '@/lib/workflow-schemas';
import {
  formatLastExecuted,
  formatSchedule,
  parseWorkflowStatus,
  getStatusTooltip,
} from '@/lib/workflow-utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import * as VisuallyHidden from '@radix-ui/react-visually-hidden';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Loader2, Check, X } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { OAuthPermissions } from '@/components/oauth-permissions';
import { TelegramConfigModal } from '@/components/connectors/TelegramConfigModal';

interface WorkflowDetailModalProps {
  workflow: Workflow | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  service?: string; // Service name when workflow is null (create mode)
}

function getDefaultDescription(service?: string): string {
  if (!service) return '';
  const descriptions: Record<string, string> = {
    slack: 'Sync messages from Slack channels and DMs',
    telegram: 'Sync messages from Telegram conversations',
    // gmail: 'Sync emails from Gmail',
    // googlecalendar: 'Sync events from Google Calendar',
    // notion: 'Sync pages from Notion workspace',
  };
  return descriptions[service] || `Sync data from ${service}`;
}

function getDefaultName(service: string): string {
  return `${service} ingestion`;
}

export function WorkflowDetailModal({
  workflow,
  isOpen,
  onClose,
  onSave,
  service,
}: WorkflowDetailModalProps) {
  const [config, setConfig] = useState<Partial<ConversationWorkflowConfig | SlackWorkflowConfig>>(
    {},
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Initialize config from workflow or defaults
    if (workflow?.config) {
      setConfig(workflow.config);
    } else if (workflow?.name) {
      const defaults = getDefaultConfig(workflow.name);
      setConfig(defaults);
    } else if (service) {
      // Create mode: use service to determine defaults
      const workflowName = getDefaultName(service);
      const defaults = getDefaultConfig(workflowName);
      setConfig(defaults);
    }
  }, [workflow, service]);

  // Determine if this is a Slack workflow
  // In create mode (workflow is null), use service prop
  // In update mode (workflow exists), check workflow name
  const isSlackWorkflow = workflow
    ? workflow.name.toLowerCase().includes('slack')
    : service === 'slack';

  // Determine if this is a Telegram workflow
  const isTelegramWorkflow = workflow
    ? workflow.name.toLowerCase().includes('telegram')
    : service === 'telegram';

  const schema = workflow
    ? getWorkflowSchema(workflow.name)
    : service
      ? getWorkflowSchema(getDefaultName(service))
      : null;
  const status = workflow ? parseWorkflowStatus(workflow.last_results) : null;

  if (isSlackWorkflow) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent
          className="max-w-fit p-0 border-none bg-transparent shadow-none"
          showCloseButton={false}
          aria-labelledby="slack-config-title"
          aria-describedby="slack-config-description"
        >
          <VisuallyHidden.Root>
            <DialogTitle id="slack-config-title">Configure Slack ingestion workflow</DialogTitle>
            <DialogDescription id="slack-config-description">
              Select Slack channels, direct messages, and ingestion start time for this workflow.
            </DialogDescription>
          </VisuallyHidden.Root>
          <OAuthPermissions
            workflow={workflow}
            onClose={onClose}
            onSaved={() => {
              onSave();
              onClose();
            }}
          />
        </DialogContent>
      </Dialog>
    );
  }

  if (isTelegramWorkflow) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent
          className="max-w-fit p-0 border-none bg-transparent shadow-none"
          showCloseButton={false}
          aria-labelledby="telegram-config-title"
          aria-describedby="telegram-config-description"
        >
          <VisuallyHidden.Root>
            <DialogTitle id="telegram-config-title">
              Configure Telegram ingestion workflow
            </DialogTitle>
            <DialogDescription id="telegram-config-description">
              Select Telegram conversations and ingestion start time for this workflow.
            </DialogDescription>
          </VisuallyHidden.Root>
          <TelegramConfigModal
            workflow={workflow}
            onClose={onClose}
            onSaved={() => {
              onSave();
              onClose();
            }}
          />
        </DialogContent>
      </Dialog>
    );
  }

  const handleSave = async () => {
    try {
      if (!workflow) {
        console.warn('No workflow to save or update');
        return;
      }
      setSaving(true);
      setError(null);
      await workflowAPI.updateWorkflow(workflow.id, { config });
      onSave();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update workflow');
    } finally {
      setSaving(false);
    }
  };

  const updateConfigField = (path: string[], value: unknown) => {
    setConfig((prev) => {
      const newConfig = { ...prev };
      let current: Record<string, unknown> = newConfig;

      // Navigate to the parent object
      for (let i = 0; i < path.length - 1; i++) {
        const key = path[i];
        if (!current[key] || typeof current[key] !== 'object') {
          current[key] = {};
        }
        current = current[key] as Record<string, unknown>;
      }

      // Set the value
      current[path[path.length - 1]] = value;
      return newConfig;
    });
  };

  const getConfigValue = (path: string[]): unknown => {
    let current: unknown = config;
    for (const key of path) {
      if (current && typeof current === 'object' && key in current) {
        current = (current as Record<string, unknown>)[key];
      } else {
        return undefined;
      }
    }
    return current;
  };

  const renderField = (field: FormField, parentPath: string[] = []) => {
    const fieldPath = [...parentPath, field.name];
    const value = getConfigValue(fieldPath);

    if (field.type === 'object' && field.fields) {
      return (
        <div key={field.name} className="space-y-4 pl-4 border-l-2 border-muted">
          <div>
            <Label className="text-base font-semibold">{field.label}</Label>
            <p className="text-sm text-muted-foreground">{field.description}</p>
          </div>
          {field.fields.map((subField) => renderField(subField, fieldPath))}
        </div>
      );
    }

    if (field.type === 'array') {
      // For arrays, we'll use a comma-separated input
      const arrayValue = Array.isArray(value) ? value.join(', ') : '';
      return (
        <div key={field.name} className="space-y-2">
          <Label htmlFor={fieldPath.join('.')}>{field.label}</Label>
          <Input
            id={fieldPath.join('.')}
            value={arrayValue}
            onChange={(e) => {
              const newValue = e.target.value
                .split(',')
                .map((s) => s.trim())
                .filter((s) => s.length > 0);
              updateConfigField(fieldPath, newValue);
            }}
            placeholder={field.placeholder}
          />
          <p className="text-sm text-muted-foreground">{field.description}</p>
        </div>
      );
    }

    if (field.type === 'number') {
      return (
        <div key={field.name} className="space-y-2">
          <Label htmlFor={fieldPath.join('.')}>{field.label}</Label>
          <Input
            id={fieldPath.join('.')}
            type="number"
            value={value as number | undefined}
            onChange={(e) => {
              updateConfigField(fieldPath, parseInt(e.target.value, 10));
            }}
            placeholder={field.placeholder}
          />
          <p className="text-sm text-muted-foreground">{field.description}</p>
        </div>
      );
    }

    // Default to text input
    return (
      <div key={field.name} className="space-y-2">
        <Label htmlFor={fieldPath.join('.')}>{field.label}</Label>
        <Input
          id={fieldPath.join('.')}
          value={(value as string) || ''}
          onChange={(e) => {
            updateConfigField(fieldPath, e.target.value);
          }}
          placeholder={field.placeholder}
        />
        <p className="text-sm text-muted-foreground">{field.description}</p>
      </div>
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {workflow?.name || (service ? getDefaultName(service) : 'Configure Workflow')}
          </DialogTitle>
          <DialogDescription>
            {workflow?.description ||
              getDefaultDescription(service) ||
              'Configure workflow settings'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Workflow Info - only show for existing workflows */}
          {workflow && (
            <>
              <div className="grid grid-cols-3 gap-4 p-4 bg-muted/50 rounded-lg">
                <div>
                  <p className="text-sm font-medium">Schedule</p>
                  <p className="text-sm text-muted-foreground">
                    {formatSchedule(workflow.schedule)}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium">Last Execution</p>
                  <p className="text-sm text-muted-foreground">
                    {formatLastExecuted(workflow.last_executed)}
                  </p>
                </div>
                <div className="col-span-1">
                  <p className="text-sm font-medium mb-1">Status</p>
                  <Badge
                    variant={status?.success ? 'default' : 'destructive'}
                    className="w-8 h-8 flex items-center justify-center p-0"
                    title={getStatusTooltip(workflow.last_results)}
                  >
                    {status?.success ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                  </Badge>
                </div>
              </div>

              <Separator />
            </>
          )}

          {/* Configuration Form */}
          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold">Configuration</h3>
              <p className="text-sm text-muted-foreground">Customize workflow settings below</p>
            </div>

            {schema ? (
              <div className="space-y-6">{schema.fields.map((field) => renderField(field))}</div>
            ) : (
              <Alert>
                <AlertDescription>
                  No configuration schema available for this workflow type.
                </AlertDescription>
              </Alert>
            )}
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !schema}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
