import { useEffect, useState } from 'react'
import {
  ArrowLeft,
  Search,
  BookOpen,
  MessageSquare,
  FileText,
  Code,
  Palette,
  TrendingUp,
  Users,
  Sparkles,
} from 'lucide-react'

interface Skill {
  id: string
  name: string
  trigger: string
  description: string
  category: string
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8767'

const FALLBACK_SKILLS: Skill[] = [
  // Core Skills
  { id: 'brief', name: 'Morning Brief', trigger: '/brief', description: "Today's calendar, inbox highlights, priority tasks", category: 'Core' },
  { id: 'todo', name: 'Daily Todo', trigger: '/todo', description: "Generate today's todo from brief + carryover", category: 'Core' },
  { id: 'review', name: 'Weekly Review', trigger: '/review', description: 'Weekly reflection with wins, failures, learnings', category: 'Core' },
  { id: 'research', name: 'Research', trigger: '/research', description: 'Deep dive via Gemini Deep Research', category: 'Core' },

  // Communication
  { id: 'msg', name: 'Quick Message', trigger: '/msg', description: 'Quick send via Telegram/Slack/Email', category: 'Communication' },
  { id: 'draft', name: 'Draft Message', trigger: '/draft', description: 'Polished message with research + iteration', category: 'Communication' },
  { id: 'schedule', name: 'Schedule Meeting', trigger: '/schedule', description: 'Find slot, create event, send confirmation', category: 'Communication' },

  // People
  { id: 'memory', name: 'Memory Update', trigger: '/memory', description: 'Capture person facts from conversation to CRM', category: 'People' },
  { id: 'profile', name: 'Profile Lookup', trigger: '/profile', description: 'Load context about a person (fuzzy name match)', category: 'People' },
  { id: 'call-prep', name: 'Call Prep', trigger: '/call-prep', description: 'Generate meeting prep doc with research + YC questions', category: 'People' },

  // Engineering
  { id: 'plan', name: 'Engineering Plan', trigger: '/plan', description: 'Research-backed plan before building', category: 'Engineering' },
  { id: 'react', name: 'React Best Practices', trigger: '/react', description: 'Performance optimization for React/Next.js (57 rules)', category: 'Engineering' },
  { id: 'postgres', name: 'Supabase Postgres', trigger: '/postgres', description: 'PostgreSQL best practices and query optimization', category: 'Engineering' },
  { id: 'mcp-builder', name: 'MCP Builder', trigger: '/mcp-builder', description: 'Build MCP servers for LLM integrations', category: 'Engineering' },
  { id: 'qmd', name: 'QMD Search', trigger: '/qmd', description: 'Local semantic search across the Obsidian Vault', category: 'Engineering' },

  // Design
  { id: 'frontend-design', name: 'Frontend Design', trigger: '/frontend-design', description: 'Create distinctive UIs, avoid generic AI aesthetics', category: 'Design' },
  { id: 'web-design', name: 'Web Design', trigger: '/web-design', description: 'Review files for UI guideline compliance', category: 'Design' },
  { id: 'remotion', name: 'Remotion', trigger: '/remotion', description: 'Create videos programmatically with React', category: 'Design' },

  // Content
  { id: 'copywriting', name: 'Copywriting', trigger: '/copywriting', description: 'Conversion-focused copy for landing pages, ads, emails', category: 'Content' },
  { id: 'social', name: 'Social Content', trigger: '/social', description: 'Social media content for audience building', category: 'Content' },
  { id: 'brand-story', name: 'Brand Storytelling', trigger: '/brand-story', description: 'Tactical advice from 30 product leaders', category: 'Content' },

  // Business
  { id: 'founder-sales', name: 'Founder Sales', trigger: '/founder-sales', description: 'Tactical advice for founder-led sales', category: 'Business' },
  { id: 'pricing', name: 'Pricing Strategy', trigger: '/pricing', description: 'SaaS pricing, tiers, value metrics', category: 'Business' },
  { id: 'positioning', name: 'Positioning', trigger: '/positioning', description: 'Positioning & messaging from 58 product leaders', category: 'Business' },
  { id: 'launch', name: 'Launch Strategy', trigger: '/launch', description: 'Product launch planning and execution', category: 'Business' },
]

const CATEGORY_ORDER = ['Core', 'Communication', 'People', 'Engineering', 'Design', 'Content', 'Business', 'Other']

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  Core: <Sparkles className="w-4 h-4" />,
  Communication: <MessageSquare className="w-4 h-4" />,
  People: <Users className="w-4 h-4" />,
  Engineering: <Code className="w-4 h-4" />,
  Design: <Palette className="w-4 h-4" />,
  Content: <FileText className="w-4 h-4" />,
  Business: <TrendingUp className="w-4 h-4" />,
  Other: <BookOpen className="w-4 h-4" />,
}

export function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>(FALLBACK_SKILLS)
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState('All')

  useEffect(() => {
    const fetchSkills = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/skills`)
        if (!response.ok) return
        const data = await response.json() as Skill[]
        if (Array.isArray(data) && data.length > 0) {
          setSkills(data)
        }
      } catch {
        // Keep fallback list
      }
    }
    fetchSkills()
  }, [])

  const categories = [
    'All',
    ...CATEGORY_ORDER.filter((category) => skills.some((skill) => skill.category === category)),
    ...Array.from(new Set(skills.map((skill) => skill.category))).filter(
      (category) => !CATEGORY_ORDER.includes(category),
    ),
  ]

  const filteredSkills = skills.filter((skill) => {
    const matchesSearch =
      skill.name.toLowerCase().includes(search.toLowerCase()) ||
      skill.trigger.toLowerCase().includes(search.toLowerCase()) ||
      skill.description.toLowerCase().includes(search.toLowerCase())
    const matchesCategory = activeCategory === 'All' || skill.category === activeCategory
    return matchesSearch && matchesCategory
  })

  return (
    <div className="min-h-screen bg-black">
      {/* Header */}
      <header className="h-14 border-b border-white/10 flex items-center gap-4 px-4">
        <a
          href="#/agents"
          className="p-2 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition"
        >
          <ArrowLeft className="w-5 h-5" />
        </a>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-orange-500/20">
            <BookOpen className="w-5 h-5 text-orange-400" />
          </div>
          <div>
            <h1 className="text-white font-medium">Skills Library</h1>
            <p className="text-xs text-gray-500">{skills.length} skills available</p>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto p-6">
        {/* Search & Filters */}
        <div className="flex items-center gap-4 mb-6">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              placeholder="Search skills..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-orange-500/50 transition"
            />
          </div>
        </div>

        {/* Category Tabs */}
        <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-2">
          {categories.map((category) => (
            <button
              key={category}
              onClick={() => setActiveCategory(category)}
              className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition ${
                activeCategory === category
                  ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
                  : 'bg-white/5 text-gray-400 border border-white/5 hover:bg-white/10 hover:text-white'
              }`}
            >
              {category}
            </button>
          ))}
        </div>

        {/* Skills Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredSkills.map((skill) => (
            <SkillCard key={skill.id} skill={skill} icon={CATEGORY_ICONS[skill.category] || CATEGORY_ICONS.Other} />
          ))}
        </div>

        {filteredSkills.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-500">No skills found matching your search.</p>
          </div>
        )}
      </div>
    </div>
  )
}

function SkillCard({ skill, icon }: { skill: Skill; icon: React.ReactNode }) {
  return (
    <div className="bg-white/[0.03] border border-white/5 rounded-xl p-4 hover:bg-white/5 hover:border-white/10 card-hover group">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-white/5 text-gray-400 group-hover:bg-orange-500/20 group-hover:text-orange-400 transition">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-white font-medium">{skill.name}</h3>
            <span className="px-2 py-0.5 text-xs bg-white/5 text-orange-400 rounded-md font-mono">
              {skill.trigger}
            </span>
          </div>
          <p className="text-sm text-gray-400 leading-relaxed">{skill.description}</p>
          <span className="inline-block mt-2 text-xs text-gray-600">{skill.category}</span>
        </div>
      </div>
    </div>
  )
}
