import { useEffect, useMemo, useState } from 'react'
import { ExternalLink, Loader2, Maximize2, Minimize2, X } from 'lucide-react'
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

interface VaultFileViewerModalProps {
  isOpen: boolean
  onClose: () => void
  filePath: string | null
}

export function VaultFileViewerModal({ isOpen, onClose, filePath }: VaultFileViewerModalProps) {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const isMarkdown = useMemo(() => (filePath || '').toLowerCase().endsWith('.md'), [filePath])
  const title = useMemo(() => {
    if (!filePath) return 'Vault File'
    const parts = filePath.split('/')
    return parts[parts.length - 1] || 'Vault File'
  }, [filePath])

  const downloadUrl = useMemo(() => {
    if (!filePath) return ''
    return `${API_BASE_URL}/api/context/vault/file/download?path=${encodeURIComponent(filePath)}`
  }, [filePath])

  useEffect(() => {
    if (!isOpen || !filePath || !isMarkdown) {
      setContent('')
      setError(null)
      setLoading(false)
      return
    }

    let isCancelled = false
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
        if (!isCancelled) {
          setContent(data.content || '')
        }
      } catch (err) {
        if (!isCancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load file')
        }
      } finally {
        if (!isCancelled) {
          setLoading(false)
        }
      }
    }

    void loadFile()
    return () => {
      isCancelled = true
    }
  }, [isOpen, filePath, isMarkdown])

  const handleOpen = async () => {
    if (!downloadUrl) return
    setError(null)
    try {
      const response = await fetch(downloadUrl, { headers: authHeaders() })
      if (!response.ok) throw new Error('Failed to open file')
      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      window.open(objectUrl, '_blank', 'noopener,noreferrer')
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open file')
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
            : 'max-w-3xl max-h-[80vh] sm:max-w-4xl',
        )}
      >
        <DialogHeader>
          <div className="flex items-center justify-between gap-3">
            <DialogTitle className="text-white">{title}</DialogTitle>
            <div className="flex items-center gap-2">
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
          {filePath && (
            <p className="text-xs text-gray-500 truncate">{filePath}</p>
          )}
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-[240px] space-y-3">
          {error && (
            <div className="p-4 rounded-lg border border-red-500/40 bg-red-500/10 text-red-400 text-sm">
              {error}
            </div>
          )}
          {isMarkdown ? (
            loading ? (
              <div className="flex items-center justify-center h-full py-12">
                <Loader2 className="w-6 h-6 animate-spin text-orange-400" />
              </div>
            ) : !error ? (
              <div className="p-4 bg-white/5 border border-white/10 rounded-lg">
                <MarkdownViewer content={content || 'No content'} />
              </div>
            ) : null
          ) : (
            <div className="p-4 bg-white/5 border border-white/10 rounded-lg text-sm text-gray-300">
              This file type opens in a new tab.
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-white/10 pt-4">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          {filePath && (
            <Button onClick={handleOpen} className="bg-orange-500 hover:bg-orange-600">
              <ExternalLink className="mr-2 h-4 w-4" />
              Open
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
