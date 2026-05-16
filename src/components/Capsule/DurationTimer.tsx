import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useAppStore } from '../../stores/appStore'

export function DurationTimer() {
  const pipelineState = useAppStore((s) => s.pipelineState)
  const maxSeconds = useAppStore((s) => s.config.max_recording_seconds)
  const [seconds, setSeconds] = useState(0)
  const stoppedRef = useRef(false)

  useEffect(() => {
    if (pipelineState !== 'recording') {
      setSeconds(0)
      stoppedRef.current = false
      return
    }
    const interval = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(interval)
  }, [pipelineState])

  useEffect(() => {
    if (pipelineState === 'recording' && seconds >= maxSeconds && !stoppedRef.current) {
      stoppedRef.current = true
      invoke('stop_recording').catch((e: unknown) => {
        console.error('Failed to auto-stop recording at max duration:', e)
      })
    }
  }, [seconds, pipelineState, maxSeconds])

  const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
  const ss = String(seconds % 60).padStart(2, '0')

  return (
    <span className="text-[11px] font-mono text-white/80 tabular-nums">
      {mm}:{ss}
    </span>
  )
}
