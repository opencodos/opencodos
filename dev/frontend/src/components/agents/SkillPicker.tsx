import { useState, useEffect, useMemo } from 'react'
import { skillsAPI, type SkillInfo } from '@/lib/api'
import { Checkbox } from '@/components/ui/checkbox'
import { Search, ChevronRight, X } from 'lucide-react'

interface SkillPickerProps {
  value: string[]
  onChange: (triggers: string[]) => void
}

export function SkillPicker({ value, onChange }: SkillPickerProps) {
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  useEffect(() => {
    skillsAPI.listSkills().then(setSkills)
  }, [])

  const grouped = useMemo(() => {
    const lower = search.toLowerCase()
    const filtered = lower
      ? skills.filter(
          (s) =>
            s.trigger.toLowerCase().includes(lower) ||
            s.name.toLowerCase().includes(lower) ||
            s.description.toLowerCase().includes(lower),
        )
      : skills

    const map = new Map<string, SkillInfo[]>()
    for (const skill of filtered) {
      const list = map.get(skill.category) ?? []
      list.push(skill)
      map.set(skill.category, list)
    }

    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [skills, search])

  const toggle = (trigger: string) => {
    onChange(
      value.includes(trigger) ? value.filter((t) => t !== trigger) : [...value, trigger],
    )
  }

  const toggleCategory = (cat: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  const selectedCount = (category: string) => {
    const catSkills = skills.filter((s) => s.category === category)
    return catSkills.filter((s) => value.includes(s.trigger)).length
  }

  if (skills.length === 0) {
    return (
      <div className="text-xs text-gray-500 py-2">Loading skills...</div>
    )
  }

  return (
    <div>
      {/* Selected tags */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {value.map((trigger) => (
            <span
              key={trigger}
              className="px-2 py-1 text-xs bg-blue-500/10 text-blue-300 rounded-lg border border-blue-500/20 font-mono flex items-center gap-1"
            >
              {trigger}
              <button
                type="button"
                onClick={() => toggle(trigger)}
                className="hover:text-blue-100 transition"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Search */}
      <div className="relative mb-2">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search skills..."
          className="w-full bg-white/5 border border-white/10 rounded-lg pl-8 pr-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-orange-500/50 transition"
        />
      </div>

      {/* Categorized list */}
      <div className="max-h-[200px] overflow-y-auto border border-white/10 rounded-lg bg-white/[0.02]">
        {grouped.map(([category, catSkills]) => {
          const isCollapsed = collapsed.has(category)
          const count = selectedCount(category)
          return (
            <div key={category}>
              <button
                type="button"
                onClick={() => toggleCategory(category)}
                className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-400 hover:text-white hover:bg-white/5 transition sticky top-0 bg-zinc-900/95 backdrop-blur-sm z-10"
              >
                <ChevronRight
                  className={`w-3 h-3 transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
                />
                {category}
                {count > 0 && (
                  <span className="text-blue-400 ml-1">({count})</span>
                )}
              </button>
              {!isCollapsed &&
                catSkills.map((skill) => {
                  const checked = value.includes(skill.trigger)
                  return (
                    <label
                      key={skill.id}
                      className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-white/5 cursor-pointer transition"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggle(skill.trigger)}
                        className="border-white/20 data-[state=checked]:bg-blue-500 data-[state=checked]:border-blue-500"
                      />
                      <span className="text-xs font-mono text-gray-400 w-24 shrink-0 truncate">
                        {skill.trigger}
                      </span>
                      <span className="text-xs text-gray-300 truncate">
                        {skill.name}
                      </span>
                    </label>
                  )
                })}
            </div>
          )
        })}
        {grouped.length === 0 && (
          <div className="px-3 py-3 text-xs text-gray-500 text-center">
            No skills match "{search}"
          </div>
        )}
      </div>
    </div>
  )
}
