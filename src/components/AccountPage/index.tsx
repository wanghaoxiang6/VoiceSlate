import { CircleUser, Database, KeyRound, ShieldCheck, ShieldAlert, TimerReset, Text, Gauge, Clock3 } from 'lucide-react'
import { useAppStore } from '../../stores/appStore'
import { formatCurrency, formatDuration, formatInteger, formatPace } from '../../lib/history'

export function AccountPage() {
  const config = useAppStore((s) => s.config)
  const history = useAppStore((s) => s.history)
  const historyStats = useAppStore((s) => s.historyStats)
  const dictionary = useAppStore((s) => s.dictionary)
  const isZh = config.ui_language === 'zh'

  const sttReady = config.stt_api_key.trim().length > 0
  const llmReady = config.llm_api_key.trim().length > 0

  return (
    <div className="max-w-[520px] mx-auto py-8 px-6 space-y-5 text-[13px]">
      <div className="text-center mb-2">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-accent/10 mb-3">
          <CircleUser size={28} className="text-accent" />
        </div>
        <h1 className="text-[18px] font-semibold text-text-primary">
          {isZh ? '本地版' : 'Local Edition'}
        </h1>
        <p className="text-text-secondary mt-1">
          {isZh
            ? '这套版本以本地优先和自备 Key 为主，不需要登录也能跑通核心语音输入流程。'
            : 'This build is configured for local-first BYOK use. No account is required for the main pipeline.'}
        </p>
      </div>

      <div className="border border-border rounded-[10px] overflow-hidden">
        <InfoRow label={isZh ? 'STT 服务' : 'STT provider'} value={config.stt_provider} />
        <InfoRow label={isZh ? 'LLM 服务' : 'LLM provider'} value={config.llm_provider} />
        <InfoRow label={isZh ? '历史条目' : 'History entries'} value={formatInteger(historyStats.total_entries || history.length)} />
        <InfoRow label={isZh ? '词典条目' : 'Dictionary entries'} value={String(dictionary.length)} />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <StatusCard
          icon={KeyRound}
          title={isZh ? '语音识别 Key' : 'Speech-to-text key'}
          status={sttReady ? (isZh ? '已就绪' : 'Ready') : isZh ? '缺失' : 'Missing'}
          tone={sttReady ? 'good' : 'warn'}
          description={
            sttReady
              ? isZh
                ? '当前语音识别服务的 API Key 已保存在本机。'
                : 'An STT API key is saved locally for your current provider.'
              : isZh
                ? '测试语音输入前，请先在设置里补上 STT Key。'
                : 'Add an STT API key in Settings before testing voice input.'
          }
        />
        <StatusCard
          icon={KeyRound}
          title={isZh ? 'LLM Key' : 'LLM key'}
          status={llmReady ? (isZh ? '已就绪' : 'Ready') : isZh ? '缺失' : 'Missing'}
          tone={llmReady ? 'good' : 'warn'}
          description={
            llmReady
              ? isZh
                ? '当前润色模型的 API Key 已保存在本机。'
                : 'An LLM API key is saved locally for your current provider.'
              : isZh
                ? '测试 AI 润色前，请先在设置里补上 LLM Key。'
                : 'Add an LLM API key in Settings before testing AI polish.'
          }
        />
      </div>

      <div className="border border-border rounded-[10px] overflow-hidden">
        <SectionHeader icon={Gauge} title={isZh ? '累计使用统计' : 'Usage summary'} />
        <div className="grid grid-cols-2 gap-px bg-border">
          <MiniStat
            icon={TimerReset}
            label={isZh ? '总口述时间' : 'Total dictation time'}
            value={formatDuration(historyStats.total_duration_ms, isZh)}
          />
          <MiniStat
            icon={Text}
            label={isZh ? '累计字数' : 'Total characters'}
            value={formatInteger(historyStats.total_characters)}
          />
          <MiniStat
            icon={Clock3}
            label={isZh ? '节约时间' : 'Estimated time saved'}
            value={formatDuration(historyStats.estimated_saved_ms, isZh)}
          />
          <MiniStat
            icon={Gauge}
            label={isZh ? '平均口速' : 'Average pace'}
            value={formatPace(historyStats.average_chars_per_minute, isZh)}
          />
        </div>
      </div>

      <div className="border border-border rounded-[10px] overflow-hidden">
        <SectionHeader icon={Clock3} title={isZh ? '本月 API 估算' : 'This month API estimate'} />
        <div className="grid grid-cols-2 gap-px bg-border">
          <MiniStat
            icon={TimerReset}
            label={isZh ? 'STT 时长' : 'STT duration'}
            value={formatDuration(historyStats.month_duration_ms, isZh)}
          />
          <MiniStat
            icon={Clock3}
            label={isZh ? 'STT 费用' : 'STT cost'}
            value={formatCurrency(historyStats.month_stt_cost_cny, 'CNY')}
          />
          <MiniStat
            icon={Text}
            label={isZh ? '输入 tokens' : 'Input tokens'}
            value={formatInteger(historyStats.month_llm_input_tokens)}
          />
          <MiniStat
            icon={Gauge}
            label={isZh ? 'LLM 费用' : 'LLM cost'}
            value={formatCurrency(historyStats.month_llm_cost_usd, 'USD')}
          />
        </div>
        <div className="px-4 py-3 bg-bg-primary text-[12px] text-text-secondary leading-relaxed border-t border-border">
          {isZh
            ? '说明：目前这块按照本地历史做估算。火山语音按录音时长估算，DeepSeek 按估算 tokens 计算。'
            : 'Note: this panel uses local estimates. Volcengine STT is estimated from audio duration, and DeepSeek is estimated from token usage.'}
        </div>
      </div>

      <div className="border border-border rounded-[10px] overflow-hidden">
        <SectionHeader icon={Database} title={isZh ? '数据存储' : 'Storage'} />
        <div className="px-4 py-4 space-y-2 text-text-secondary leading-relaxed">
          <p>
            {isZh
              ? '设置和 API Key 通过本机应用存储保存。'
              : 'Settings and API keys are stored locally on this machine.'}
          </p>
          <p>
            {isZh
              ? '历史记录、纠错结果和词典都保存在本地数据库里。'
              : 'History, corrections, and dictionary data are stored in the bundled local database.'}
          </p>
          <p>
            {isZh
              ? '这套 fork 去掉了必须登录才能使用核心语音输入流程的限制。'
              : 'This edition removes the need to sign in just to use the core voice-input workflow.'}
          </p>
        </div>
      </div>

      <div className="border border-border rounded-[10px] overflow-hidden">
        <SectionHeader icon={ShieldCheck} title={isZh ? '说明' : 'Notes'} />
        <div className="px-4 py-4 space-y-2 text-text-secondary leading-relaxed">
          <p>
            {isZh
              ? '界面里显示的节约时间是估算值，便于你快速感知语音输入的效率。'
              : 'Time saved is an estimate, meant to give you a quick feel for efficiency gains.'}
          </p>
          <p>
            {isZh
              ? '如果你更在意速度，优先看 STT 服务；如果你更在意成文效果，优先看 LLM 润色阶段。'
              : 'If you care more about speed, focus on STT. If you care more about final phrasing, focus on the LLM polish stage.'}
          </p>
        </div>
      </div>
    </div>
  )
}

function SectionHeader({
  icon: Icon,
  title,
}: {
  icon: typeof CircleUser
  title: string
}) {
  return (
    <div className="px-4 py-3 bg-bg-secondary/50 border-b border-border">
      <div className="flex items-center gap-2">
        <Icon size={15} className="text-text-secondary" />
        <h2 className="text-[13px] font-medium text-text-primary">{title}</h2>
      </div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between px-4 py-3 border-b border-border last:border-b-0">
      <span className="text-text-secondary">{label}</span>
      <span className="text-text-primary">{value}</span>
    </div>
  )
}

function StatusCard({
  icon: Icon,
  title,
  status,
  tone,
  description,
}: {
  icon: typeof CircleUser
  title: string
  status: string
  tone: 'good' | 'warn'
  description: string
}) {
  const toneClass =
    tone === 'good'
      ? 'bg-green-500/10 text-green-600 border-green-500/20'
      : 'bg-amber-500/10 text-amber-600 border-amber-500/20'

  const StatusIcon = tone === 'good' ? ShieldCheck : ShieldAlert

  return (
    <div className="rounded-[10px] border border-border p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon size={15} className="text-text-secondary" />
          <span className="text-[13px] font-medium text-text-primary">{title}</span>
        </div>
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] ${toneClass}`}
        >
          <StatusIcon size={11} />
          {status}
        </span>
      </div>
      <p className="text-[12px] text-text-secondary leading-relaxed">{description}</p>
    </div>
  )
}

function MiniStat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof CircleUser
  label: string
  value: string
}) {
  return (
    <div className="bg-bg-primary px-4 py-4 space-y-1.5">
      <div className="flex items-center gap-2 text-text-secondary">
        <Icon size={13} />
        <span className="text-[11px]">{label}</span>
      </div>
      <p className="text-[16px] font-semibold text-text-primary">{value}</p>
    </div>
  )
}
