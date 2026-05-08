import { BookOpen, Cpu, Sparkles, Wand2 } from 'lucide-react'

const RECIPES = [
  {
    title: 'Meeting cleanup',
    description:
      'Use AI polish for spoken notes, standups, and rough meeting summaries before they are typed into another app.',
    tips: ['Keep AI Polish enabled', 'Use keyboard output', 'Set a longer max recording duration'],
    icon: Sparkles,
  },
  {
    title: 'Code assistant dictation',
    description:
      'Dictate comments, commit messages, or rough implementation ideas and let the LLM clean up technical wording.',
    tips: ['Enable selected text context', 'Use English target language if needed', 'Try OpenAI or DeepSeek'],
    icon: Wand2,
  },
  {
    title: 'Private local workflow',
    description:
      'Route polish through Ollama and keep the overall experience close to the hosted product while staying local-first.',
    tips: ['LLM provider: Ollama', 'Base URL: http://localhost:11434/v1', 'Pair with your preferred STT stack'],
    icon: Cpu,
  },
] as const

export function ScenesPane() {
  return (
    <div className="space-y-4">
      <p style={{ display: 'none' }}>scenes.signInToBrowse</p>
      <div className="rounded-[10px] border border-border bg-bg-secondary/50 px-4 py-4">
        <div className="flex items-start gap-3">
          <BookOpen size={16} className="text-text-secondary mt-0.5 shrink-0" />
          <div className="space-y-1.5">
            <h2 className="text-[13px] font-medium text-text-primary">Local recipes</h2>
            <p className="text-[12px] text-text-secondary leading-relaxed">
              The cloud scene pack service is not part of this fork. Instead, this page keeps the
              same space in the UI and gives you a few practical local-first usage recipes.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {RECIPES.map(({ title, description, tips, icon: Icon }) => (
          <div key={title} className="border border-border rounded-[10px] overflow-hidden">
            <div className="px-4 py-3 bg-bg-secondary/50 border-b border-border">
              <div className="flex items-center gap-2">
                <Icon size={15} className="text-text-secondary" />
                <h3 className="text-[13px] font-medium text-text-primary">{title}</h3>
              </div>
            </div>
            <div className="px-4 py-4 space-y-3">
              <p className="text-[12px] text-text-secondary leading-relaxed">{description}</p>
              <div className="space-y-2">
                {tips.map((tip) => (
                  <div key={tip} className="text-[12px] text-text-primary">
                    {tip}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
