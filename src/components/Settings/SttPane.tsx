import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../../stores/appStore'
import { useAuthStore } from '../../stores/authStore'
import { STT_PROVIDERS, LANGUAGES } from '../../lib/constants'
import {
  benchSttConnection,
  getSttCorrectionSuggestions,
  markSttCorrectionSuggestion,
  updateConfig as saveAppConfig,
  type SttCorrectionSuggestion,
} from '../../lib/tauri'
import { FormField } from './shared/FormField'
import { CheckCircle2, XCircle, Loader2, Crown, Plus, Ban } from 'lucide-react'
import { toast } from '../Toast'

export function SttPane() {
  const config = useAppStore((s) => s.config)
  const updateConfig = useAppStore((s) => s.updateConfig)
  const setSavedConfig = useAppStore((s) => s.setSavedConfig)
  const sttTestStatus = useAppStore((s) => s.sttTestStatus)
  const setSttTestStatus = useAppStore((s) => s.setSttTestStatus)
  const sttLatencyMs = useAppStore((s) => s.sttLatencyMs)
  const setSttLatencyMs = useAppStore((s) => s.setSttLatencyMs)
  const { user, plan } = useAuthStore()
  const { t } = useTranslation()
  const [suggestions, setSuggestions] = useState<SttCorrectionSuggestion[]>([])
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)

  const isCloud = config.stt_provider === 'cloud'
  const isLocal = config.stt_provider === 'local-whisper'

  const loadSuggestions = async () => {
    setSuggestionsLoading(true)
    try {
      setSuggestions((await getSttCorrectionSuggestions(1, 12)) ?? [])
    } catch (err) {
      console.error('Failed to load STT correction suggestions:', err)
    } finally {
      setSuggestionsLoading(false)
    }
  }

  useEffect(() => {
    void loadSuggestions()
  }, [])

  const handleTest = async () => {
    setSttTestStatus('testing')
    setSttLatencyMs(null)
    try {
      const ms = await benchSttConnection(config.stt_api_key, config.stt_provider)
      console.log('[STT Test] Received latency:', ms, 'type:', typeof ms)
      setSttLatencyMs(ms)
      setSttTestStatus('success')
    } catch (err) {
      console.error('[STT Test] Error:', err)
      setSttTestStatus('error')
    }
  }

  const acceptSuggestion = async (suggestion: SttCorrectionSuggestion) => {
    const exists = config.stt_corrections.some(
      (item) => item.from === suggestion.wrong_text && item.to === suggestion.correct_text,
    )
    const nextConfig = {
      ...config,
      stt_correction_enabled: true,
      stt_corrections: exists
        ? config.stt_corrections
        : [
            ...config.stt_corrections,
            { from: suggestion.wrong_text, to: suggestion.correct_text, enabled: true },
          ],
    }
    try {
      updateConfig(nextConfig)
      await saveAppConfig(nextConfig)
      setSavedConfig(nextConfig)
      await markSttCorrectionSuggestion(suggestion.id, 'accepted')
      await loadSuggestions()
      toast.success('Correction rule added')
    } catch (err) {
      console.error('Failed to accept STT correction suggestion:', err)
      toast.error('Failed to add correction')
    }
  }

  const ignoreSuggestion = async (suggestion: SttCorrectionSuggestion) => {
    try {
      await markSttCorrectionSuggestion(suggestion.id, 'ignored')
      await loadSuggestions()
    } catch (err) {
      console.error('Failed to ignore STT correction suggestion:', err)
      toast.error('Failed to ignore suggestion')
    }
  }

  return (
    <div className="space-y-5">
      <FormField label={t('settings.provider')}>
        <select
          value={config.stt_provider}
          onChange={(e) => {
            updateConfig({ stt_provider: e.target.value as typeof config.stt_provider })
            setSttTestStatus('idle')
            setSttLatencyMs(null)
          }}
          className="w-full px-3 py-2.5 bg-bg-secondary border border-border rounded-[10px] text-[13px] text-text-primary outline-none focus:border-border-focus transition-colors"
        >
          {STT_PROVIDERS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </FormField>

      {isCloud ? (
        <div className="border border-border rounded-[10px] px-3 py-3 space-y-2">
          <div className="flex items-center gap-2 text-[13px]">
            <Crown size={14} className="text-accent" />
            <span className="text-text-primary font-medium">{t('settings.cloudSttPro')}</span>
          </div>
          {!user ? (
            <p className="text-[12px] text-text-secondary">{t('settings.sttSignInHint')}</p>
          ) : plan !== 'pro' ? (
            <p className="text-[12px] text-text-secondary">{t('settings.sttUpgradeHint')}</p>
          ) : (
            <p className="text-[12px] text-green-500">{t('settings.sttProActive')}</p>
          )}
        </div>
      ) : isLocal ? (
        <div className="border border-border rounded-[10px] px-3 py-3 space-y-2">
          <div className="text-[13px] font-medium text-text-primary">Local Whisper</div>
          <p className="text-[12px] text-text-secondary">
            本地语音识别服务已经内置，不需要再填写 STT API Key。中文输出会统一为简体中文。
          </p>
          <button
            onClick={handleTest}
            disabled={sttTestStatus === 'testing'}
            className="px-4 py-2.5 bg-accent text-white rounded-[10px] text-[13px] border-none cursor-pointer hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-1.5"
          >
            {sttTestStatus === 'testing' && <Loader2 size={14} className="animate-spin" />}
            {t('settings.test')}
          </button>
          {sttTestStatus === 'success' && (
            <p className="flex items-center gap-1 text-[12px] text-success">
              <CheckCircle2 size={13} />{' '}
              {sttLatencyMs !== null ? `${sttLatencyMs}ms` : t('settings.connectionSuccess')}
            </p>
          )}
          {sttTestStatus === 'error' && (
            <p className="flex items-center gap-1 text-[12px] text-error">
              <XCircle size={13} /> {t('settings.connectionFailed')}
            </p>
          )}
        </div>
      ) : (
        <FormField label={t('settings.apiKey')}>
          <div className="flex gap-2">
            <input
              type="password"
              value={config.stt_api_key}
              onChange={(e) => {
                updateConfig({ stt_api_key: e.target.value })
                setSttTestStatus('idle')
                setSttLatencyMs(null)
              }}
              placeholder={t('settings.enterApiKey')}
              className="flex-1 px-3 py-2.5 bg-bg-secondary border border-border rounded-[10px] text-[13px] text-text-primary outline-none focus:border-border-focus transition-colors"
            />
            <button
              onClick={handleTest}
              disabled={!config.stt_api_key || sttTestStatus === 'testing'}
              className="px-4 py-2.5 bg-accent text-white rounded-[10px] text-[13px] border-none cursor-pointer hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
            >
              {sttTestStatus === 'testing' && <Loader2 size={14} className="animate-spin" />}
              {t('settings.test')}
            </button>
          </div>
          {sttTestStatus === 'success' && (
            <p className="flex items-center gap-1 text-[12px] text-success mt-2">
              <CheckCircle2 size={13} />{' '}
              {sttLatencyMs !== null ? `${sttLatencyMs}ms` : t('settings.connectionSuccess')}
            </p>
          )}
          {sttTestStatus === 'error' && (
            <p className="flex items-center gap-1 text-[12px] text-error mt-2">
              <XCircle size={13} /> {t('settings.connectionFailed')}
            </p>
          )}
          <p className="text-[11px] text-text-tertiary mt-1.5">{t('settings.storedLocally')}</p>
        </FormField>
      )}

      <FormField label={t('settings.sttLanguage')}>
        <select
          value={config.stt_language}
          onChange={(e) => updateConfig({ stt_language: e.target.value })}
          className="w-full px-3 py-2.5 bg-bg-secondary border border-border rounded-[10px] text-[13px] text-text-primary outline-none focus:border-border-focus transition-colors"
        >
          {LANGUAGES.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>
      </FormField>

      <div className="border border-border rounded-[10px] px-3 py-3 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[13px] font-medium text-text-primary">Correction suggestions</div>
            <p className="text-[11px] text-text-tertiary">
              Saved history edits appear here. They are not applied until you approve them.
            </p>
          </div>
          <button
            onClick={loadSuggestions}
            disabled={suggestionsLoading}
            className="px-2.5 py-1.5 rounded-[8px] text-[11px] text-text-secondary bg-bg-primary border border-border cursor-pointer disabled:opacity-50"
          >
            {suggestionsLoading ? 'Loading' : 'Refresh'}
          </button>
        </div>

        {suggestions.length === 0 ? (
          <p className="text-[12px] text-text-secondary">
            No pending suggestions. Correct a history item first; repeated edits will be collected here.
          </p>
        ) : (
          <div className="space-y-2">
            {suggestions.map((suggestion) => (
              <div
                key={suggestion.id}
                className="rounded-[10px] bg-bg-secondary border border-border px-3 py-2.5 space-y-2"
              >
                <div className="grid gap-1 text-[12px]">
                  <p className="text-text-tertiary">
                    From <span className="text-text-secondary">({suggestion.source_count}x)</span>
                  </p>
                  <p className="text-text-primary whitespace-pre-wrap break-words">
                    {suggestion.wrong_text}
                  </p>
                  <p className="text-text-tertiary">To</p>
                  <p className="text-text-primary whitespace-pre-wrap break-words">
                    {suggestion.correct_text}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => acceptSuggestion(suggestion)}
                    className="inline-flex items-center gap-1.5 rounded-[8px] px-2.5 py-1.5 text-[11px] text-white bg-accent border-none cursor-pointer"
                  >
                    <Plus size={12} />
                    Add correction
                  </button>
                  <button
                    onClick={() => ignoreSuggestion(suggestion)}
                    className="inline-flex items-center gap-1.5 rounded-[8px] px-2.5 py-1.5 text-[11px] text-text-secondary bg-bg-primary border border-border cursor-pointer"
                  >
                    <Ban size={12} />
                    Ignore
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
