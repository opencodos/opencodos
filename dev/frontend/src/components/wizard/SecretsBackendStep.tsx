import { useState, useEffect } from 'react'
import { API_BASE_URL } from '@/lib/api'

interface SecretsBackendStepProps {
  secretsBackend: string
  setSecretsBackend: (backend: string) => void
  getAuthHeaders: () => Record<string, string>
}

const BACKEND_LABELS: Record<string, { name: string; description: string }> = {
  json_file: {
    name: 'JSON File',
    description: 'JSON file stored locally at ~/.codos/secrets.json',
  },
}

export function SecretsBackendStep({ secretsBackend, setSecretsBackend, getAuthHeaders }: SecretsBackendStepProps) {
  const [options, setOptions] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/setup/secrets-backend`, { headers: getAuthHeaders() })
      .then((res) => res.json())
      .then((data) => {
        setOptions(data.options)
        if (!secretsBackend) {
          setSecretsBackend(data.current)
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-6">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-light mb-2 text-white">Secrets Storage</h1>
        <p className="text-gray-400">Choose where to store your API keys and credentials</p>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-3">
          {options.map((backend) => {
            const label = BACKEND_LABELS[backend]
            if (!label) return null
            const selected = secretsBackend === backend

            return (
              <button
                key={backend}
                onClick={() => setSecretsBackend(backend)}
                className={`w-full p-4 rounded-xl border text-left transition-all ${
                  selected
                    ? 'bg-white/10 border-white/30'
                    : 'bg-black/30 border-atlas-border hover:border-white/20'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                      selected ? 'border-white' : 'border-gray-600'
                    }`}
                  >
                    {selected && <div className="w-2 h-2 rounded-full bg-white" />}
                  </div>
                  <div>
                    <span className={`font-medium ${selected ? 'text-white' : 'text-gray-300'}`}>
                      {label.name}
                    </span>
                    <p className="text-xs text-gray-500 mt-0.5">{label.description}</p>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
