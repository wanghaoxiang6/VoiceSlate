import { Mic, Settings, History, Crown, CheckCircle2, TimerReset, Text, Gauge, Clock3 } from 'lucide-react'
import { motion } from 'framer-motion'
import { spring } from '../../lib/animations'
import { useAppStore } from '../../stores/appStore'
import { useRoute } from '../../lib/router'
import { formatHotkeyLabel } from '../../lib/hotkey'
import { formatCurrency, formatDuration, formatInteger, formatPace } from '../../lib/history'

export function HomePage() {
  const config = useAppStore((s) => s.config)
  const history = useAppStore((s) => s.history)
  const historyStats = useAppStore((s) => s.historyStats)
  const { navigate } = useRoute()
  const displayHotkey = formatHotkeyLabel(config.hotkey)
  const isZh = config.ui_language === 'zh'

  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`
  const todayCount = history.filter((h) => h.created_at.startsWith(today)).length

  const sttReady = config.stt_provider === 'local-whisper' || config.stt_api_key.trim().length > 0
  const llmReady = config.llm_api_key.trim().length > 0

  const usageHint =
    config.hotkey_mode === 'toggle'
      ? isZh
        ? `按一次 ${displayHotkey} 开始录音，再按一次结束并直接输出文字。`
        : `Press ${displayHotkey} once to start recording, then press it again to stop and transcribe.`
      : isZh
        ? `按住 ${displayHotkey} 说话，松开后自动转成文字。`
        : `Hold ${displayHotkey} to start voice recording and release it to transcribe.`

  const statsCards = [
    {
      icon: TimerReset,
      label: isZh ? '总口述时间' : 'Total dictation time',
      value: formatDuration(historyStats.total_duration_ms, isZh),
    },
    {
      icon: Text,
      label: isZh ? '累计字数' : 'Total characters',
      value: formatInteger(historyStats.total_characters),
    },
    {
      icon: Clock3,
      label: isZh ? '节约时间' : 'Estimated time saved',
      value: formatDuration(historyStats.estimated_saved_ms, isZh),
    },
    {
      icon: Gauge,
      label: isZh ? '平均口述速度' : 'Average pace',
      value: formatPace(historyStats.average_chars_per_minute, isZh),
    },
  ]

  return (
    <div className="p-6 space-y-6">
      <div className="rounded-[18px] p-5 jelly-card">
        <div className="flex items-center gap-3 mb-2">
          <div
            className="w-9 h-9 rounded-[10px] flex items-center justify-center"
            style={{
              background: 'linear-gradient(145deg, rgba(42,187,167,0.15), rgba(42,187,167,0.08))',
            }}
          >
            <Mic size={18} className="text-text-secondary" />
          </div>
          <h2 className="text-[17px] font-semibold">{isZh ? '欢迎使用 VoiceSlate' : 'Welcome to VoiceSlate'}</h2>
        </div>
        <p className="text-[13px] text-text-secondary leading-relaxed">{usageHint}</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <MetricCard label={isZh ? '总录音次数' : 'Total recordings'} value={formatInteger(historyStats.total_entries || history.length)} />
        <MetricCard label={isZh ? '今日录音' : 'Today'} value={formatInteger(todayCount)} />
      </div>

      <div className="rounded-[18px] p-5 jelly-card space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-[13px] font-medium">{isZh ? '使用统计' : 'Usage overview'}</h3>
            <p className="text-[12px] text-text-secondary mt-1">
              {isZh ? '节约时间为估算值，基于本地累计口述内容计算。' : 'Time saved is an estimate based on your local dictation history.'}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {statsCards.map((card) => (
            <div key={card.label} className="rounded-[16px] border border-border bg-bg-secondary/60 p-4">
              <div className="flex items-center gap-2 mb-2 text-text-secondary">
                <card.icon size={14} />
                <p className="text-[11px] uppercase tracking-wider">{card.label}</p>
              </div>
              <p className="text-[20px] font-semibold text-text-primary">{card.value}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-[18px] p-5 jelly-card space-y-4">
        <div>
          <h3 className="text-[13px] font-medium">{isZh ? '本月 API 估算' : 'This month API estimate'}</h3>
          <p className="text-[12px] text-text-secondary mt-1">
            {isZh
              ? '这是本地估算值，不等同于厂商最终账单。'
              : 'These are local estimates and may differ from provider billing statements.'}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <ApiCard
            label={isZh ? '本月 STT 时长' : 'STT time this month'}
            value={formatDuration(historyStats.month_duration_ms, isZh)}
            subValue={`${formatCurrency(historyStats.month_stt_cost_cny, 'CNY')} ${isZh ? '估算' : 'estimated'}`}
          />
          <ApiCard
            label={isZh ? '本月 STT 次数' : 'STT sessions this month'}
            value={formatInteger(historyStats.month_entries)}
            subValue={config.stt_provider}
          />
          <ApiCard
            label={isZh ? '本月 LLM 输入 tokens' : 'LLM input tokens'}
            value={formatInteger(historyStats.month_llm_input_tokens)}
            subValue={config.llm_provider}
          />
          <ApiCard
            label={isZh ? '本月 LLM 输出 tokens' : 'LLM output tokens'}
            value={formatInteger(historyStats.month_llm_output_tokens)}
            subValue={`${formatCurrency(historyStats.month_llm_cost_usd, 'USD')} ${isZh ? '估算' : 'estimated'}`}
          />
        </div>
      </div>

      <div className="rounded-[18px] p-5 jelly-card">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Crown size={16} className="text-amber-500" />
            <h3 className="text-[13px] font-medium">{isZh ? '本地优先配置' : 'Local-first setup'}</h3>
          </div>
          <button
            onClick={() => navigate('upgrade')}
            className="text-[12px] text-accent font-medium bg-transparent border-none cursor-pointer hover:underline"
          >
            {isZh ? '查看说明' : 'Open guide'}
          </button>
        </div>
        <div className="space-y-3 mt-3">
          <StatusRow
            label={isZh ? '语音识别服务' : 'Speech-to-text provider'}
            value={config.stt_provider}
            ready={sttReady}
            hint={sttReady ? (isZh ? '已就绪' : 'Ready') : isZh ? '请完成 STT 配置' : 'Configure STT'}
          />
          <StatusRow
            label={isZh ? '润色模型服务' : 'LLM provider'}
            value={config.llm_provider}
            ready={llmReady}
            hint={llmReady ? (isZh ? '已就绪' : 'Ready') : isZh ? '请完成 LLM 配置' : 'Configure LLM'}
          />
        </div>
      </div>

      <div className="rounded-[18px] p-5 jelly-card">
        <h3 className="text-[13px] font-medium mb-3">{isZh ? '当前配置' : 'Current Configuration'}</h3>
        <div className="space-y-2 text-[13px]">
          <div className="flex justify-between">
            <span className="text-text-secondary">{isZh ? '语音识别服务' : 'STT Provider'}</span>
            <span className="text-text-primary font-medium">{config.stt_provider}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-secondary">{isZh ? 'LLM 服务' : 'LLM Provider'}</span>
            <span className="text-text-primary font-medium">{config.llm_provider}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-secondary">{isZh ? 'AI 润色' : 'AI Polish'}</span>
            <span className="text-text-primary font-medium">
              {config.polish_enabled ? (isZh ? '已启用' : 'Enabled') : isZh ? '已禁用' : 'Disabled'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-secondary">{isZh ? '输出模式' : 'Output Mode'}</span>
            <span className="text-text-primary font-medium">{config.output_mode}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <ActionButton icon={Settings} label={isZh ? '设置' : 'Settings'} onClick={() => navigate('settings')} />
        <ActionButton icon={History} label={isZh ? '历史记录' : 'History'} onClick={() => navigate('history')} />
      </div>
    </div>
  )
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[18px] p-4 jelly-card">
      <p className="text-[11px] text-text-tertiary uppercase tracking-wider mb-1">{label}</p>
      <p className="text-[22px] font-semibold">{value}</p>
    </div>
  )
}

function ApiCard({
  label,
  value,
  subValue,
}: {
  label: string
  value: string
  subValue: string
}) {
  return (
    <div className="rounded-[16px] border border-border bg-bg-secondary/60 p-4">
      <p className="text-[11px] text-text-tertiary uppercase tracking-wider mb-2">{label}</p>
      <p className="text-[20px] font-semibold text-text-primary">{value}</p>
      <p className="text-[11px] text-text-secondary mt-1">{subValue}</p>
    </div>
  )
}

function StatusRow({
  label,
  value,
  ready,
  hint,
}: {
  label: string
  value: string
  ready: boolean
  hint: string
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-[12px] text-text-secondary">{label}</p>
        <p className="text-[13px] font-medium text-text-primary mt-0.5">{value}</p>
      </div>
      <div
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] ${
          ready ? 'bg-green-500/10 text-green-600' : 'bg-bg-secondary text-text-tertiary'
        }`}
      >
        <CheckCircle2 size={12} />
        {hint}
      </div>
    </div>
  )
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Settings
  label: string
  onClick: () => void
}) {
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ scale: 1.04 }}
      whileTap={{ scaleX: 1.06, scaleY: 0.94 }}
      transition={spring.jellyGentle}
      className="flex items-center gap-2.5 rounded-[14px] p-4 cursor-pointer text-left jelly-btn"
    >
      <Icon size={16} className="text-text-secondary" />
      <span className="text-[13px] font-medium">{label}</span>
    </motion.button>
  )
}
