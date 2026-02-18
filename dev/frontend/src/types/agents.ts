// Agent Dashboard Types
// Types for WebSocket communication and agent management

// ==================== Dashboard State Types ====================

export type DashboardAgentStatus = 'idle' | 'running' | 'completed' | 'error'

export interface DashboardSessionState {
  session_id: string
  title: string
  status: DashboardAgentStatus
  tool_call_count: number
  current_tool: string | null
  text_preview: string
  input_tokens: number
  output_tokens: number
  started_at?: number
  recent_tool_calls: Array<{ name: string; status: string; input?: Record<string, unknown> }>
}

export interface DashboardAgentState {
  agent_id: string
  status: DashboardAgentStatus
  sessions: DashboardSessionState[]
}

// ==================== Message Types ====================

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  toolCalls?: ToolCall[];
  isStreaming?: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: unknown;
  status: 'pending' | 'running' | 'complete' | 'error';
  file?: string;
  progress?: number;
}

// ==================== Agent Types ====================

export interface Agent {
  id: string;
  name: string;
  role: string;
  icon: string;
  color: string;
  skills: string[];
  prompt?: string;
  memory?: string;
}

// ==================== Session Types ====================

export interface Session {
  id: string;
  title: string;
  agent_id: string;
  created_at: string;
  updated_at: string;
  active?: boolean;
  message_count?: number;
}

export interface SessionDetail {
  session_id: string;
  title: string;
  agent_id: string;
  active: boolean;
  messages: SessionMessage[];
}

export interface SessionMessage {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
  agent_id?: string;
}

export interface SessionAttachment {
  attachment_id: string;
  name: string;
  path: string;
  mime: string;
  size: number;
}

// ==================== WebSocket Message Types ====================

// Messages sent FROM client TO server
export type ClientMessage =
  | { type: 'message'; content: string; attachments?: SessionAttachment[]; agent_id: string; message_id?: string }
  | { type: 'permission_response'; tool_use_id: string; approved: boolean; reason?: string }
  | { type: 'activate'; agent_id: string };

export interface ContextUsage {
  inputTokens: number;
  outputTokens: number;
  contextLimit: number;
  model: string;
}

// Messages sent FROM server TO client
export type ServerMessage =
  | { type: 'hook_event'; hookEvent: string; timestamp: string; toolName?: string; toolInput?: Record<string, unknown>; toolResponse?: string; message?: string; notificationType?: string; transcriptPath?: string; stopReason?: string }
  | { type: 'permission_request'; toolUseId: string; toolName: string; toolInput?: Record<string, unknown>; timestamp: string }
  | { type: 'text_chunk'; content: string; timestamp: number }
  | { type: 'context_update'; inputTokens: number; outputTokens: number; model: string; contextLimit: number; timestamp: number }
  | { type: 'ack'; message_id: string; success: boolean }
  | { type: 'activated'; session_id: string }
  | { type: 'error'; message: string };

// Hook event types from Claude Code
export type HookEventType =
  | 'init'
  | 'tool_start'
  | 'tool_end'
  | 'message'
  | 'notification'
  | 'stop';

// ==================== API Response Types ====================

export interface SessionListResponse {
  sessions: Session[];
}

export interface CreateSessionResponse {
  id: string;
  title: string;
  agent_id: string;
  created_at: string;
  updated_at: string;
  active: boolean;
  message_count: number;
}

export interface ActivateSessionResponse {
  ok: boolean;
  active: boolean;
  session_id: string;
}

export interface DeleteSessionResponse {
  ok: boolean;
  killed: boolean;
  session_id: string;
}

// ==================== UI State Types ====================

export interface ChatState {
  messages: Message[];
  isConnected: boolean;
  isStreaming: boolean;
  pendingPermission: PendingPermission | null;
}

export interface PendingPermission {
  toolUseId: string;
  toolName: string;
  toolInput?: Record<string, unknown>;
  timestamp: string;
}
