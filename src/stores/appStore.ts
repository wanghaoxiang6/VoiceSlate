import { create } from 'zustand'

export type PipelineState = 'idle' | 'recording' | 'transcribing' | 'polishing' | 'outputting'

export type SttProvider =
  | 'cloud-opus'
  | 'volcengine-flash'
  | 'volcengine-standard'
  | 'local-whisper'
  | 'deepgram'
  | 'assemblyai'
  | 'glm-asr'
  | 'openai-whisper'
  | 'groq-whisper'
  | 'siliconflow'
  | 'cloud'
export type LlmProvider =
  | 'zhipu'
  | 'deepseek'
  | 'siliconflow'
  | 'openai'
  | 'gemini'
  | 'moonshot'
  | 'qwen'
  | 'groq'
  | 'claude'
  | 'ollama'
  | 'openrouter'
  | 'cloud'
export type OutputMode = 'keyboard' | 'clipboard'
export type HotkeyMode = 'hold' | 'toggle'
export type Theme = 'light' | 'dark' | 'system'

export interface HistoryEntry {
  id: number
  created_at: string
  app_name: string
  app_type: string
  raw_text: string
  polished_text: string
  corrected_text: string | null
  corrected_at: string | null
  language: string | null
  duration_ms: number | null
  stt_provider: string | null
  llm_provider: string | null
}

export interface HistoryStats {
  total_entries: number
  total_duration_ms: number
  total_characters: number
  estimated_saved_ms: number
  average_chars_per_minute: number
  month_entries: number
  month_duration_ms: number
  month_characters: number
  month_llm_input_tokens: number
  month_llm_output_tokens: number
  month_stt_cost_cny: number
  month_llm_cost_usd: number
  total_llm_input_tokens: number
  total_llm_output_tokens: number
  total_stt_cost_cny: number
  total_llm_cost_usd: number
}

export interface DictionaryEntry {
  id: number
  word: string
  pronunciation: string | null
}

export interface AppConfig {
  stt_provider: SttProvider
  stt_api_key: string
  stt_language: string
  stt_correction_enabled: boolean
  stt_corrections: Array<{ from: string; to: string; enabled: boolean }>
  llm_provider: LlmProvider
  llm_api_key: string
  llm_model: string
  llm_base_url: string
  polish_enabled: boolean
  translate_enabled: boolean
  target_lang: string
  hotkey: string
  hotkey_mode: HotkeyMode
  output_mode: OutputMode
  selected_text_enabled: boolean
  theme: Theme
  auto_start: boolean
  close_to_tray: boolean
  start_minimized: boolean
  max_recording_seconds: number
  ui_language: string
  capsule_auto_hide: boolean
  voice_profile_enabled: boolean
  voice_profile_inbox_dir: string
  voice_profile_min_duration_seconds: number
  voice_profile_min_quality_score: number
}

export type TestStatus = 'idle' | 'testing' | 'success' | 'error'

interface AppState {
  // Pipeline
  pipelineState: PipelineState
  setPipelineState: (state: PipelineState) => void

  // Recording
  audioVolume: number
  setAudioVolume: (v: number) => void
  partialTranscript: string
  setPartialTranscript: (t: string) => void
  finalTranscript: string
  setFinalTranscript: (t: string) => void
  polishedText: string
  setPolishedText: (t: string) => void
  appendPolishedChunk: (chunk: string) => void
  recordingDuration: number
  setRecordingDuration: (d: number) => void
  targetApp: string
  setTargetApp: (app: string) => void

  // Config
  config: AppConfig
  setConfig: (config: AppConfig) => void
  updateConfig: (partial: Partial<AppConfig>) => void

  // History
  history: HistoryEntry[]
  setHistory: (h: HistoryEntry[]) => void
  historyStats: HistoryStats
  setHistoryStats: (stats: HistoryStats) => void

  // Dictionary
  dictionary: DictionaryEntry[]
  setDictionary: (d: DictionaryEntry[]) => void

  // Onboarding
  onboardingCompleted: boolean
  setOnboardingCompleted: (done: boolean) => void
  onboardingStep: number
  setOnboardingStep: (step: number) => void
  onboardingMode: 'cloud' | 'byok' | null
  setOnboardingMode: (mode: 'cloud' | 'byok' | null) => void

  // Capsule
  capsuleExpanded: boolean
  setCapsuleExpanded: (expanded: boolean) => void

  // Connection test status
  sttTestStatus: TestStatus
  setSttTestStatus: (s: TestStatus) => void
  llmTestStatus: TestStatus
  setLlmTestStatus: (s: TestStatus) => void

  // Latency benchmark results (ms), null = not yet measured
  sttLatencyMs: number | null
  setSttLatencyMs: (ms: number | null) => void
  llmLatencyMs: number | null
  setLlmLatencyMs: (ms: number | null) => void

  // LLM model list cache (persists across tab switches)
  llmModels: string[]
  setLlmModels: (models: string[]) => void

  // Pipeline error
  pipelineError: string | null
  setPipelineError: (error: string | null) => void

  // macOS Accessibility permission
  accessibilityTrusted: boolean
  setAccessibilityTrusted: (trusted: boolean) => void

  // Context menu
  contextMenuOpen: boolean
  setContextMenuOpen: (open: boolean) => void
  contextMenuReady: boolean
  setContextMenuReady: (ready: boolean) => void

  // Reset recording state
  resetRecording: () => void

  // Config snapshot for dirty detection
  savedConfig: AppConfig | null
  setSavedConfig: (config: AppConfig) => void
  resetConfig: () => void
}

const isMac =
  typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0

const defaultConfig: AppConfig = {
  stt_provider: 'cloud-opus',
  stt_api_key: '',
  stt_language: 'multi',
  stt_correction_enabled: false,
  stt_corrections: [],
  llm_provider: 'deepseek',
  llm_api_key: '',
  llm_model: 'deepseek-v4-flash',
  llm_base_url: 'https://api.deepseek.com/v1',
  polish_enabled: true,
  translate_enabled: false,
  target_lang: 'en',
  hotkey: isMac ? 'Alt+/' : 'AltRight',
  hotkey_mode: isMac ? 'hold' : 'toggle',
  output_mode: 'keyboard',
  selected_text_enabled: false,
  theme: 'system',
  auto_start: false,
  close_to_tray: true,
  start_minimized: false,
  max_recording_seconds: 30,
  ui_language: 'zh',
  capsule_auto_hide: false,
  voice_profile_enabled: false,
  voice_profile_inbox_dir: '',
  voice_profile_min_duration_seconds: 3,
  voice_profile_min_quality_score: 0.65,
}

export const useAppStore = create<AppState>((set) => ({
  pipelineState: 'idle',
  setPipelineState: (pipelineState) => set({ pipelineState }),

  audioVolume: 0,
  setAudioVolume: (audioVolume) => set({ audioVolume }),
  partialTranscript: '',
  setPartialTranscript: (partialTranscript) => set({ partialTranscript }),
  finalTranscript: '',
  setFinalTranscript: (finalTranscript) => set({ finalTranscript }),
  polishedText: '',
  setPolishedText: (polishedText) => set({ polishedText }),
  appendPolishedChunk: (chunk) => set((s) => ({ polishedText: s.polishedText + chunk })),
  recordingDuration: 0,
  setRecordingDuration: (recordingDuration) => set({ recordingDuration }),
  targetApp: '',
  setTargetApp: (targetApp) => set({ targetApp }),

  config: defaultConfig,
  setConfig: (config) => set({ config }),
  updateConfig: (partial) => set((s) => ({ config: { ...s.config, ...partial } })),

  history: [],
  setHistory: (history) => set({ history }),
  historyStats: {
    total_entries: 0,
    total_duration_ms: 0,
    total_characters: 0,
    estimated_saved_ms: 0,
    average_chars_per_minute: 0,
    month_entries: 0,
    month_duration_ms: 0,
    month_characters: 0,
    month_llm_input_tokens: 0,
    month_llm_output_tokens: 0,
    month_stt_cost_cny: 0,
    month_llm_cost_usd: 0,
    total_llm_input_tokens: 0,
    total_llm_output_tokens: 0,
    total_stt_cost_cny: 0,
    total_llm_cost_usd: 0,
  },
  setHistoryStats: (historyStats) => set({ historyStats }),

  dictionary: [],
  setDictionary: (dictionary) => set({ dictionary }),

  onboardingCompleted: false,
  setOnboardingCompleted: (onboardingCompleted) => set({ onboardingCompleted }),
  onboardingStep: 0,
  setOnboardingStep: (onboardingStep) => set({ onboardingStep }),
  onboardingMode: null,
  setOnboardingMode: (onboardingMode) => set({ onboardingMode }),

  capsuleExpanded: false,
  setCapsuleExpanded: (capsuleExpanded) => set({ capsuleExpanded }),

  sttTestStatus: 'idle',
  setSttTestStatus: (sttTestStatus) => set({ sttTestStatus }),
  llmTestStatus: 'idle',
  setLlmTestStatus: (llmTestStatus) => set({ llmTestStatus }),

  sttLatencyMs: null,
  setSttLatencyMs: (sttLatencyMs) => set({ sttLatencyMs }),
  llmLatencyMs: null,
  setLlmLatencyMs: (llmLatencyMs) => set({ llmLatencyMs }),

  llmModels: [],
  setLlmModels: (llmModels) => set({ llmModels }),

  pipelineError: null,
  setPipelineError: (pipelineError) => set({ pipelineError }),

  accessibilityTrusted: true,
  setAccessibilityTrusted: (accessibilityTrusted) => set({ accessibilityTrusted }),

  contextMenuOpen: false,
  setContextMenuOpen: (contextMenuOpen) => set({ contextMenuOpen }),
  contextMenuReady: false,
  setContextMenuReady: (contextMenuReady) => set({ contextMenuReady }),

  resetRecording: () =>
    set({
      audioVolume: 0,
      partialTranscript: '',
      finalTranscript: '',
      polishedText: '',
      recordingDuration: 0,
    }),

  savedConfig: null,
  setSavedConfig: (savedConfig) => set({ savedConfig }),
  resetConfig: () => set((s) => (s.savedConfig ? { config: { ...s.savedConfig } } : {})),
}))
