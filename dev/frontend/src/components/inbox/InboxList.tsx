import { useState } from 'react'
import type { VaultConversation } from '@/types/inbox'
import { ChevronDown, ChevronRight, Loader2, Search } from 'lucide-react'

function timeAgo(dateStr: string): string {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'now'
  if (diffMin < 60) return `${diffMin}m`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h`
  const diffDay = Math.floor(diffHr / 24)
  return `${diffDay}d`
}

interface InboxListProps {
  conversations: VaultConversation[]
  selectedFilename: string | null
  onSelect: (filename: string) => void
  loading: boolean
}

function ConversationRow({ conv, selected, onSelect }: { conv: VaultConversation; selected: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left px-4 py-3 border-b border-white/5 transition-colors duration-150 ${
        selected ? 'bg-white/[0.07]' : 'hover:bg-white/[0.03]'
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Unread indicator dot */}
        <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
          conv.unread_count > 0 ? 'bg-orange-500' : 'bg-transparent'
        }`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className={`text-sm truncate ${
              conv.unread_count > 0 ? 'font-semibold text-[#fafafa]' : 'font-medium text-[#a3a3a3]'
            }`}>
              {conv.chat_name}
            </span>
            <span className="text-[10px] text-[#737373] font-mono shrink-0">
              {timeAgo(conv.last_synced)}
            </span>
          </div>
          <p className="text-xs text-[#737373] mt-0.5 line-clamp-1">
            {conv.preview || 'No messages'}
          </p>
          <div className="flex items-center gap-1.5 mt-1 text-[10px] text-[#525252]">
            <span className="font-mono">Telegram</span>
            <span>·</span>
            <span className="font-mono">{conv.message_count} msgs</span>
          </div>
        </div>
      </div>
    </button>
  )
}

function SectionHeader({ label, count, open, onToggle }: { label: string; count: number; open: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center gap-2 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-[#737373] hover:text-[#a3a3a3] transition-colors border-b border-white/5 bg-white/[0.02] sticky top-0 z-10"
    >
      {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      <span>{label}</span>
      <span className="text-[#525252] font-mono">{count}</span>
    </button>
  )
}

export function InboxList({ conversations, selectedFilename, onSelect, loading }: InboxListProps) {
  const [search, setSearch] = useState('')
  const [unreadOpen, setUnreadOpen] = useState(true)
  const [readOpen, setReadOpen] = useState(false)

  const filtered = search
    ? conversations.filter(c =>
        c.chat_name.toLowerCase().includes(search.toLowerCase()) ||
        (c.matched_contact_name?.toLowerCase().includes(search.toLowerCase()))
      )
    : conversations

  const unread = filtered.filter(c => c.unread_count > 0)
  const read = filtered.filter(c => c.unread_count === 0)

  return (
    <div className="flex flex-col h-full bg-[#0a0a0a]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/10">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[#fafafa] font-[family-name:var(--font-heading)]">
            Inbox
          </h2>
          {(() => {
            const latest = conversations.reduce((max, c) => c.last_synced > max ? c.last_synced : max, '')
            return latest ? (
              <span className="text-[10px] text-[#525252] font-mono">
                synced {timeAgo(latest)} ago
              </span>
            ) : null
          })()}
        </div>
        <div className="relative mt-2">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#737373]" />
          <input
            type="text"
            placeholder="Search conversations..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-white/5 border border-white/10 rounded-md text-[#fafafa] placeholder:text-[#737373] focus:outline-none focus:border-orange-500/30"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 text-[#737373] animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-8 text-[#737373] text-sm">
            {search ? 'No matches' : 'No conversations'}
          </div>
        ) : (
          <>
            {/* Unread section */}
            <SectionHeader label="Unread" count={unread.length} open={unreadOpen} onToggle={() => setUnreadOpen(!unreadOpen)} />
            {unreadOpen && unread.map(conv => (
              <ConversationRow
                key={conv.filename}
                conv={conv}
                selected={selectedFilename === conv.filename}
                onSelect={() => onSelect(conv.filename)}
              />
            ))}

            {/* Read section */}
            <SectionHeader label="Read" count={read.length} open={readOpen} onToggle={() => setReadOpen(!readOpen)} />
            {readOpen && read.map(conv => (
              <ConversationRow
                key={conv.filename}
                conv={conv}
                selected={selectedFilename === conv.filename}
                onSelect={() => onSelect(conv.filename)}
              />
            ))}
          </>
        )}
      </div>
    </div>
  )
}
