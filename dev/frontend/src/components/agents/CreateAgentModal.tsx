import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { agentConfigAPI } from '@/lib/api'
import { SkillPicker } from './SkillPicker'
import {
  Wrench,
  FlaskConical,
  User,
  PenTool,
  Briefcase,
  Bot,
  Terminal,
  Loader2,
} from 'lucide-react'

const COLORS = ['blue', 'purple', 'green', 'pink', 'cyan', 'orange'] as const

const COLOR_CLASSES: Record<string, { ring: string; bg: string }> = {
  blue:   { ring: 'ring-blue-400',   bg: 'bg-blue-500' },
  purple: { ring: 'ring-purple-400', bg: 'bg-purple-500' },
  green:  { ring: 'ring-green-400',  bg: 'bg-green-500' },
  pink:   { ring: 'ring-pink-400',   bg: 'bg-pink-500' },
  cyan:   { ring: 'ring-cyan-400',   bg: 'bg-cyan-500' },
  orange: { ring: 'ring-orange-400', bg: 'bg-orange-500' },
}

const ICONS: { value: string; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { value: 'wrench', label: 'Wrench', Icon: Wrench },
  { value: 'flask-conical', label: 'Flask', Icon: FlaskConical },
  { value: 'user', label: 'User', Icon: User },
  { value: 'pen-tool', label: 'Pen', Icon: PenTool },
  { value: 'briefcase', label: 'Briefcase', Icon: Briefcase },
  { value: 'bot', label: 'Bot', Icon: Bot },
  { value: 'terminal', label: 'Terminal', Icon: Terminal },
]

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

interface CreateAgentModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}

export function CreateAgentModal({ open, onOpenChange, onCreated }: CreateAgentModalProps) {
  const [name, setName] = useState('')
  const [id, setId] = useState('')
  const [idEdited, setIdEdited] = useState(false)
  const [role, setRole] = useState('')
  const [color, setColor] = useState<string>('blue')
  const [icon, setIcon] = useState('bot')
  const [prompt, setPrompt] = useState('')
  const [selectedSkills, setSelectedSkills] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleNameChange = (value: string) => {
    setName(value)
    if (!idEdited) {
      setId(slugify(value))
    }
  }

  const handleSubmit = async () => {
    if (!name.trim() || !id.trim() || !role.trim()) {
      setError('Name, ID, and role are required')
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      await agentConfigAPI.createAgent({
        id: id.trim(),
        name: name.trim(),
        role: role.trim(),
        icon,
        color,
        skills: selectedSkills,
        prompt: prompt.trim() || undefined,
      })
      onCreated()
      onOpenChange(false)
      // Reset form
      setName('')
      setId('')
      setIdEdited(false)
      setRole('')
      setColor('blue')
      setIcon('bot')
      setPrompt('')
      setSelectedSkills([])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create agent')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-900 border-white/10 text-white sm:max-w-lg" showCloseButton>
        <DialogHeader>
          <DialogTitle className="text-white">Create Agent</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Name */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="e.g. Karpathy"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-orange-500/50 transition"
            />
          </div>

          {/* ID */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">ID (slug)</label>
            <input
              type="text"
              value={id}
              onChange={(e) => {
                setId(e.target.value)
                setIdEdited(true)
              }}
              placeholder="e.g. engineer"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-orange-500/50 transition font-mono"
            />
          </div>

          {/* Role */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Role</label>
            <input
              type="text"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="e.g. Senior software engineer"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-orange-500/50 transition"
            />
          </div>

          {/* Color */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Color</label>
            <div className="flex gap-2">
              {COLORS.map((c) => {
                const classes = COLOR_CLASSES[c]
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={`w-8 h-8 rounded-full ${classes.bg} transition ${
                      color === c ? `ring-2 ${classes.ring} ring-offset-2 ring-offset-zinc-900` : 'opacity-50 hover:opacity-80'
                    }`}
                    aria-label={c}
                  />
                )
              })}
            </div>
          </div>

          {/* Icon */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Icon</label>
            <div className="flex gap-2 flex-wrap">
              {ICONS.map(({ value, label, Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setIcon(value)}
                  className={`p-2 rounded-lg border transition ${
                    icon === value
                      ? 'border-orange-500/50 bg-orange-500/10 text-orange-400'
                      : 'border-white/10 bg-white/5 text-gray-400 hover:border-white/20 hover:text-white'
                  }`}
                  title={label}
                >
                  <Icon className="w-4 h-4" />
                </button>
              ))}
            </div>
          </div>

          {/* System Prompt */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">System Prompt</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Instructions for how this agent should behave..."
              rows={4}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-orange-500/50 transition resize-y font-mono"
            />
          </div>

          {/* Skills */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Skills</label>
            <SkillPicker value={selectedSkills} onChange={setSelectedSkills} />
          </div>

          {error && (
            <p className="text-sm text-red-400">{error}</p>
          )}
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !name.trim() || !id.trim() || !role.trim()}
            className="px-4 py-2 text-sm font-medium bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition flex items-center gap-2"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            Create Agent
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
