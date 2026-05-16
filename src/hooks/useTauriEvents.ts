import { useEffect } from 'react'
import { listen } from '@tauri-apps/api/event'
import { useAppStore } from '../stores/appStore'
import type { PipelineState } from '../stores/appStore'
import { getHistory, getHistoryStats } from '../lib/tauri'

export function useTauriEvents() {
  const {
    setAudioVolume,
    setPartialTranscript,
    setFinalTranscript,
    appendPolishedChunk,
    setPipelineState,
    setTargetApp,
    setPipelineError,
    setAccessibilityTrusted,
    setHistory,
    setHistoryStats,
  } = useAppStore()

  useEffect(() => {
    let cancelled = false
    const unlisteners: Array<() => void> = []

    function addListener<T>(event: string, handler: (payload: T) => void) {
      listen<T>(event, (e) => handler(e.payload))
        .then((unlisten) => {
          if (cancelled) {
            unlisten()
          } else {
            unlisteners.push(unlisten)
          }
        })
        .catch((err) => {
          console.error(`Failed to register listener for "${event}":`, err)
        })
    }

    addListener<number>('audio:volume', setAudioVolume)
    addListener<string>('stt:partial', setPartialTranscript)
    addListener<string>('stt:final', setFinalTranscript)
    addListener<string>('llm:chunk', appendPolishedChunk)
    addListener<PipelineState>('pipeline:state', (state) => {
      setPipelineState(state)
      if (state === 'recording') {
        setPipelineError(null)
      }
      if (state === 'idle') {
        Promise.all([getHistory(200, 0), getHistoryStats()])
          .then(([history, stats]) => {
            setHistory(history)
            setHistoryStats(stats)
          })
          .catch((err) => {
            console.error('Failed to refresh history or stats:', err)
          })
      }
    })
    addListener<string>('pipeline:target_app', setTargetApp)
    addListener<string>('pipeline:error', (error) => {
      setPipelineError(error)
      if (error === 'ACCESSIBILITY_REQUIRED') {
        setAccessibilityTrusted(false)
      }
    })

    addListener<void>('tray:settings', () => {
      window.location.hash = '#/settings'
    })
    addListener<void>('tray:history', () => {
      window.location.hash = '#/history'
    })
    addListener<string>('navigate', (hash) => {
      window.location.hash = hash
    })
    addListener<void>('tray:about', () => {
      window.location.hash = '#/settings'
    })

    return () => {
      cancelled = true
      unlisteners.forEach((unlisten) => unlisten())
    }
  }, [
    setAudioVolume,
    setPartialTranscript,
    setFinalTranscript,
    appendPolishedChunk,
    setPipelineState,
    setTargetApp,
    setPipelineError,
    setAccessibilityTrusted,
    setHistory,
    setHistoryStats,
  ])
}
