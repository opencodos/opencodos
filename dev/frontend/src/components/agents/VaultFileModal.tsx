import { useState, useEffect } from 'react'
import { Loader2, Save, Maximize2, Minimize2, Pencil, Eye, X } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { MarkdownViewer } from './MarkdownViewer'
import { clsx } from 'clsx'
import { API_BASE_URL } from '@/lib/api'
import { authHeaders } from '@/lib/vaultAuth'

// Vault file path mappings
export const VAULT_FILES = {
  aboutMe: 'Core Memory/About me.md',
  goals: 'Core Memory/Goals.md',
  morningBrief: (date: string) => `0 - Daily Briefs/${date}.md`,
  todos: (date: string) => `3 - Todos/${date}.md`,
  calls: (date: string) => `1 - Inbox (Last 7 days)/Calendar/${date}.md`,
} as const

export type VaultFileType = 'aboutMe' | 'goals' | 'morningBrief' | 'todos' | 'calls'

interface VaultFileModalProps {
  isOpen: boolean
  onClose: () => void
  fileType: VaultFileType
  mode: 'view' | 'edit'
  onSaved?: () => void
}

export function VaultFileModal({
  isOpen,
  onClose,
  fileType,
  mode,
  onSaved,
}: VaultFileModalProps) {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [currentMode, setCurrentMode] = useState<'view' | 'edit'>(mode)

  const filePath = getFilePath(fileType)
  const title = getTitle(fileType)
  const canEdit = fileType === 'aboutMe' || fileType === 'goals'

  useEffect(() => {
    if (isOpen) {
      setCurrentMode(mode)
    }
  }, [isOpen, mode, fileType])

  useEffect(() => {
    if (isOpen && filePath) {
      loadFile()
    }
  }, [isOpen, filePath])

  const loadFile = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/context/vault/file?path=${encodeURIComponent(filePath)}`,
        { headers: authHeaders() }
      )
      if (!response.ok) throw new Error('Failed to fetch file')
      const data = await response.json()
      setContent(data.content || '')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load file')
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`${API_BASE_URL}/api/context/vault/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ path: filePath, content }),
      })
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        throw new Error(errData.detail || 'Failed to save file')
      }
      onSaved?.()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save file')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        showCloseButton={false}
        className={clsx(
          'flex flex-col bg-black/95 border-white/10',
          isFullscreen
            ? 'w-[98vw] h-[96vh] max-w-[98vw] max-h-[96vh] sm:max-w-[98vw]'
            : 'max-w-2xl max-h-[80vh] sm:max-w-3xl',
        )}
      >
        <DialogHeader>
          <div className="flex items-center justify-between gap-3">
            <DialogTitle className="text-white">{title}</DialogTitle>
            <div className="flex items-center gap-2">
              {canEdit && (
                <button
                  onClick={() => setCurrentMode((prev) => (prev === 'edit' ? 'view' : 'edit'))}
                  className="p-1 text-gray-500 hover:text-gray-300 hover:bg-white/5 rounded-md transition"
                  aria-label={currentMode === 'edit' ? 'View mode' : 'Edit mode'}
                >
                  {currentMode === 'edit' ? <Eye className="w-4 h-4" /> : <Pencil className="w-4 h-4" />}
                </button>
              )}
              <button
                onClick={() => setIsFullscreen((prev) => !prev)}
                className="p-1 text-gray-500 hover:text-gray-300 hover:bg-white/5 rounded-md transition"
                aria-label={isFullscreen ? 'Exit full screen' : 'Enter full screen'}
              >
                {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </button>
              <DialogClose
                className="p-1 text-gray-500 hover:text-gray-300 hover:bg-white/5 rounded-md transition"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </DialogClose>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-[300px]">
          {loading ? (
            <div className="flex items-center justify-center h-full py-12">
              <Loader2 className="w-6 h-6 animate-spin text-orange-400" />
            </div>
          ) : error ? (
            <div className="p-4 rounded-lg border border-red-500/40 bg-red-500/10 text-red-400 text-sm">
              {error}
            </div>
          ) : currentMode === 'edit' ? (
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full h-full min-h-[400px] p-4 bg-white/5 border border-white/10 rounded-lg text-sm font-mono text-gray-300 resize-none focus:outline-none focus:ring-2 focus:ring-orange-500/50"
              placeholder="Enter content..."
            />
          ) : (
            <div className="p-4 bg-white/5 border border-white/10 rounded-lg">
              <MarkdownViewer content={content || 'No content'} />
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-white/10 pt-4">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {currentMode === 'edit' ? 'Cancel' : 'Close'}
          </Button>
          {currentMode === 'edit' && (
            <Button
              onClick={handleSave}
              disabled={saving || loading}
              className="bg-orange-500 hover:bg-orange-600"
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <Save className="mr-2 h-4 w-4" />
              Save
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function getFilePath(fileType: VaultFileType): string {
  const today = new Date().toISOString().split('T')[0]
  switch (fileType) {
    case 'aboutMe':
      return VAULT_FILES.aboutMe
    case 'goals':
      return VAULT_FILES.goals
    case 'morningBrief':
      return VAULT_FILES.morningBrief(today)
    case 'todos':
      return VAULT_FILES.todos(today)
    case 'calls':
      return VAULT_FILES.calls(today)
    default:
      return ''
  }
}

function getTitle(fileType: VaultFileType): string {
  switch (fileType) {
    case 'aboutMe':
      return 'About Me'
    case 'goals':
      return 'Goals'
    case 'morningBrief':
      return 'Morning Brief'
    case 'todos':
      return "Today's Todos"
    case 'calls':
      return "Today's Calls"
    default:
      return 'Vault File'
  }
}
