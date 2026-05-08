// App metadata
export const APP_NAME = 'VoiceSlate'
export const APP_VERSION = 'v0.1.0'
export const APP_REPO_URL = 'https://github.com/wanghaoxiang6/VoiceSlate'
export const APP_LICENSE_URL = 'https://github.com/wanghaoxiang6/VoiceSlate/blob/main/LICENSE'

// Cloud API base URL. The public fork disables hosted defaults unless the
// maintainer explicitly points these env vars at their own backend.
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'https://example.invalid'

export const FREE_PLAN = {
  sttMinutes: 15,
  llmTokens: 100_000,
} as const

export const PRO_PLAN = {
  price: '$4.99',
  period: 'month',
  features: [
    { label: 'Managed STT', detail: 'Optional hosted transcription quota' },
    { label: 'Managed AI Rewrite', detail: 'Optional hosted polish quota' },
    { label: 'Cloud Backup & Restore', detail: 'Optional sync and restore flow' },
    { label: 'Scene Packs', detail: 'Prompt and workflow presets' },
    { label: 'Zero-config', detail: 'No provider setup required' },
  ],
} as const

export const STT_PROVIDERS = [
  { value: 'volcengine-flash', label: 'Volcengine 极速识别' },
  { value: 'volcengine-standard', label: 'Volcengine 高精度识别' },
  { value: 'local-whisper', label: 'Local Whisper' },
  { value: 'deepgram', label: 'Deepgram Nova-3' },
  { value: 'assemblyai', label: 'AssemblyAI' },
  { value: 'glm-asr', label: 'GLM-ASR' },
  { value: 'openai-whisper', label: 'OpenAI Whisper' },
  { value: 'groq-whisper', label: 'Groq Whisper' },
  { value: 'siliconflow', label: 'SiliconFlow' },
] as const

export const LLM_PROVIDERS = [
  { value: 'zhipu', label: 'Zhipu' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'siliconflow', label: 'SiliconFlow' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'gemini', label: 'Google Gemini' },
  { value: 'moonshot', label: 'Moonshot (Kimi)' },
  { value: 'qwen', label: 'Qwen' },
  { value: 'groq', label: 'Groq' },
  { value: 'claude', label: 'Claude' },
  { value: 'ollama', label: 'Ollama (Local)' },
  { value: 'openrouter', label: 'OpenRouter' },
] as const

export const LLM_DEFAULT_CONFIG: Record<string, { baseUrl: string; model: string }> = {
  zhipu: { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-v4-flash' },
  siliconflow: { baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-7B-Instruct' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.0-flash',
  },
  moonshot: { baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  qwen: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-turbo' },
  groq: { baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  claude: { baseUrl: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-sonnet-4' },
  ollama: { baseUrl: 'http://localhost:11434/v1', model: 'llama3.2' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' },
  cloud: { baseUrl: `${API_BASE_URL}/api/proxy`, model: 'default' },
}

export const LANGUAGES = [
  { value: 'multi', label: '自动识别' },
  { value: 'zh', label: '简体中文' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'es', label: 'Spanish' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'ru', label: 'Russian' },
  { value: 'ar', label: 'Arabic' },
  { value: 'hi', label: 'Hindi' },
  { value: 'th', label: 'Thai' },
  { value: 'vi', label: 'Vietnamese' },
  { value: 'it', label: 'Italian' },
  { value: 'nl', label: 'Dutch' },
  { value: 'tr', label: 'Turkish' },
  { value: 'pl', label: 'Polish' },
  { value: 'uk', label: 'Ukrainian' },
  { value: 'id', label: 'Indonesian' },
  { value: 'ms', label: 'Malay' },
] as const

export const TARGET_LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'zh', label: '简体中文' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'es', label: 'Spanish' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'ru', label: 'Russian' },
  { value: 'ar', label: 'Arabic' },
  { value: 'hi', label: 'Hindi' },
  { value: 'th', label: 'Thai' },
  { value: 'vi', label: 'Vietnamese' },
  { value: 'it', label: 'Italian' },
  { value: 'nl', label: 'Dutch' },
  { value: 'tr', label: 'Turkish' },
  { value: 'pl', label: 'Polish' },
  { value: 'uk', label: 'Ukrainian' },
  { value: 'id', label: 'Indonesian' },
  { value: 'ms', label: 'Malay' },
] as const
