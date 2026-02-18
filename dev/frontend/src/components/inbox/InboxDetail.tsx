import { useState, useEffect } from 'react'
import type { VaultConversation, InboxSuggestion } from '@/types/inbox'
import { inboxAPI } from '@/lib/api'
import { TelegramThread } from './TelegramThread'
import { InboxChat } from './InboxChat'
import { ExternalLink, MessageSquare, Reply, Users, UserCheck, CheckCircle, Calendar, Zap, Copy, Check, Send, X, Loader2 } from 'lucide-react'

interface InboxDetailProps {
  conversation: VaultConversation
}

const TYPE_BADGE: Record<InboxSuggestion['type'], { label: string; cls: string }> = {
  reply: { label: 'Reply', cls: 'bg-green-500/15 text-green-400' },
  task: { label: 'Task', cls: 'bg-purple-500/15 text-purple-400' },
  schedule: { label: 'Schedule', cls: 'bg-blue-500/15 text-blue-400' },
  action: { label: 'Action', cls: 'bg-orange-500/15 text-orange-400' },
  ignore: { label: 'No action', cls: 'bg-white/5 text-[#737373]' },
}

function AISuggestionCard({ suggestion, telegramId, onAskCodos, onDismiss }: { suggestion: InboxSuggestion; telegramId: number | null; onAskCodos: () => void; onDismiss: () => void }) {
  const [draft, setDraft] = useState(suggestion.draft ?? '')
  const [replyOpen, setReplyOpen] = useState(false)
  const [sendState, setSendState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const badge = TYPE_BADGE[suggestion.type]

  const handleSend = async () => {
    if (!draft || !telegramId) return
    setSendState('sending')
    const result = await inboxAPI.sendMessage(telegramId, draft)
    if (result.success) {
      setSendState('sent')
    } else {
      console.error('Failed to send:', result.error)
      setSendState('error')
      setTimeout(() => setSendState('idle'), 3000)
    }
  }

  // Reply textarea + send button (shared between draft and manual reply)
  const replyBox = (
    <div className="px-3 pb-2.5">
      <textarea
        value={draft}
        onChange={e => setDraft(e.target.value)}
        placeholder={suggestion.draft ? undefined : "Type your reply..."}
        autoFocus={!suggestion.draft}
        className="w-full rounded-md bg-white/[0.04] border border-white/5 px-3 py-2.5 text-xs text-[#d4d4d4] leading-relaxed resize-none focus:outline-none focus:border-orange-500/30 transition-colors placeholder:text-[#525252]"
        rows={Math.max(2, draft.split('\n').length)}
      />
      <div className="flex items-center gap-2 mt-2">
        <button
          onClick={handleSend}
          disabled={sendState === 'sending' || sendState === 'sent' || !telegramId || !draft.trim()}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {sendState === 'sending' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : sendState === 'sent' ? <Check className="w-3.5 h-3.5" /> : sendState === 'error' ? <X className="w-3.5 h-3.5" /> : <Send className="w-3.5 h-3.5" />}
          {sendState === 'sending' ? 'Sending...' : sendState === 'sent' ? 'Sent' : sendState === 'error' ? 'Failed' : 'Send'}
        </button>
        {!suggestion.draft && (
          <button
            onClick={() => { setReplyOpen(false); setDraft('') }}
            className="text-xs text-[#737373] hover:text-[#a3a3a3] transition-colors px-2 py-1.5"
          >
            Cancel
          </button>
        )}
        <button
          onClick={onDismiss}
          className="text-xs text-[#737373] hover:text-[#a3a3a3] transition-colors px-2 py-1.5"
        >
          Dismiss
        </button>
      </div>
    </div>
  )

  // Action buttons row (Reply, Ask Codos, Dismiss)
  const actionButtons = (
    <div className="px-3 pb-2.5">
      <div className="flex items-center gap-2">
        {telegramId && (
          <button
            onClick={() => setReplyOpen(true)}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md bg-white/5 text-[#d4d4d4] hover:bg-white/10 transition-colors"
          >
            <Send className="w-3.5 h-3.5" />
            Reply
          </button>
        )}
        <button
          onClick={onAskCodos}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 transition-colors"
        >
          <MessageSquare className="w-3.5 h-3.5" />
          Ask Codos
        </button>
        <button
          onClick={onDismiss}
          className="text-xs text-[#737373] hover:text-[#a3a3a3] transition-colors px-2 py-1.5"
        >
          Dismiss
        </button>
      </div>
    </div>
  )

  return (
    <div className="mx-5 mt-3 rounded-lg border border-white/10 bg-white/[0.02] overflow-hidden">
      {/* Header: avatar + badge + summary */}
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <div className="w-6 h-6 rounded-full bg-orange-500 flex items-center justify-center shrink-0 mt-0.5">
          <span className="text-[10px] font-bold text-white">C</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold text-[#fafafa]">Codos</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-medium ${badge.cls}`}>
              {badge.label}
            </span>
          </div>
          <p className="text-xs text-[#a3a3a3] leading-relaxed">{suggestion.summary}</p>
        </div>
      </div>

      {/* AI draft reply → always show reply box */}
      {suggestion.draft && replyBox}

      {/* Action step (no draft) */}
      {suggestion.action && !suggestion.draft && (
        <>
          <div className="px-3 pb-2">
            <div className="rounded-md bg-white/[0.04] border border-white/5 px-3 py-2.5">
              <p className="text-xs text-[#d4d4d4] leading-relaxed">{suggestion.action}</p>
            </div>
          </div>
          {replyOpen ? replyBox : actionButtons}
        </>
      )}

      {/* No action, no draft — just summary */}
      {!suggestion.draft && !suggestion.action && (
        replyOpen ? replyBox : actionButtons
      )}
    </div>
  )
}

function HeuristicSuggestionCard({ conversation, telegramId, onAskCodos }: { conversation: VaultConversation; telegramId: number | null; onAskCodos: () => void }) {
  const [replyOpen, setReplyOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [sendState, setSendState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  let icon = <MessageSquare className="w-3.5 h-3.5" />
  let text = ''
  let color = 'text-[#737373]'
  let bg = 'bg-white/[0.03]'

  if (conversation.needs_reply) {
    icon = <Reply className="w-3.5 h-3.5" />
    text = `Reply needed — last message from ${conversation.last_sender}`
    color = 'text-orange-400'
    bg = 'bg-orange-500/5'
  } else if (conversation.type === 'group' && conversation.message_count > 20) {
    icon = <Users className="w-3.5 h-3.5" />
    text = `Catch up — ${conversation.message_count} messages`
    color = 'text-blue-400'
    bg = 'bg-blue-500/5'
  } else if (conversation.matched_contact_name) {
    icon = <UserCheck className="w-3.5 h-3.5" />
    text = `CRM contact — consider following up`
    color = 'text-purple-400'
    bg = 'bg-purple-500/5'
  } else {
    return null
  }

  const handleSend = async () => {
    if (!draft || !telegramId) return
    setSendState('sending')
    const result = await inboxAPI.sendMessage(telegramId, draft)
    if (result.success) {
      setSendState('sent')
    } else {
      console.error('Failed to send:', result.error)
      setSendState('error')
      setTimeout(() => setSendState('idle'), 3000)
    }
  }

  return (
    <div className={`mx-5 mt-3 rounded-lg ${bg} border border-white/5 overflow-hidden`}>
      <div className="flex items-center gap-3 px-3 py-2">
        <span className={color}>{icon}</span>
        <span className={`text-xs ${color} flex-1`}>{text}</span>
        {conversation.needs_reply && telegramId && (
          <button
            onClick={() => setReplyOpen(!replyOpen)}
            className="flex items-center gap-1.5 text-[10px] font-medium px-2 py-1 rounded-md bg-white/5 text-[#d4d4d4] hover:bg-white/10 transition-colors"
          >
            <Send className="w-3 h-3" />
            Reply
          </button>
        )}
        <button
          onClick={onAskCodos}
          className="flex items-center gap-1.5 text-[10px] font-medium px-2 py-1 rounded-md bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 transition-colors"
        >
          <MessageSquare className="w-3 h-3" />
          Ask Codos
        </button>
      </div>
      {replyOpen && (
        <div className="px-3 pb-2.5">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder="Type your reply..."
            autoFocus
            className="w-full rounded-md bg-white/[0.04] border border-white/5 px-3 py-2.5 text-xs text-[#d4d4d4] leading-relaxed resize-none focus:outline-none focus:border-orange-500/30 transition-colors placeholder:text-[#525252]"
            rows={3}
          />
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={handleSend}
              disabled={sendState === 'sending' || sendState === 'sent' || !draft.trim()}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {sendState === 'sending' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : sendState === 'sent' ? <Check className="w-3.5 h-3.5" /> : sendState === 'error' ? <X className="w-3.5 h-3.5" /> : <Send className="w-3.5 h-3.5" />}
              {sendState === 'sending' ? 'Sending...' : sendState === 'sent' ? 'Sent' : sendState === 'error' ? 'Failed' : 'Send'}
            </button>
            <button
              onClick={() => { setReplyOpen(false); setDraft('') }}
              className="text-xs text-[#737373] hover:text-[#a3a3a3] transition-colors px-2 py-1.5"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function InboxDetail({ conversation }: InboxDetailProps) {
  const [chatOpen, setChatOpen] = useState(false)
  const [suggestion, setSuggestion] = useState<InboxSuggestion | null>(null)
  const [suggestionsLoaded, setSuggestionsLoaded] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    setSuggestion(null)
    setSuggestionsLoaded(false)
    setDismissed(false)

    inboxAPI.getSuggestions().then((data) => {
      const match = data.suggestions.find((s) => s.filename === conversation.filename)
      setSuggestion(match ?? null)
      setSuggestionsLoaded(true)
    })
  }, [conversation.filename])

  return (
    <div className="flex flex-col h-full bg-[#0a0a0f]">
      {/* Header */}
      <div className="px-5 py-3 border-b border-white/10 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-[#fafafa]">{conversation.chat_name}</h3>
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${
            conversation.type === 'private' ? 'bg-blue-500/15 text-blue-400' :
            conversation.type === 'group' ? 'bg-purple-500/15 text-purple-400' :
            'bg-gray-500/15 text-gray-400'
          }`}>
            {conversation.type}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {conversation.matched_contact_name && (
            <a
              href="#/crm"
              className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-full bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
              CRM: {conversation.matched_contact_name}
            </a>
          )}
        </div>
      </div>

      {/* Suggestion Card — AI-powered with heuristic fallback */}
      {!dismissed && (
        suggestion ? (
          <AISuggestionCard suggestion={suggestion} telegramId={conversation.telegram_id ? Number(conversation.telegram_id) : null} onAskCodos={() => setChatOpen(true)} onDismiss={() => setDismissed(true)} />
        ) : suggestionsLoaded ? (
          <HeuristicSuggestionCard conversation={conversation} telegramId={conversation.telegram_id ? Number(conversation.telegram_id) : null} onAskCodos={() => setChatOpen(true)} />
        ) : null
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4 min-h-0">
        <TelegramThread
          filename={conversation.filename}
          lastMessageId={conversation.last_message_id}
        />
      </div>

      {/* Agent Chat Panel */}
      <InboxChat
        filename={conversation.filename}
        chatName={conversation.chat_name}
        isOpen={chatOpen}
        onToggle={() => setChatOpen(!chatOpen)}
      />
    </div>
  )
}
