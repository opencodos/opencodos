import { useState, useEffect, useRef, type ReactNode } from 'react'
import { inboxAPI } from '@/lib/api'
import type { VaultMessage } from '@/types/inbox'
import { Loader2 } from 'lucide-react'

/**
 * Parse inline Telegram-style formatting: *bold*, **bold**, _italic_, `code`
 */
function formatInline(text: string): ReactNode[] {
  const parts: ReactNode[] = []
  // Match **bold**, *bold*, _italic_, `code`
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|_(.+?)_|`(.+?)`)/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    if (match[2]) {
      // **bold**
      parts.push(<strong key={match.index} className="font-semibold">{match[2]}</strong>)
    } else if (match[3]) {
      // *bold* (Telegram uses * for bold)
      parts.push(<strong key={match.index} className="font-semibold">{match[3]}</strong>)
    } else if (match[4]) {
      // _italic_
      parts.push(<em key={match.index}>{match[4]}</em>)
    } else if (match[5]) {
      // `code`
      parts.push(
        <code key={match.index} className="bg-white/10 px-1 py-0.5 rounded text-[13px] font-mono">
          {match[5]}
        </code>
      )
    }
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts.length > 0 ? parts : [text]
}

/**
 * Render message text with quote blocks, bold, italic, and code formatting.
 */
function FormattedMessage({ text }: { text: string }) {
  const lines = text.split('\n')
  const blocks: ReactNode[] = []
  let quoteLines: string[] = []
  let blockIdx = 0

  const flushQuote = () => {
    if (quoteLines.length === 0) return
    blocks.push(
      <div
        key={`q-${blockIdx++}`}
        className="border-l-2 border-orange-500/40 pl-2 my-1 text-[#a3a3a3] text-[13px]"
      >
        {quoteLines.map((ql, i) => (
          <div key={i}>{formatInline(ql)}</div>
        ))}
      </div>
    )
    quoteLines = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith('> ')) {
      quoteLines.push(line.slice(2))
    } else if (line === '>') {
      quoteLines.push('')
    } else {
      flushQuote()
      blocks.push(
        <div key={`l-${blockIdx++}`}>
          {line === '' ? <br /> : formatInline(line)}
        </div>
      )
    }
  }
  flushQuote()

  return <div className="text-sm text-[#fafafa] leading-relaxed">{blocks}</div>
}

const LAST_VIEWED_KEY = 'inbox-last-viewed'

function getLastViewedId(filename: string): number {
  try {
    const data = JSON.parse(localStorage.getItem(LAST_VIEWED_KEY) || '{}')
    return data[filename] || 0
  } catch {
    return 0
  }
}

interface TelegramThreadProps {
  filename: string
  lastMessageId?: number
}

export function TelegramThread({ filename }: TelegramThreadProps) {
  const [messages, setMessages] = useState<VaultMessage[]>([])
  const [loading, setLoading] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)
  const lastViewedId = useRef(getLastViewedId(filename))

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading state for fetch
    setLoading(true)
    lastViewedId.current = getLastViewedId(filename)

    inboxAPI.getMessages(filename).then(data => {
      if (!cancelled) {
        setMessages(data.messages || [])
        setLoading(false)
      }
    }).catch(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [filename])

  useEffect(() => {
    // Scroll to bottom when messages load
    if (!loading && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [loading, messages])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 text-[#737373] animate-spin" />
      </div>
    )
  }

  if (messages.length === 0) {
    return (
      <div className="text-center py-8 text-[#737373] text-sm">
        No messages found
      </div>
    )
  }

  // Group messages by date
  const grouped: Record<string, VaultMessage[]> = {}
  for (const msg of messages) {
    const date = msg.date || 'Unknown'
    if (!grouped[date]) grouped[date] = []
    grouped[date].push(msg)
  }

  // Messages are stored newest-first in Vault; reverse for chronological display
  const dateKeys = Object.keys(grouped).sort()
  for (const key of dateKeys) {
    grouped[key].reverse()
  }

  return (
    <div className="space-y-4">
      {dateKeys.map(date => (
        <div key={date}>
          {/* Date separator */}
          <div className="flex items-center gap-3 py-2">
            <div className="flex-1 h-px bg-white/10" />
            <span className="text-[10px] font-mono text-[#737373]">{date}</span>
            <div className="flex-1 h-px bg-white/10" />
          </div>

          {/* Messages for this date */}
          <div className="space-y-1.5">
            {grouped[date].map((msg, i) => {
              const isMe = msg.is_me ?? false
              return (
                <div
                  key={`${date}-${i}`}
                  className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`max-w-[80%] rounded-lg px-3 py-2 ${
                    isMe
                      ? 'bg-orange-500/10 border border-orange-500/20'
                      : 'bg-white/5 border border-white/5'
                  }`}>
                    {!isMe && (
                      <p className="text-[10px] text-orange-400 font-medium mb-0.5">
                        {msg.sender}
                      </p>
                    )}
                    <FormattedMessage text={msg.text} />
                    <p className="text-[10px] text-[#737373] font-mono mt-1 text-right">
                      {msg.time}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  )
}
