interface WelcomeStepProps {
  name: string
  goals: string
  setGoals: (goals: string) => void
  onSkip?: () => void
}

export function WelcomeStep({
  name,
  goals,
  setGoals,
  onSkip
}: WelcomeStepProps) {
  const displayName = name ? name.split(' ')[0] : ''

  return (
    <div className="space-y-8">
      <div className="text-center">
        <h1 className="text-4xl font-light mb-3 tracking-tight text-white">
          {displayName ? `Welcome to Codos, ${displayName}!` : 'Welcome to Codos!'}
        </h1>
        <p className="text-gray-400 text-lg">Let's set up your AI Operating System</p>
      </div>

      <div className="space-y-4">
        <h2 className="text-xl text-white/90">What are your goals?</h2>

        <textarea
          value={goals}
          onChange={(e) => setGoals(e.target.value)}
          placeholder="What would you like to accomplish? What are you working on?"
          rows={6}
          className="w-full bg-black/50 border border-white/10 rounded-xl px-5 py-4 text-white text-lg placeholder-gray-600 focus:outline-none focus:border-white/30 focus:bg-black/70 resize-none transition-all"
        />

        {onSkip && (
          <div className="text-center pt-2">
            <button
              type="button"
              onClick={onSkip}
              className="text-gray-500 hover:text-gray-300 text-sm transition-colors"
            >
              Skip for now
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
