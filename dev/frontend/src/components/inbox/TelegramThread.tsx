import { useState, useEffect, useRef } from 'react'
import { inboxAPI } from '@/lib/api'
import type { VaultMessage } from '@/types/inbox'
import { Loader2 } from 'lucide-react'

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
  lastMessageId: number
}

export function TelegramThread({ filename, lastMessageId }: TelegramThreadProps) {
  const [messages, setMessages] = useState<VaultMessage[]>([])
  const [loading, setLoading] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)
  const lastViewedId = useRef(getLastViewedId(filename))

  useEffect(() => {
    let cancelled = false
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
              const isMe = msg.sender.toLowerCase().includes('khanarin') || msg.sender.toLowerCase().startsWith('dima')
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
                    <p className="text-sm text-[#fafafa] leading-relaxed whitespace-pre-wrap">
                      {msg.text}
                    </p>
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
