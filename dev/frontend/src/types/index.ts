// Core type definitions for the knowledge base application

// Re-export agent types
export * from './agents';

export interface Document {
  id: number;
  group_id: string;
  title: string;
  content?: string;
  is_folder?: boolean;
  parent_id?: number | null;
  created_at?: string;
  updated_at?: string;
}

export interface DocumentTree extends Document {
  children?: DocumentTree[];
}

export interface Workspace {
  group_id: string;
  name: string;
  role?: string;
  documents: DocumentTree[];
}

export interface WorkspaceInfo {
  group_id: string;
  name: string;
}

export interface DocumentInfo {
  id: number;
  title: string;
  group_id: string;
}

// Auth types
export interface User {
  id: string;
  email?: string;
  wallet?: string;
  phone?: string;
  verified_emails: string[];
  verified_phone_numbers: string[];
  linked_accounts: Array<{
    type: string;
    subject: string;
  }>;
}

export interface AuthState {
  isAuthenticated: boolean;
  user: User | null;
  token: string | null;
  error: string | null;
  isLoading: boolean;
}

// Chat types
export interface Message {
  role: 'user' | 'assistant';
  text: string;
  hasTools?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toolCalls?: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toolResults?: any[];
  reasoning?: string;
  isStreaming?: boolean;
}

// API response types
export interface LoginResponse {
  access_token: string;
  token_type: string;
  user_id: string;
}

export interface CreateDocumentRequest {
  title: string;
  group_id: string;
  content?: string;
  parent_id?: number | null;
}

export interface UpdateDocumentRequest {
  title?: string;
  content?: string;
  parent_id?: number | null;
  group_id?: string;
}

export interface CreateWorkspaceRequest {
  name: string;
}

export interface UpdateWorkspaceRequest {
  name: string;
}

// UI state types
export interface SidebarState {
  searchQuery: string;
  searchResults: Document[] | null;
  isSearchActive: boolean;
  collapsedWorkspaces: Set<string>;
}

// Context menu types
export interface ContextMenuItem {
  label: string;
  action: () => void;
  icon?: string;
  danger?: boolean;
  divider?: boolean;
}

export interface WorkspaceInvitation {
  id: number;
  group_id: string;
  role: string;
  invited_email: string;
  invited_by: string;
  created_at: string;
  accepted_at: string;
}

// Workflow types
export interface Workflow {
  id: number;
  name: string;
  schedule: number; // Seconds between runs
  user_id: string;
  description: string;
  last_executed?: string;
  last_results?: string; // JSON string
  checkpoint?: string; // JSON string
  auth?: string; // JSON string
  config?: Record<string, unknown>;
  prompt?: string;
  created_at: string;
  updated_at: string;
}

export interface WorkflowUpdateRequest {
  config?: Partial<SlackWorkflowConfig | ConversationWorkflowConfig>;
}

export interface ConversationWorkflowConfig {
  target_group_id: string;
  target_parent_document_id: string;
  initial_lookback_days: number;
  conversation_filters: {
    include: string[];
    exclude: string[];
  };
}

export interface SlackWorkflowConfig extends ConversationWorkflowConfig {
  team_id: string;
}

// Telegram folder (dialog filter) from Telegram API
export interface TelegramFolder {
  id: number;
  title: string;
  count: number;
}

// Telegram sync filters (auto-discovery settings)
export interface TelegramFilters {
  sync_unread_only: boolean;
  include_dms: boolean;
  include_groups: boolean;
  include_channels: boolean;
  include_muted: boolean;
  include_archived: boolean;
  mark_unread_after_sync: boolean;
}

// Paginated Telegram conversations response
export interface TelegramConversationsPage {
  conversations: Array<{
    id: string;
    name: string;
    type: 'private' | 'group' | 'channel';
    member_count?: number;
    last_message_date?: string;
  }>;
  has_more: boolean;
  total: number;
}
