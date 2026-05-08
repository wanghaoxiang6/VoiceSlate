import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore } from '../appStore'
import type { HistoryEntry, DictionaryEntry } from '../appStore'

function getState() {
  return useAppStore.getState()
}

describe('appStore', () => {
  beforeEach(() => {
    // Reset store to initial state
    useAppStore.setState(useAppStore.getInitialState())
  })

  describe('pipeline state', () => {
    it('defaults to idle', () => {
      expect(getState().pipelineState).toBe('idle')
    })

    it('updates pipeline state', () => {
      getState().setPipelineState('recording')
      expect(getState().pipelineState).toBe('recording')
    })
  })

  describe('config', () => {
    it('has sensible defaults', () => {
      const { config } = getState()
      expect(config.theme).toBe('system')
      expect(config.hotkey).toBe('AltRight')
      expect(config.hotkey_mode).toBe('toggle')
      expect(config.output_mode).toBe('keyboard')
      expect(config.polish_enabled).toBe(true)
    })

    it('setConfig replaces entire config', () => {
      const newConfig = { ...getState().config, theme: 'dark' as const }
      getState().setConfig(newConfig)
      expect(getState().config.theme).toBe('dark')
    })

    it('updateConfig merges partial config immutably', () => {
      const original = getState().config
      getState().updateConfig({ theme: 'dark' })
      const updated = getState().config

      expect(updated.theme).toBe('dark')
      expect(updated.hotkey).toBe('AltRight') // unchanged
      expect(updated).not.toBe(original) // new object
    })
  })

  describe('history', () => {
    it('defaults to empty array', () => {
      expect(getState().history).toEqual([])
    })

    it('setHistory replaces history', () => {
      const entries: HistoryEntry[] = [
        {
          id: 1,
          created_at: '2025-01-01',
          app_name: 'Test',
          app_type: 'browser',
          raw_text: 'hello',
          polished_text: 'Hello.',
          corrected_text: null,
          corrected_at: null,
          language: 'en',
          duration_ms: 1200,
          stt_provider: 'volcengine-flash',
          llm_provider: 'deepseek',
        },
      ]
      getState().setHistory(entries)
      expect(getState().history).toHaveLength(1)
      expect(getState().history[0].raw_text).toBe('hello')
    })

    it('stores history stats', () => {
      getState().setHistoryStats({
        total_entries: 3,
        total_duration_ms: 10000,
        total_characters: 250,
        estimated_saved_ms: 5000,
        average_chars_per_minute: 150,
        month_entries: 2,
        month_duration_ms: 9000,
        month_characters: 200,
        month_llm_input_tokens: 500,
        month_llm_output_tokens: 250,
        month_stt_cost_cny: 1.2,
        month_llm_cost_usd: 0.03,
        total_llm_input_tokens: 800,
        total_llm_output_tokens: 400,
        total_stt_cost_cny: 2.4,
        total_llm_cost_usd: 0.06,
      })

      expect(getState().historyStats.total_entries).toBe(3)
      expect(getState().historyStats.total_characters).toBe(250)
    })
  })

  describe('dictionary', () => {
    it('defaults to empty array', () => {
      expect(getState().dictionary).toEqual([])
    })

    it('setDictionary replaces dictionary', () => {
      const entries: DictionaryEntry[] = [{ id: 1, word: 'API', pronunciation: null }]
      getState().setDictionary(entries)
      expect(getState().dictionary).toHaveLength(1)
      expect(getState().dictionary[0].word).toBe('API')
    })
  })

  describe('recording state', () => {
    it('resetRecording clears all recording fields', () => {
      getState().setAudioVolume(0.8)
      getState().setPartialTranscript('partial')
      getState().setFinalTranscript('final')
      getState().setPolishedText('polished')
      getState().setRecordingDuration(5000)

      getState().resetRecording()

      expect(getState().audioVolume).toBe(0)
      expect(getState().partialTranscript).toBe('')
      expect(getState().finalTranscript).toBe('')
      expect(getState().polishedText).toBe('')
      expect(getState().recordingDuration).toBe(0)
    })

    it('appendPolishedChunk appends to existing text', () => {
      getState().setPolishedText('Hello')
      getState().appendPolishedChunk(' world')
      expect(getState().polishedText).toBe('Hello world')
    })
  })

  describe('savedConfig / resetConfig', () => {
    it('resetConfig restores to savedConfig', () => {
      const saved = { ...getState().config }
      getState().setSavedConfig(saved)

      getState().updateConfig({ theme: 'dark', polish_enabled: false })
      expect(getState().config.theme).toBe('dark')

      getState().resetConfig()
      expect(getState().config.theme).toBe('system')
      expect(getState().config.polish_enabled).toBe(true)
    })

    it('resetConfig is a no-op when savedConfig is null', () => {
      getState().updateConfig({ theme: 'dark' })
      getState().resetConfig()
      // Should remain dark since savedConfig is null
      expect(getState().config.theme).toBe('dark')
    })
  })

  describe('onboarding', () => {
    it('defaults to not completed', () => {
      expect(getState().onboardingCompleted).toBe(false)
      expect(getState().onboardingStep).toBe(0)
    })

    it('tracks onboarding progress', () => {
      getState().setOnboardingStep(2)
      getState().setOnboardingCompleted(true)
      expect(getState().onboardingStep).toBe(2)
      expect(getState().onboardingCompleted).toBe(true)
    })
  })
})
