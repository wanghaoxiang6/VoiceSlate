import { useTranslation } from 'react-i18next'
import i18n from '../../i18n'
import { ExternalLink } from 'lucide-react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { useAppStore } from '../../stores/appStore'
import { APP_NAME, APP_VERSION, APP_REPO_URL } from '../../lib/constants'

const UI_LANGUAGES = [
  { code: 'en', label: 'English', native: 'English' },
  { code: 'zh', label: 'Simplified Chinese', native: '简体中文' },
] as const

export function AboutPane() {
  const { t } = useTranslation()
  const config = useAppStore((s) => s.config)
  const updateConfig = useAppStore((s) => s.updateConfig)

  const currentLang = config.ui_language || i18n.language || 'zh'

  const handleSelectLanguage = (code: string) => {
    i18n.changeLanguage(code)
    localStorage.setItem('ui_language', code)
    updateConfig({ ui_language: code })
  }

  return (
    <div className="space-y-5 text-[13px]">
      <div className="py-6 text-center">
        <h2 className="text-[22px] font-semibold text-text-primary">{APP_NAME}</h2>
        <p className="mt-1 text-[13px] text-text-secondary">{APP_VERSION}</p>
      </div>

      <p className="leading-relaxed text-text-secondary">{t('settings.aboutDescription')}</p>

      <SectionCard title={t('settings.language')}>
        <div className="grid grid-cols-2 gap-3 p-3">
          {UI_LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              onClick={() => handleSelectLanguage(lang.code)}
              className={`cursor-pointer rounded-[8px] border px-4 py-3 text-[13px] transition-all ${
                currentLang === lang.code
                  ? 'border-accent bg-accent/10 font-medium text-accent'
                  : 'border-border bg-bg-secondary text-text-primary hover:border-text-tertiary'
              }`}
            >
              <div className="font-medium">{lang.native}</div>
              <div className="mt-0.5 text-[11px] text-text-tertiary">{lang.label}</div>
            </button>
          ))}
        </div>
      </SectionCard>

      <SectionCard title={t('settings.openSource')}>
        <InfoRow label={t('settings.license')} value={t('settings.mit')} />
        {APP_REPO_URL ? (
          <LinkRow label={t('settings.github')} url={APP_REPO_URL} linkText={t('settings.view')} />
        ) : (
          <InfoRow
            label={t('settings.github')}
            value={currentLang === 'zh' ? '发布仓库后补充' : 'Add after publishing'}
          />
        )}
        <InfoRow label={t('settings.framework')} value={t('settings.tauriReact')} />
      </SectionCard>
    </div>
  )
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[10px] border border-border">
      <div className="border-b border-border bg-bg-secondary/50 px-3 py-2.5">
        <h3 className="text-[13px] font-medium text-text-primary">{title}</h3>
      </div>
      {children}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-border px-3 py-2.5 last:border-b-0">
      <span className="text-text-secondary">{label}</span>
      <span className="text-text-primary">{value}</span>
    </div>
  )
}

function LinkRow({ label, url, linkText }: { label: string; url: string; linkText: string }) {
  return (
    <button
      onClick={() => openUrl(url)}
      className="flex w-full cursor-pointer items-center justify-between border-x-0 border-b border-t-0 border-border bg-transparent px-3 py-2.5 text-[13px] last:border-b-0"
    >
      <span className="text-text-secondary">{label}</span>
      <span className="flex items-center gap-1 text-accent">
        {linkText} <ExternalLink size={12} />
      </span>
    </button>
  )
}
