import { useState, useEffect } from 'react'
import { API_BASE_URL } from '@/lib/api'
import { getDesktopAtlasApiKey } from '@/lib/desktopRuntimeBootstrap'

const authHeaders = (): Record<string, string> => {
  const key = getDesktopAtlasApiKey() || import.meta.env.VITE_ATLAS_API_KEY || ''
  return key ? { 'X-Atlas-Key': key } : {}
}

// Types
interface MemoryContext {
  name: string
  timezone: string
  location: string
  goals: string[]
  preferences: Record<string, string>
}

interface TodoStats {
  total: number
  completed: number
  pending: number
  date: string              // Which date's todos were loaded
  is_fallback: boolean      // True if fell back to previous day
}

interface CalendarEvent {
  time: string
  title: string
  context?: string
}

interface TodayContext {
  morning_brief_time: string | null
  morning_brief_date: string         // Which date's brief was loaded
  brief_is_fallback: boolean         // True if fell back to previous day
  todos: TodoStats
  next_calls: CalendarEvent[]
  calls_date?: string                // Which date's calls were loaded
  calls_is_fallback?: boolean        // True if calls fell back to previous day
  calls_source?: 'calendar' | 'brief'
  summary: string | null
  is_stale: boolean                  // True if any data is from past
}

interface LearningItem {
  text: string
  timestamp: string
  source?: string
}

interface ContextData {
  memory: MemoryContext
  today: TodayContext
  learnings: LearningItem[]
}

// Default/Fallback Data
function getDefaultContext(): ContextData {
  const today = new Date().toISOString().split('T')[0]
  return {
    memory: {
      name: 'User',
      timezone: 'UTC',
      location: 'Unknown',
      goals: ['No goals loaded'],
      preferences: {}
    },
    today: {
      morning_brief_time: null,
      morning_brief_date: today,
      brief_is_fallback: false,
      todos: { total: 0, completed: 0, pending: 0, date: today, is_fallback: false },
      next_calls: [],
      calls_date: today,
      calls_is_fallback: false,
      calls_source: 'brief',
      summary: null,
      is_stale: false
    },
    learnings: []
  }
}

// Hook Implementation
export function useContextPanel() {
  const [context, setContext] = useState<ContextData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchContext()
  }, [])

  const fetchContext = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/context`, {
        headers: authHeaders(),
      })
      if (!response.ok) throw new Error('Failed to fetch context')
      const data = await response.json()
      setContext(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      // Return fallback data
      setContext(getDefaultContext())
    } finally {
      setLoading(false)
    }
  }

  const refresh = () => {
    setLoading(true)
    fetchContext()
  }

  return { context, loading, error, refresh }
}

// Export types for use in components
export type {
  MemoryContext,
  TodoStats,
  CalendarEvent,
  TodayContext,
  LearningItem,
  ContextData
}
