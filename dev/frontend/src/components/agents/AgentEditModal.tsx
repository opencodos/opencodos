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

interface AgentEditModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  content: string
  onSave: (newContent: string) => Promise<void>
  markdown?: boolean
}

export function AgentEditModal({
  isOpen,
  onClose,
  title,
  content: initialContent,
  onSave,
  markdown = false,
}: AgentEditModalProps) {
  const [content, setContent] = useState(initialContent)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [currentMode, setCurrentMode] = useState<'view' | 'edit'>('view')

  useEffect(() => {
    if (isOpen) {
      setContent(initialContent)
      setCurrentMode('view')
      setError(null)
    }
  }, [isOpen, initialContent])

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      await onSave(content)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
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
              <button
                onClick={() => setCurrentMode((prev) => (prev === 'edit' ? 'view' : 'edit'))}
                className="p-1 text-gray-500 hover:text-gray-300 hover:bg-white/5 rounded-md transition"
                aria-label={currentMode === 'edit' ? 'View mode' : 'Edit mode'}
              >
                {currentMode === 'edit' ? <Eye className="w-4 h-4" /> : <Pencil className="w-4 h-4" />}
              </button>
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
          {error && (
            <div className="mb-3 p-3 rounded-lg border border-red-500/40 bg-red-500/10 text-red-400 text-sm">
              {error}
            </div>
          )}
          {currentMode === 'edit' ? (
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full h-full min-h-[400px] p-4 bg-white/5 border border-white/10 rounded-lg text-sm font-mono text-gray-300 resize-none focus:outline-none focus:ring-2 focus:ring-orange-500/50"
              placeholder="Enter content..."
            />
          ) : markdown ? (
            <div className="p-4 bg-white/5 border border-white/10 rounded-lg">
              <MarkdownViewer content={content || 'No content'} />
            </div>
          ) : (
            <div className="p-4 bg-white/5 border border-white/10 rounded-lg">
              <pre className="text-sm text-gray-300 whitespace-pre-wrap font-mono leading-relaxed">
                {content || 'No content'}
              </pre>
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
              disabled={saving}
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
