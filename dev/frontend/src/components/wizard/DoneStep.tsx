interface DoneStepProps {
  name: string
}

export function DoneStep({ name }: DoneStepProps) {
  return (
    <div className="space-y-6">
      <div className="text-center mb-8">
        <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-orange-400/20 to-orange-500/20 flex items-center justify-center border border-white/10">
          <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
          </svg>
        </div>
        <h1 className="text-3xl font-light mb-2 text-white">Welcome, {name || 'User'}!</h1>
        <p className="text-gray-400">Codos is ready to go</p>
      </div>

      <div className="space-y-4">
        <div className="p-4 bg-black/30 rounded-xl border border-atlas-border">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <div>
              <h3 className="font-medium text-white mb-1">Chat with Codos</h3>
              <p className="text-sm text-gray-500">
                Ask questions about your work, get insights from your data, and automate tasks
              </p>
            </div>
          </div>
        </div>

        <div className="p-4 bg-black/30 rounded-xl border border-atlas-border">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-green-500/20 flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
            </div>
            <div>
              <h3 className="font-medium text-white mb-1">Daily Briefings</h3>
              <p className="text-sm text-gray-500">
                Get personalized morning briefings with your calendar, priorities, and action items
              </p>
            </div>
          </div>
        </div>

        <div className="p-4 bg-black/30 rounded-xl border border-atlas-border">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-orange-500/20 flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div>
              <h3 className="font-medium text-white mb-1">Skills & Automation</h3>
              <p className="text-sm text-gray-500">
                Use /commands to trigger skills like /brief, /todo, /research, and more
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-8 text-center">
        <p className="text-gray-600 text-sm">
          Press <kbd className="px-2 py-0.5 bg-white/5 rounded border border-white/10 font-mono text-xs">Finish</kbd> to open Codos
        </p>
      </div>
    </div>
  )
}
