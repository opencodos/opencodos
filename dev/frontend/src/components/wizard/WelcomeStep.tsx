import { useState, useRef } from 'react'
import { API_BASE_URL } from '@/lib/api'

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
  const [isRecording, setIsRecording] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })

      // Check supported mimeTypes
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : 'audio/mp4'

      const mediaRecorder = new MediaRecorder(stream, { mimeType })

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      }

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(chunksRef.current, { type: mimeType })
        console.log('Audio blob size:', audioBlob.size)
        await transcribeAudio(audioBlob)
        chunksRef.current = []
      }

      mediaRecorder.start(1000) // Capture in 1-second chunks
      mediaRecorderRef.current = mediaRecorder
      setIsRecording(true)
    } catch (error) {
      console.error('Microphone access denied:', error)
      alert('Please allow microphone access')
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop())
      setIsRecording(false)
      setIsProcessing(true)
    }
  }

  const transcribeAudio = async (audioBlob: Blob) => {
    try {
      const formData = new FormData()
      formData.append('file', audioBlob, 'recording.webm')

      const response = await fetch(`${API_BASE_URL}/api/transcribe`, {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()
      if (data.success && data.transcript) {
        const newGoals = goals ? `${goals} ${data.transcript}` : data.transcript
        setGoals(newGoals)
      } else if (data.detail) {
        console.error('Transcription error:', data.detail)
        alert(`Transcription failed: ${data.detail}`)
      }
    } catch (error) {
      console.error('Transcription error:', error)
      alert('Failed to transcribe audio')
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div className="space-y-8">
      <div className="text-center">
        <h1 className="text-4xl font-light mb-3 tracking-tight text-white">
          {displayName ? `Welcome to Codos, ${displayName}!` : 'Welcome to Codos!'}
        </h1>
        <p className="text-gray-400 text-lg">Let's set up your AI Operating System</p>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl text-white/90">What are your goals?</h2>
          <button
            type="button"
            onClick={isRecording ? stopRecording : startRecording}
            disabled={isProcessing}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${
              isRecording
                ? 'bg-red-500/20 text-red-400 border border-red-500/50'
                : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10 hover:text-white'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {isProcessing ? (
              <>
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span>Processing...</span>
              </>
            ) : isRecording ? (
              <>
                <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                <span>Stop</span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
                <span>Voice</span>
              </>
            )}
          </button>
        </div>

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
