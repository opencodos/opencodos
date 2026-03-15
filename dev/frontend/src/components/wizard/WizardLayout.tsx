interface WizardLayoutProps {
  children: React.ReactNode
  currentStep: number
  totalSteps: number
  onNext: () => void
  onBack: () => void
  canProceed: boolean
  isLastStep?: boolean
  onStartOver?: () => void
  continueLabel?: string
  continueVariant?: 'default' | 'subtle'
}

const STEP_NAMES = [
  'Welcome',
  'Secrets',
  'Dependencies',
  'Connectors',
  'Telegram Auth',
  'Conversations',
  'First Sync',
  'Schedules',
]

export function WizardLayout({
  children,
  currentStep,
  totalSteps,
  onNext,
  onBack,
  canProceed,
  isLastStep,
  onStartOver,
  continueLabel,
  continueVariant = 'default',
}: WizardLayoutProps) {
  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-8 relative z-10">
      <div className="w-full max-w-2xl">
        {/* Progress */}
        <div className="mb-8">
          <div className="flex justify-between mb-2">
            {STEP_NAMES.map((_, i) => (
              <div
                key={i}
                className={`text-xs ${
                  i <= currentStep ? 'text-white' : 'text-gray-600'
                }`}
              >
                {i + 1}
              </div>
            ))}
          </div>
          <div className="h-1 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-white transition-all duration-300"
              style={{ width: `${((currentStep + 1) / totalSteps) * 100}%` }}
            />
          </div>
          <p className="text-center text-gray-400 mt-2 text-sm">
            {STEP_NAMES[currentStep]}
          </p>
        </div>

        {/* Content */}
        <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-8">
          {children}
        </div>

        {/* Navigation */}
        <div className="flex justify-between mt-6">
          <div className="flex gap-4">
            <button
              onClick={onBack}
              disabled={currentStep === 0}
              className="px-6 py-2 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition"
            >
              Back
            </button>
            {onStartOver && currentStep > 0 && (
              <button
                onClick={onStartOver}
                className="px-4 py-2 text-gray-500 hover:text-red-400 text-sm transition"
              >
                Start Over
              </button>
            )}
          </div>
          <button
            onClick={onNext}
            disabled={!canProceed}
            className={`px-8 py-2 rounded-lg font-medium transition disabled:opacity-50 disabled:cursor-not-allowed ${
              continueVariant === 'subtle'
                ? 'bg-white/5 text-gray-300 border border-white/10 hover:bg-white/10 hover:text-white'
                : 'bg-white text-black hover:bg-gray-200'
            }`}
          >
            {continueLabel || (isLastStep ? 'Finish' : 'Continue')}
          </button>
        </div>

        {/* Version footer */}
        <p className="text-center text-gray-600 text-xs mt-6">
          v{__APP_VERSION__} &middot; Build: {__BUILD_HASH__} @ {new Date(__BUILD_DATETIME__).toLocaleString()}
        </p>
      </div>
    </div>
  )
}
