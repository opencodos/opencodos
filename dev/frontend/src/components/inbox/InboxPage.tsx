import { useState, useEffect, useCallback } from 'react'
import { inboxAPI } from '@/lib/api'
import type { VaultConversation } from '@/types/inbox'
import { InboxList } from './InboxList'
import { InboxDetail } from './InboxDetail'
import { Inbox, LayoutDashboard, BookOpen, Plug, Settings } from 'lucide-react'

const NAV_ITEMS = [
  { id: 'inbox', icon: Inbox, href: '#/inbox' },
  { id: 'agents', icon: LayoutDashboard, href: '#/agents' },
  { id: 'skills', icon: BookOpen, href: '#/skills' },
  { id: 'connectors', icon: Plug, href: '#/connectors' },
]

function SidebarRail() {
  return (
    <nav className="w-14 bg-[#0a0a0a] border-r border-white/10 flex flex-col items-center py-4 gap-1 shrink-0">
      {NAV_ITEMS.map(item => (
        <a
          key={item.id}
          href={item.href}
          className={`w-9 h-9 rounded-md flex items-center justify-center transition-colors ${
            item.id === 'inbox'
              ? 'bg-orange-500/20 text-orange-400'
              : 'text-[#737373] hover:bg-white/5 hover:text-[#a3a3a3]'
          }`}
          title={item.id.charAt(0).toUpperCase() + item.id.slice(1)}
        >
          <item.icon className="w-[18px] h-[18px]" />
        </a>
      ))}
      <div className="flex-1" />
      <a
        href="#/desktop-settings"
        className="w-9 h-9 rounded-md flex items-center justify-center text-[#737373] hover:bg-white/5 hover:text-[#a3a3a3] transition-colors"
        title="Settings"
      >
        <Settings className="w-[18px] h-[18px]" />
      </a>
    </nav>
  )
}

export function InboxPage() {
  const [conversations, setConversations] = useState<VaultConversation[]>([])
  const [selectedFilename, setSelectedFilename] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchConversations = useCallback(async () => {
    try {
      setLoading(true)
      const data = await inboxAPI.getConversations()
      setConversations(data.conversations)
      if (!selectedFilename && data.conversations.length > 0) {
        setSelectedFilename(data.conversations[0].filename)
      }
    } catch (err) {
      console.error('Failed to fetch conversations:', err)
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only set default on first load
  }, [])

  useEffect(() => {
    fetchConversations()
    // Poll every 30s for sync updates (silent, no loading spinner)
    const interval = setInterval(async () => {
      try {
        const data = await inboxAPI.getConversations()
        setConversations(data.conversations)
      } catch { /* silent */ }
    }, 30_000)
    return () => clearInterval(interval)
  }, [fetchConversations])

  const selectedConversation = conversations.find(c => c.filename === selectedFilename) || null

  return (
    <div className="flex h-screen bg-[#0a0a0f] animate-[fadeIn_200ms_ease-out]">
      <SidebarRail />
      <div className="flex flex-1 overflow-hidden">
        {/* Conversation List Panel */}
        <div className="w-[360px] border-r border-white/10 flex flex-col">
          <InboxList
            conversations={conversations}
            selectedFilename={selectedFilename}
            onSelect={setSelectedFilename}
            loading={loading}
          />
        </div>
        {/* Detail Panel */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {selectedConversation ? (
            <InboxDetail conversation={selectedConversation} />
          ) : (
            <div className="flex-1 flex items-center justify-center text-[#525252]">
              <div className="text-center">
                <Inbox className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-[13px]">Select a conversation</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
