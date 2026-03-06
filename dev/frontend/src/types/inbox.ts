// Telegram Inbox Types — reads from Vault markdown files

export interface VaultConversation {
  filename: string
  chat_name: string
  type: 'private' | 'group' | 'channel'
  last_synced: string
  last_message_id: number
  matched_contact_name: string | null
  telegram_id: string | null
  message_count: number
  preview: string
  needs_reply: boolean
  last_sender: string
  unread_count: number
}

export interface VaultMessage {
  time: string
  sender: string
  text: string
  date: string
  is_me?: boolean
}

export interface ConversationsResponse {
  conversations: VaultConversation[]
  total: number
}

export interface MessagesResponse {
  messages: VaultMessage[]
  filename: string
  chat_name: string
  type: string
  last_message_id: number
}

export interface InboxSuggestion {
  filename: string
  priority: 'high' | 'medium' | 'low'
  type: 'reply' | 'task' | 'schedule' | 'action' | 'ignore'
  label: string
  summary: string
  draft: string | null
  action: string | null
}

export interface SuggestionsResponse {
  suggestions: InboxSuggestion[]
  generated: string | null
}
