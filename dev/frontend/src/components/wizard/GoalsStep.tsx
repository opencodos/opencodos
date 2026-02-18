interface GoalsStepProps {
  goals: string
  setGoals: (goals: string) => void
}

export function GoalsStep({ goals, setGoals }: GoalsStepProps) {
  return (
    <div className="space-y-6">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-light mb-2 text-white">What are your goals?</h1>
        <p className="text-gray-400">
          Share your weekly, monthly or quarterly goals — Codos will focus on achieving them
        </p>
      </div>

      <div>
        <textarea
          value={goals}
          onChange={(e) => setGoals(e.target.value)}
          placeholder="Copy-paste your priorities or to-do list (you can edit it later)"
          rows={10}
          className="w-full bg-black border border-atlas-border rounded-lg px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-white/30 resize-none"
        />
        <p className="text-xs text-gray-500 mt-2">
          This will be saved to your context file and used by Codos to prioritize your work.
        </p>
      </div>
    </div>
  )
}
