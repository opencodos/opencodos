import { useState, useEffect, useCallback } from 'react'
import { API_BASE_URL } from '@/lib/api'

interface TelegramAuthStepProps {
  connectors: string[]
  telegramStatus: 'idle' | 'sending' | 'code_sent' | 'verified' | 'error'
  setTelegramStatus: (status: 'idle' | 'sending' | 'code_sent' | 'verified' | 'error') => void
}

export function TelegramAuthStep({
  connectors,
  telegramStatus,
  setTelegramStatus,
}: TelegramAuthStepProps) {
  const [error, setError] = useState<string | null>(null)
  const [qrImage, setQrImage] = useState<string | null>(null)
  const [needs2FA, setNeeds2FA] = useState(false)
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [agentNotRunning, setAgentNotRunning] = useState(false)

  const telegramEnabled = connectors.includes('telegram')

  const initiateAuth = useCallback(async (force = false) => {
    setTelegramStatus('sending')
    setError(null)
    setAgentNotRunning(false)
    setQrImage(null)

    try {
      // Ensure Telegram agent is up before requesting auth QR.
      const startRes = await fetch(`${API_BASE_URL}/api/setup/telegram/start-agent`, { method: 'POST' })
      if (!startRes.ok) {
        setAgentNotRunning(true)
        setTelegramStatus('error')
        return
      }
      const startData = await startRes.json()
      if (startData.success === false) {
        setAgentNotRunning(true)
        setError(startData.message || 'Failed to start Telegram agent')
        setTelegramStatus('error')
        return
      }
      await new Promise((r) => setTimeout(r, 1200))

      const res = await fetch(`${API_BASE_URL}/telegram/auth/initiate${force ? '?force=true' : ''}`, { method: 'POST' })

      if (!res.ok) {
        if (res.status === 503) {
          setAgentNotRunning(true)
          setTelegramStatus('error')
          return
        }
        throw new Error(`Failed to initiate auth: ${res.status}`)
      }

      const data = await res.json()

      if (data.qr_image) {
        setQrImage(data.qr_image)
        setTelegramStatus('code_sent')
      } else if (data.status === 'authenticated') {
        setTelegramStatus('verified')
      } else if (data.status === 'initiating' || data.status === 'pending') {
        // Another auth initiation is in progress (e.g. React StrictMode double-mount).
        // Stay in 'sending' state — the polling effect in hydrate will pick up the QR.
        setTelegramStatus('sending')
      } else {
        throw new Error('No QR code received')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to start auth'
      // Network errors (fetch failed) → agent not running. Other errors → show message.
      if (msg.includes('fetch') || msg.includes('NetworkError') || msg.includes('Failed to fetch')) {
        setAgentNotRunning(true)
      } else {
        setError(msg)
      }
      setTelegramStatus('error')
    }
  }, [setTelegramStatus])

  // Hydrate existing auth state on mount instead of always resetting via initiate.
  // Run only once on mount — deps intentionally excluded to avoid re-triggering.
  useEffect(() => {
    if (!telegramEnabled) return
    if (telegramStatus === 'verified') return

    const hydrate = async () => {
      try {
        const statusRes = await fetch(`${API_BASE_URL}/telegram/auth/status`)
        if (statusRes.ok) {
          const statusData = await statusRes.json()
          if (statusData.status === 'authenticated') {
            setTelegramStatus('verified')
            return
          }
          if (statusData.status === 'needs_2fa') {
            setNeeds2FA(true)
            setTelegramStatus('code_sent')
            return
          }
          if (statusData.status === 'pending' && statusData.qr_image) {
            setQrImage(statusData.qr_image)
            setTelegramStatus('code_sent')
            return
          }
          if (statusData.status === 'initiating') {
            // Another auth initiation is in progress — don't start a new one
            setTelegramStatus('sending')
            return
          }
        }
      } catch {
        // Fall through to initiate flow.
      }

      initiateAuth()
    }

    void hydrate()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [telegramEnabled])

  // Poll for auth status
  useEffect(() => {
    if (telegramStatus !== 'code_sent' && telegramStatus !== 'sending') return
    if (telegramStatus === 'code_sent' && !qrImage) return

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/telegram/auth/status`)
        const data = await res.json()

        if (data.status === 'authenticated') {
          setTelegramStatus('verified')
        } else if (data.status === 'needs_2fa') {
          setNeeds2FA(true)
        } else if (data.status === 'expired') {
          setError('QR code expired')
          setTelegramStatus('idle')
          setQrImage(null)
        } else if (data.status === 'pending' && data.qr_image && !qrImage) {
          // Pick up QR code generated by a concurrent initiate call
          setQrImage(data.qr_image)
          setTelegramStatus('code_sent')
        }
      } catch {
        // Ignore polling errors
      }
    }, 2000)

    return () => clearInterval(interval)
  }, [telegramStatus, qrImage, setTelegramStatus])

  const submit2FA = async () => {
    if (!password) return
    setIsSubmitting(true)
    setError(null)

    try {
      const res = await fetch(`${API_BASE_URL}/telegram/auth/2fa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })

      const data = await res.json()

      if (data.status === 'authenticated') {
        setTelegramStatus('verified')
        setNeeds2FA(false)
      } else {
        setError('Invalid password')
      }
    } catch {
      setError('Failed to submit password')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!telegramEnabled) {
    return (
      <div className="space-y-6">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-light mb-2 text-white">Telegram Authentication</h1>
          <p className="text-gray-400">Telegram connector not selected</p>
        </div>

        <div className="flex flex-col items-center justify-center py-12">
          <div className="w-16 h-16 rounded-full bg-gray-500/20 flex items-center justify-center border border-gray-500/30 mb-4">
            <svg className="w-8 h-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-gray-400 text-center">
            You didn't select Telegram as a connector.
            <br />
            You can skip this step.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-light mb-2 text-white">Telegram Authentication</h1>
        <p className="text-gray-400">Connect your Telegram account</p>
      </div>

      {telegramStatus === 'verified' ? (
        <div className="flex flex-col items-center justify-center py-8">
          <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center border border-green-500/30 mb-4">
            <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-green-400 font-medium">Telegram connected!</p>
          <p className="text-gray-500 text-sm mt-2">Your account is linked successfully</p>
        </div>
      ) : needs2FA ? (
        <div className="space-y-4">
          <div className="flex items-center justify-center mb-4">
            <div className="w-12 h-12 rounded-full bg-yellow-500/20 flex items-center justify-center border border-yellow-500/30">
              <svg className="w-6 h-6 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
          </div>
          <p className="text-center text-gray-400 text-sm">
            Two-factor authentication is enabled.<br />
            Enter your Telegram password to continue.
          </p>
          <div>
            <label className="block text-sm text-gray-400 mb-2">2FA Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your 2FA password"
              className="w-full bg-black border border-atlas-border rounded-lg px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-white/30"
              autoFocus
            />
          </div>
          <button
            onClick={submit2FA}
            disabled={!password || isSubmitting}
            className="w-full py-3 bg-white text-black rounded-lg font-medium hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {isSubmitting ? 'Verifying...' : 'Submit Password'}
          </button>
        </div>
      ) : telegramStatus === 'code_sent' && qrImage ? (
        <div className="flex flex-col items-center gap-4 py-4">
          <img
            src={`data:image/png;base64,${qrImage}`}
            alt="Telegram QR Code"
            className="w-64 h-64 border border-atlas-border rounded-lg"
          />
          <div className="flex items-center gap-2 text-gray-400 text-sm">
            <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Waiting for scan...
          </div>
          <p className="text-xs text-center text-gray-500 max-w-sm">
            Open Telegram on your phone → Settings → Devices → Link Desktop Device → Scan this QR code
          </p>
          <button
            onClick={() => initiateAuth(true)}
            className="text-gray-500 hover:text-gray-300 text-sm transition"
          >
            Refresh QR code
          </button>
        </div>
      ) : telegramStatus === 'sending' ? (
        <div className="flex flex-col items-center justify-center py-12 gap-4">
          <svg className="w-8 h-8 animate-spin text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <p className="text-gray-400 text-sm">Generating QR code...</p>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-8">
          <button
            onClick={() => initiateAuth()}
            className="py-3 px-8 bg-white text-black rounded-lg font-medium hover:bg-gray-200 transition"
          >
            Start Authentication
          </button>
        </div>
      )}

      {/* Agent Not Running Warning */}
      {agentNotRunning && (
        <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-yellow-500/20 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div>
              <p className="text-yellow-400 font-medium">Telegram service is not running</p>
              <p className="text-yellow-400/70 text-sm">Start the Telegram agent first</p>
            </div>
          </div>
          <button
            onClick={async () => {
              setAgentNotRunning(false)
              try {
                const startRes = await fetch(`${API_BASE_URL}/api/setup/telegram/start-agent`, { method: 'POST' })
                if (!startRes.ok) {
                  throw new Error(`Failed to start Telegram agent: ${startRes.status}`)
                }
                await new Promise(r => setTimeout(r, 1500))
              } catch {
                // Ignore
              }
              initiateAuth()
            }}
            className="w-full py-2.5 bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 rounded-lg font-medium hover:bg-yellow-500/30 transition flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Retry
          </button>
        </div>
      )}

      {/* Error */}
      {error && !agentNotRunning && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
          <p className="text-red-400 text-sm text-center">{error}</p>
        </div>
      )}
    </div>
  )
}
