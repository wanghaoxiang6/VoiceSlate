import i18n from '../../i18n'
import { useAppStore } from '../../stores/appStore'

const UI_LANGUAGES = [
  { code: 'zh', label: 'Simplified Chinese', native: '简体中文' },
  { code: 'en', label: 'English', native: 'English' },
] as const

export function WelcomeStep() {
  const config = useAppStore((s) => s.config)
  const updateConfig = useAppStore((s) => s.updateConfig)

  const currentLang = config.ui_language || i18n.language || 'zh'

  const handleSelectLanguage = (code: string) => {
    i18n.changeLanguage(code)
    localStorage.setItem('ui_language', code)
    updateConfig({ ui_language: code })
  }

  return (
    <div className="space-y-6">
      <div className="py-4 text-center">
        <div className="mb-2 text-[40px]">Voice</div>
        <p className="text-[15px] leading-relaxed text-text-secondary">
          {currentLang === 'zh'
            ? '保留熟悉的语音输入流程，但从一开始就使用你自己的服务和 API Key。'
            : 'Keep the familiar voice-input flow, but run it with your own providers and API keys from the start.'}
        </p>
      </div>

      <div>
        <p className="mb-3 text-[13px] font-medium text-text-secondary">
          {currentLang === 'zh' ? '界面语言' : 'App language'}
        </p>
        <div className="grid grid-cols-1 gap-3">
          {UI_LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              onClick={() => handleSelectLanguage(lang.code)}
              className={`cursor-pointer rounded-[10px] border px-4 py-4 text-[14px] transition-all ${
                currentLang === lang.code
                  ? 'border-accent bg-accent/10 font-medium text-accent'
                  : 'border-border bg-bg-secondary text-text-primary hover:border-text-tertiary'
              }`}
            >
              <div className="font-medium">{lang.native}</div>
              <div className="mt-0.5 text-[12px] text-text-tertiary">{lang.label}</div>
            </button>
          ))}
        </div>
        <p className="mt-3 text-[12px] text-text-tertiary">
          {currentLang === 'zh'
            ? '后面你可以在设置里继续切换服务商，不需要改变整个界面结构。'
            : 'You can switch providers later in Settings without changing the overall interface.'}
        </p>
      </div>
    </div>
  )
}
