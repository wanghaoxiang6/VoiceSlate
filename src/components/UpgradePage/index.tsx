import { Check, Crown, KeyRound, Mic, Sparkles, Cpu } from 'lucide-react'

const RECIPES = [
  {
    title: 'One-key OpenAI setup',
    icon: KeyRound,
    tone: 'text-accent',
    summary: 'Use one OpenAI API key for both transcription and polish.',
    steps: [
      'STT provider: OpenAI Whisper',
      'LLM provider: OpenAI',
      'Paste the same OpenAI API key into both fields',
      'Recommended when you want the simplest setup',
    ],
  },
  {
    title: 'Low-cost cloud setup',
    icon: Sparkles,
    tone: 'text-emerald-600',
    summary: 'Use a cheap STT provider and pair it with DeepSeek for polish.',
    steps: [
      'STT provider: Groq Whisper or OpenAI Whisper',
      'LLM provider: DeepSeek',
      'Add the STT key and the DeepSeek key separately',
      'Recommended when you want lower recurring cost',
    ],
  },
  {
    title: 'Fully local setup',
    icon: Cpu,
    tone: 'text-amber-600',
    summary: 'Run your own local stack without relying on a hosted LLM.',
    steps: [
      'LLM provider: Ollama',
      'Base URL: http://localhost:11434/v1',
      'STT provider: connect any Whisper-compatible local endpoint you prefer',
      'Recommended when privacy matters most',
    ],
  },
] as const

export function UpgradePage() {
  return (
    <div className="max-w-[720px] mx-auto py-8 px-6 text-[13px] space-y-6">
      <div className="text-center mb-2">
        <div className="inline-flex items-center gap-2 mb-2">
          <Crown size={20} className="text-amber-500" />
          <h1 className="text-[20px] font-semibold text-text-primary">BYOK Guide</h1>
        </div>
        <p className="text-text-secondary">
          This edition keeps the familiar workflow but defaults to your own providers instead of
          any hosted Pro flow.
        </p>
      </div>

      <div className="rounded-[14px] border border-border bg-bg-secondary/50 px-4 py-4">
        <div className="flex items-start gap-3">
          <Mic size={18} className="text-text-secondary mt-0.5 shrink-0" />
          <div className="space-y-2">
            <h2 className="text-[14px] font-medium text-text-primary">Important note</h2>
            <p className="text-text-secondary leading-relaxed">
              DeepSeek is an LLM provider, not a speech-to-text provider. If you choose DeepSeek for
              polish, you still need an STT provider such as OpenAI Whisper, Groq Whisper,
              Deepgram, or a local Whisper-compatible endpoint.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {RECIPES.map(({ title, icon: Icon, tone, summary, steps }) => (
          <div key={title} className="rounded-[14px] border border-border overflow-hidden">
            <div className="px-4 py-4 bg-bg-secondary/50 border-b border-border">
              <div className="flex items-center gap-2">
                <Icon size={16} className={tone} />
                <h3 className="text-[14px] font-medium text-text-primary">{title}</h3>
              </div>
              <p className="text-[12px] text-text-secondary mt-2 leading-relaxed">{summary}</p>
            </div>
            <div className="px-4 py-3 space-y-2.5">
              {steps.map((step) => (
                <div key={step} className="flex items-start gap-2">
                  <Check size={13} className="text-green-500 mt-0.5 shrink-0" />
                  <span className="text-[12px] text-text-primary">{step}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-[14px] border border-border bg-bg-secondary/50 px-4 py-4 space-y-2">
        <h2 className="text-[14px] font-medium text-text-primary">Recommended first test</h2>
        <p className="text-text-secondary leading-relaxed">
          If you just want to get this running fast, start with OpenAI Whisper for STT and OpenAI
          for the LLM. Once the full pipeline works, you can switch only the LLM provider to
          DeepSeek in Settings and keep the rest of the interface unchanged.
        </p>
      </div>
    </div>
  )
}
