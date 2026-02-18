import { useState, useCallback } from 'react'
import { API_BASE_URL } from '@/lib/api'

type FileCategory = 'todo' | 'crm' | 'daily' | 'note' | 'skip'
type ImportStatus = 'idle' | 'scanning' | 'previewing' | 'importing' | 'success' | 'error'

interface ImportFile {
  id: string
  source_path: string
  filename: string
  suggested_category: FileCategory
  user_category: FileCategory
  confidence: number
  reason: string
  size: number
  has_conflict: boolean
}

interface VaultImportStepProps {
  onComplete: () => void
  onSkip: () => void
}

const CATEGORY_INFO: Record<FileCategory, { label: string; color: string; destination: string }> = {
  todo: { label: 'Todos', color: 'text-green-400', destination: '3 - Todos/' },
  crm: { label: 'People', color: 'text-blue-400', destination: '4 - CRM/' },
  daily: { label: 'Daily', color: 'text-orange-400', destination: '0 - Daily Briefs/' },
  note: { label: 'Notes', color: 'text-gray-400', destination: '1 - Inbox (Last 7 days)/' },
  skip: { label: 'Skip', color: 'text-gray-600', destination: '(not imported)' },
}

const TARGET_FOLDER_BY_CATEGORY: Record<Exclude<FileCategory, 'skip'>, string> = {
  todo: '3 - Todos',
  crm: '4 - CRM',
  daily: '0 - Daily Briefs',
  note: '1 - Inbox (Last 7 days)',
}

export function VaultImportStep({ onComplete, onSkip }: VaultImportStepProps) {
  const [status, setStatus] = useState<ImportStatus>('idle')
  const [taskId, setTaskId] = useState<string | null>(null)
  const [files, setFiles] = useState<ImportFile[]>([])
  const [sourcePath, setSourcePath] = useState('')
  const [pathInput, setPathInput] = useState('')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [importStats, setImportStats] = useState({ imported: 0, skipped: 0, errors: 0 })

  const handleScanFolder = useCallback(async () => {
    if (!pathInput.trim()) return

    setStatus('scanning')
    setError(null)

    try {
      const response = await fetch(`${API_BASE_URL}/api/setup/vault-import/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder_path: pathInput.trim() }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.detail || 'Scan failed')
      }

      const data = await response.json()
      setTaskId(data.task_id)
      setSourcePath(data.source_path)
      setFiles(
        data.files.map((f: ImportFile) => ({
          ...f,
          user_category: f.suggested_category,
        }))
      )

      if (data.files.length === 0) {
        setError('No .md files found in this folder')
        setStatus('error')
      } else {
        setStatus('previewing')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to scan folder')
      setStatus('error')
    }
  }, [pathInput])

  const updateFileCategory = useCallback((fileId: string, newCategory: FileCategory) => {
    setFiles((prev) => prev.map((f) => (f.id === fileId ? { ...f, user_category: newCategory } : f)))
  }, [])

  const handleStartImport = useCallback(async () => {
    if (!taskId) return

    const updates = files.map((f) => ({
      id: f.id,
      path: f.source_path,
      category: f.user_category,
    }))

    const filesToImport = files
      .filter((f) => f.user_category !== 'skip')
      .map((f) => ({
        path: f.source_path,
        category: f.user_category,
        target_folder: TARGET_FOLDER_BY_CATEGORY[f.user_category as Exclude<FileCategory, 'skip'>],
      }))

    if (filesToImport.length === 0) {
      setError('No files selected for import')
      setStatus('error')
      return
    }

    try {
      const updateResponse = await fetch(`${API_BASE_URL}/api/setup/vault-import/update-categories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      })
      if (!updateResponse.ok) {
        throw new Error('Failed to update file categories')
      }

      const startResponse = await fetch(`${API_BASE_URL}/api/setup/vault-import/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: filesToImport }),
      })
      if (!startResponse.ok) {
        throw new Error('Failed to start import')
      }
      const startData = await startResponse.json() as { task_id: string }
      const importTaskId = startData.task_id

      setStatus('importing')

      const pollProgress = async () => {
        try {
          const response = await fetch(`${API_BASE_URL}/api/setup/vault-import/status/${importTaskId}`)
          if (!response.ok) {
            throw new Error('Failed to get import status')
          }
          const data = await response.json()

          const rawProgress = typeof data.progress === 'number' ? data.progress : 0
          const progressPercent = rawProgress <= 1 ? Math.round(rawProgress * 100) : Math.round(rawProgress)
          setProgress(progressPercent)
          setImportStats({
            imported: data.files_processed ?? 0,
            skipped: files.length - filesToImport.length,
            errors: data.status === 'failed' || data.error ? 1 : 0,
          })

          if (data.status === 'pending' || data.status === 'running') {
            setTimeout(pollProgress, 200)
          } else if (data.status === 'completed') {
            setStatus('success')
          } else if (data.status === 'failed') {
            setStatus('error')
            setError(data.error || 'Import failed')
          } else {
            setStatus('error')
            setError(`Unexpected import status: ${String(data.status)}`)
          }
        } catch (err) {
          setStatus('error')
          setError(err instanceof Error ? err.message : 'Import failed')
        }
      }

      pollProgress()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
      setStatus('error')
    }
  }, [taskId, files])

  return (
    <div className="space-y-6">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-light mb-2 text-white">Import Your Notes</h1>
        <p className="text-gray-400">
          {status === 'idle' && 'Import existing markdown files from Obsidian, Notion, or other sources'}
          {status === 'scanning' && 'Scanning folder...'}
          {status === 'previewing' && 'Review categories before importing'}
          {status === 'importing' && 'Importing files...'}
          {status === 'success' && 'Import complete!'}
          {status === 'error' && 'Something went wrong'}
        </p>
      </div>

      {status === 'idle' && (
        <IdleState
          pathInput={pathInput}
          setPathInput={setPathInput}
          onScan={handleScanFolder}
          onSkip={onSkip}
        />
      )}

      {status === 'scanning' && <ScanningState />}

      {status === 'previewing' && (
        <PreviewState
          files={files}
          sourcePath={sourcePath}
          onUpdateCategory={updateFileCategory}
          onStartImport={handleStartImport}
          onBack={() => setStatus('idle')}
        />
      )}

      {status === 'importing' && <ImportingState progress={progress} stats={importStats} />}

      {status === 'success' && <SuccessState stats={importStats} onContinue={onComplete} />}

      {status === 'error' && (
        <ErrorState error={error} onRetry={() => setStatus('idle')} onSkip={onSkip} />
      )}
    </div>
  )
}

function IdleState({
  pathInput,
  setPathInput,
  onScan,
  onSkip,
}: {
  pathInput: string
  setPathInput: (v: string) => void
  onScan: () => void
  onSkip: () => void
}) {
  const [browsing, setBrowsing] = useState(false)

  const handleBrowse = async () => {
    setBrowsing(true)
    try {
      const response = await fetch(`${API_BASE_URL}/api/setup/browse-folder`, {
        method: 'POST',
      })
      const data = await response.json()
      if (data.path) {
        setPathInput(data.path)
      }
    } catch (err) {
      console.error('Failed to open folder picker:', err)
    } finally {
      setBrowsing(false)
    }
  }

  return (
    <>
      <div className="flex flex-col items-center justify-center py-4">
        <div className="w-16 h-16 rounded-2xl bg-white/5 border border-atlas-border flex items-center justify-center mb-4">
          <svg
            className="w-8 h-8 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
            />
          </svg>
        </div>

        <div className="w-full max-w-md space-y-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
              placeholder="/path/to/your/vault"
              className="flex-1 bg-black border border-atlas-border rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-white/30"
              onKeyDown={(e) => e.key === 'Enter' && onScan()}
            />
            <button
              onClick={handleBrowse}
              disabled={browsing}
              className="px-4 py-3 bg-white/10 border border-atlas-border rounded-xl text-white hover:bg-white/20 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              title="Browse for folder"
            >
              {browsing ? (
                <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z"
                  />
                </svg>
              )}
            </button>
          </div>
          <button
            onClick={onScan}
            disabled={!pathInput.trim()}
            className="w-full px-6 py-3 bg-white text-black rounded-lg font-medium hover:bg-gray-200 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Scan Folder
          </button>
        </div>

        <p className="text-gray-500 text-sm mt-4 text-center max-w-md">
          Select a folder containing your markdown files. Codos will analyze them and
          suggest where to store each file.
        </p>
      </div>

      <div className="text-center">
        <button
          onClick={onSkip}
          className="text-gray-500 hover:text-gray-300 text-sm transition-colors"
        >
          Skip for now
        </button>
      </div>
    </>
  )
}

function ScanningState() {
  return (
    <div className="flex flex-col items-center justify-center py-12">
      <div className="w-12 h-12 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mb-4" />
      <p className="text-gray-400">Scanning files...</p>
    </div>
  )
}

function PreviewState({
  files,
  sourcePath,
  onUpdateCategory,
  onStartImport,
  onBack,
}: {
  files: ImportFile[]
  sourcePath: string
  onUpdateCategory: (id: string, category: FileCategory) => void
  onStartImport: () => void
  onBack: () => void
}) {
  const importCount = files.filter((f) => f.user_category !== 'skip').length

  const byCategory = files.reduce(
    (acc, f) => {
      acc[f.user_category] = (acc[f.user_category] || 0) + 1
      return acc
    },
    {} as Record<string, number>
  )

  return (
    <>
      <div className="p-4 bg-black/30 rounded-xl border border-atlas-border mb-4">
        <div className="text-sm text-gray-400 mb-2 truncate">
          From: <span className="text-white">{sourcePath}</span>
        </div>
        <div className="flex gap-4 flex-wrap">
          {Object.entries(byCategory).map(([cat, count]) => (
            <div key={cat} className="text-sm">
              <span className={CATEGORY_INFO[cat as FileCategory]?.color}>{count}</span>
              <span className="text-gray-500 ml-1">
                {CATEGORY_INFO[cat as FileCategory]?.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
        {files.map((file) => (
          <FileRow
            key={file.id}
            file={file}
            onCategoryChange={(cat) => onUpdateCategory(file.id, cat)}
          />
        ))}
      </div>

      <div className="flex gap-4 pt-4">
        <button
          onClick={onBack}
          className="px-6 py-2 border border-atlas-border rounded-lg text-white hover:bg-white/5 transition-colors"
        >
          Back
        </button>
        <button
          onClick={onStartImport}
          disabled={importCount === 0}
          className="flex-1 px-6 py-2 bg-white text-black rounded-lg hover:bg-gray-200 transition-colors font-medium disabled:opacity-50"
        >
          Import {importCount} Files
        </button>
      </div>
    </>
  )
}

function FileRow({
  file,
  onCategoryChange,
}: {
  file: ImportFile
  onCategoryChange: (category: FileCategory) => void
}) {
  return (
    <div className="flex items-center gap-3 p-3 bg-black/30 rounded-lg border border-atlas-border">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-white truncate">{file.filename}.md</span>
          {file.has_conflict && (
            <span className="text-xs text-yellow-400 px-1.5 py-0.5 bg-yellow-400/10 rounded flex-shrink-0">
              exists
            </span>
          )}
        </div>
        <div className="text-xs text-gray-500 truncate">{file.reason}</div>
      </div>

      <select
        value={file.user_category}
        onChange={(e) => onCategoryChange(e.target.value as FileCategory)}
        className="bg-black border border-atlas-border rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-white/30 flex-shrink-0"
      >
        {Object.entries(CATEGORY_INFO).map(([value, info]) => (
          <option key={value} value={value}>
            {info.label}
          </option>
        ))}
      </select>
    </div>
  )
}

function ImportingState({
  progress,
  stats,
}: {
  progress: number
  stats: { imported: number; skipped: number; errors: number }
}) {
  return (
    <div className="py-8">
      <div className="flex justify-between text-sm mb-2">
        <span className="text-gray-400">Importing files...</span>
        <span className="text-white">{progress}%</span>
      </div>
      <div className="h-2 bg-atlas-card rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-orange-400 to-orange-500 transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="mt-4 text-center text-sm text-gray-400">
        {stats.imported} imported
        {stats.skipped > 0 && `, ${stats.skipped} skipped`}
        {stats.errors > 0 && <span className="text-red-400">, {stats.errors} errors</span>}
      </div>
    </div>
  )
}

function SuccessState({
  stats,
  onContinue,
}: {
  stats: { imported: number; skipped: number; errors: number }
  onContinue: () => void
}) {
  return (
    <div className="text-center py-8">
      <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center border border-green-500/30 mx-auto mb-4">
        <svg
          className="w-8 h-8 text-green-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h2 className="text-xl text-white mb-2">Import Complete!</h2>
      <p className="text-gray-400 mb-6">
        Successfully imported {stats.imported} files
        {stats.skipped > 0 && `, skipped ${stats.skipped}`}
        {stats.errors > 0 && `, ${stats.errors} errors`}
      </p>
      <button
        onClick={onContinue}
        className="px-8 py-2 bg-white text-black rounded-lg font-medium hover:bg-gray-200 transition"
      >
        Continue
      </button>
    </div>
  )
}

function ErrorState({
  error,
  onRetry,
  onSkip,
}: {
  error: string | null
  onRetry: () => void
  onSkip: () => void
}) {
  return (
    <div className="text-center py-8">
      <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center border border-red-500/30 mx-auto mb-4">
        <svg
          className="w-8 h-8 text-red-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </div>
      <h2 className="text-xl text-white mb-2">Something went wrong</h2>
      <p className="text-gray-400 mb-6">{error || 'An unexpected error occurred'}</p>
      <div className="flex gap-4 justify-center">
        <button
          onClick={onRetry}
          className="px-6 py-2 border border-atlas-border rounded-lg text-white hover:bg-white/5 transition"
        >
          Try Again
        </button>
        <button
          onClick={onSkip}
          className="px-6 py-2 bg-white text-black rounded-lg font-medium hover:bg-gray-200 transition"
        >
          Skip
        </button>
      </div>
    </div>
  )
}
