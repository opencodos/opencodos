// Workflow configuration schemas for dynamic form generation

export type FieldType = 'text' | 'number' | 'array' | 'object';

export interface FormField {
  name: string;
  type: FieldType;
  label: string;
  description: string;
  defaultValue?: unknown;
  placeholder?: string;
  fields?: FormField[]; // For nested objects
}

export interface WorkflowSchema {
  name: string;
  fields: FormField[];
}

const DEFAULT_SLACK_LOOKBACK_DAYS = 7;

// Slack workflow configuration schema
// Note: This schema is for documentation. Slack workflows use a custom UI (OAuthPermissions component)
const slackWorkflowSchema: WorkflowSchema = {
  name: 'slack ingestion',
  fields: [
    {
      name: 'conversation_filters',
      type: 'object',
      label: 'Conversation Filters',
      description: 'Filter which conversations to sync',
      fields: [
        {
          name: 'include',
          type: 'array',
          label: 'Include',
          description: 'Channel and DM IDs to include',
          defaultValue: [],
        },
        {
          name: 'exclude',
          type: 'array',
          label: 'Exclude',
          description: 'Conversation IDs to exclude',
          defaultValue: [],
        },
      ],
    },
    {
      name: 'initial_lookback_days',
      type: 'number',
      label: 'Lookback days',
      description: 'How many days ago to start ingestion from',
      placeholder: `${DEFAULT_SLACK_LOOKBACK_DAYS}`,
      defaultValue: DEFAULT_SLACK_LOOKBACK_DAYS,
    },
    {
      name: 'team_id',
      type: 'text',
      label: 'Team ID',
      description: 'Slack workspace team ID',
      defaultValue: '',
    },
  ],
};

// Telegram workflow configuration schema
const telegramWorkflowSchema: WorkflowSchema = {
  name: 'telegram ingestion',
  fields: [
    {
      name: 'conversation_filters',
      type: 'object',
      label: 'Conversation Filters',
      description: 'Filter which conversations to sync',
      fields: [
        {
          name: 'include',
          type: 'array',
          label: 'Include',
          description: 'Chat names or user names to include (comma-separated)',
          placeholder: 'Tech Team, username',
          defaultValue: [],
        },
        {
          name: 'exclude',
          type: 'array',
          label: 'Exclude',
          description: 'Patterns to exclude (comma-separated)',
          placeholder: 'archived-*, spam-*',
          defaultValue: [],
        },
      ],
    },
    {
      name: 'initial_lookback_days',
      type: 'number',
      label: 'Lookback days',
      description: 'How long ago to start ingestion from',
      placeholder: '14',
      defaultValue: 14,
    },
  ],
};

// Schema registry
const WORKFLOW_SCHEMAS: Record<string, WorkflowSchema> = {
  'slack ingestion': slackWorkflowSchema,
  'telegram ingestion': telegramWorkflowSchema,
};

/**
 * Get the configuration schema for a workflow by name
 * @param workflowName - The name of the workflow (case-insensitive)
 * @returns The workflow schema or null if not found
 */
export function getWorkflowSchema(workflowName: string): WorkflowSchema | null {
  const normalizedName = workflowName.toLowerCase();
  return WORKFLOW_SCHEMAS[normalizedName] || null;
}

/**
 * Get default configuration for a workflow
 * @param workflowName - The name of the workflow
 * @returns Default configuration object
 */
export function getDefaultConfig(workflowName: string): Record<string, unknown> {
  const schema = getWorkflowSchema(workflowName);
  if (!schema) return {};

  const config: Record<string, unknown> = {};

  function setDefaults(fields: FormField[], target: Record<string, unknown>) {
    fields.forEach((field) => {
      if (field.type === 'object' && field.fields) {
        target[field.name] = {};
        setDefaults(field.fields, target[field.name] as Record<string, unknown>);
      } else if (field.defaultValue !== undefined) {
        target[field.name] = field.defaultValue;
      }
    });
  }

  setDefaults(schema.fields, config);
  return config;
}
