import { useState, useEffect } from 'react'
import { API_BASE_URL } from '@/lib/api'

interface TelegramBotStepProps {
  telegramBotToken: string
  setTelegramBotToken: (token: string) => void
  authorizedUserIds: string
  setAuthorizedUserIds: (ids: string) => void
  telegramBotConfigured: boolean
  setTelegramBotConfigured: (configured: boolean) => void
  onSkip: () => void
}

export function TelegramBotStep({
  telegramBotToken,
  setTelegramBotToken,
  authorizedUserIds,
  setAuthorizedUserIds,
  telegramBotConfigured,
  setTelegramBotConfigured,
  onSkip,
}: TelegramBotStepProps) {
  const [showToken, setShowToken] = useState(false)
  const [isVerifying, setIsVerifying] = useState(false)
  const [verifyError, setVerifyError] = useState<string | null>(null)
  const [verifySuccess, setVerifySuccess] = useState<string | null>(null)
  const [botStatus, setBotStatus] = useState<{ running: boolean; pid: number | null; message: string } | null>(null)

  // Check bot status on mount
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/setup/telegram-bot/status`)
        if (response.ok) {
          const data = await response.json()
          setBotStatus({ running: data.running, pid: data.pid, message: data.message })
          if (data.configured) {
            setTelegramBotConfigured(true)
          }
        }
      } catch {
        // Ignore errors - status check is optional
      }
    }
    checkStatus()
  }, [setTelegramBotConfigured])

  // Validate bot token format: 123456789:ABC-DEF...
  const isTokenValid = /^\d+:[A-Za-z0-9_-]{35,}$/.test(telegramBotToken)

  // Validate user IDs: comma-separated numbers
  const isUserIdsValid = authorizedUserIds.trim() === '' ||
    /^(\d+\s*,\s*)*\d+$/.test(authorizedUserIds.trim())

  const verifyToken = async () => {
    if (!telegramBotToken || !isTokenValid) return

    setIsVerifying(true)
    setVerifyError(null)
    setVerifySuccess(null)

    try {
      const response = await fetch(`${API_BASE_URL}/api/setup/telegram-bot/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bot_token: telegramBotToken }),
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        setVerifyError(data.detail || data.error || 'Failed to verify token')
        return
      }

      if (data.success) {
        setVerifySuccess(`Bot verified: @${data.bot_username}`)
        setTelegramBotConfigured(true)
      } else {
        setVerifyError(data.error || 'Invalid token')
      }
    } catch {
      setVerifyError('Could not connect to server')
    } finally {
      setIsVerifying(false)
    }
  }

  const saveConfig = async () => {
    if (!isTokenValid || !isUserIdsValid) return

    setIsVerifying(true)
    setVerifyError(null)

    try {
      const response = await fetch(`${API_BASE_URL}/api/setup/telegram-bot/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bot_token: telegramBotToken,
          authorized_user_ids: authorizedUserIds,
        }),
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        setVerifyError(data.detail || data.error || 'Failed to save configuration')
        return
      }

      if (data.success) {
        setTelegramBotConfigured(true)
        setVerifySuccess(data.message || 'Configuration saved!')

        // Refresh status after a short delay to allow bot to start
        setTimeout(async () => {
          try {
            const statusResponse = await fetch(`${API_BASE_URL}/api/setup/telegram-bot/status`)
            if (statusResponse.ok) {
              const statusData = await statusResponse.json()
              setBotStatus({ running: statusData.running, pid: statusData.pid, message: statusData.message })
            }
          } catch {
            // Ignore status check errors
          }
        }, 2000)
      } else {
        setVerifyError(data.error || 'Failed to save')
      }
    } catch {
      setVerifyError('Could not connect to server')
    } finally {
      setIsVerifying(false)
    }
  }

  if (telegramBotConfigured) {
    const isRunning = botStatus?.running ?? false

    return (
      <div className="space-y-6">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-light mb-2 text-white">Atlas Telegram Bot</h1>
          <p className="text-gray-400">Chat with Claude directly in Telegram</p>
        </div>

        <div className="flex flex-col items-center justify-center py-8">
          <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-4 ${
            isRunning
              ? 'bg-green-500/20 border border-green-500/30'
              : 'bg-yellow-500/20 border border-yellow-500/30'
          }`}>
            <svg className={`w-8 h-8 ${isRunning ? 'text-green-400' : 'text-yellow-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className={`font-medium ${isRunning ? 'text-green-400' : 'text-yellow-400'}`}>
            {isRunning ? 'Bot running!' : 'Bot configured'}
          </p>
          <p className="text-gray-500 text-sm mt-2">
            {botStatus?.message || 'Your Atlas Telegram Bot is ready to use'}
          </p>
          {isRunning && botStatus?.pid && (
            <p className="text-gray-600 text-xs mt-1">PID: {botStatus.pid}</p>
          )}
        </div>

        <button
          onClick={() => setTelegramBotConfigured(false)}
          className="w-full py-2 text-gray-500 hover:text-gray-300 text-sm transition"
        >
          Reconfigure
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-light mb-2 text-white">Atlas Telegram Bot</h1>
        <p className="text-gray-400">Chat with Claude directly in Telegram</p>
      </div>

      {/* Step 1: Create Bot */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-white">
          <span className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-xs">1</span>
          <span className="font-medium">Create your bot</span>
        </div>

        <div className="pl-8 space-y-2 text-sm text-gray-400">
          <p>1. Open Telegram and search for <span className="text-white font-mono">@BotFather</span></p>
          <p>2. Send <span className="text-white font-mono">/newbot</span> and follow the prompts</p>
          <p>3. Copy the token (looks like <span className="text-gray-500 font-mono">123456:ABC-DEF...</span>)</p>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm text-gray-400">Bot Token</label>
            <a
              href="https://t.me/BotFather"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-400 hover:text-blue-300 transition"
            >
              Get token →
            </a>
          </div>
          <div className="relative">
            <input
              type={showToken ? 'text' : 'password'}
              value={telegramBotToken}
              onChange={(e) => {
                setTelegramBotToken(e.target.value)
                setVerifySuccess(null)
                setTelegramBotConfigured(false)
              }}
              placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz..."
              className="w-full bg-black border border-atlas-border rounded-lg px-4 py-3 pr-20 text-white placeholder-gray-600 focus:outline-none focus:border-white/30 font-mono text-sm"
            />
            <button
              type="button"
              onClick={() => setShowToken(!showToken)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition"
            >
              {showToken ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              )}
            </button>
          </div>
          {telegramBotToken && !isTokenValid && (
            <p className="text-xs text-red-400 mt-1">Invalid token format</p>
          )}
        </div>

        {telegramBotToken && isTokenValid && !verifySuccess && (
          <button
            onClick={verifyToken}
            disabled={isVerifying}
            className="w-full py-2 bg-white/10 text-white rounded-lg text-sm hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {isVerifying ? 'Verifying...' : 'Verify Token'}
          </button>
        )}
      </div>

      {/* Step 2: Authorize Users */}
      <div className="space-y-4 pt-4 border-t border-atlas-border">
        <div className="flex items-center gap-2 text-white">
          <span className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-xs">2</span>
          <span className="font-medium">Authorize users</span>
        </div>

        <div className="pl-8 space-y-2 text-sm text-gray-400">
          <p>1. Message <span className="text-white font-mono">@userinfobot</span> to get your user ID</p>
          <p>2. Enter IDs of users who can use this bot</p>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm text-gray-400">Authorized User IDs</label>
            <a
              href="https://t.me/userinfobot"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-400 hover:text-blue-300 transition"
            >
              Get my ID →
            </a>
          </div>
          <input
            type="text"
            value={authorizedUserIds}
            onChange={(e) => setAuthorizedUserIds(e.target.value)}
            placeholder="123456789, 987654321"
            className="w-full bg-black border border-atlas-border rounded-lg px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-white/30 font-mono text-sm"
          />
          <p className="text-xs text-gray-600 mt-1">Comma-separated Telegram user IDs</p>
          {authorizedUserIds && !isUserIdsValid && (
            <p className="text-xs text-red-400 mt-1">Invalid format. Use comma-separated numbers.</p>
          )}
        </div>
      </div>

      {/* Error/Success Messages */}
      {verifyError && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
          <p className="text-red-400 text-sm text-center">{verifyError}</p>
        </div>
      )}

      {verifySuccess && (
        <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
          <p className="text-green-400 text-sm text-center">{verifySuccess}</p>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-3 pt-4">
        <button
          onClick={onSkip}
          className="flex-1 py-3 bg-transparent border border-atlas-border text-gray-400 rounded-lg font-medium hover:border-gray-500 hover:text-gray-300 transition"
        >
          Skip
        </button>
        <button
          onClick={saveConfig}
          disabled={!isTokenValid || !isUserIdsValid || !authorizedUserIds || isVerifying}
          className="flex-1 py-3 bg-white text-black rounded-lg font-medium hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {isVerifying ? 'Saving...' : 'Save & Continue'}
        </button>
      </div>

      <p className="text-center text-xs text-gray-600">
        This step is optional. You can configure the bot later.
      </p>
    </div>
  )
}
