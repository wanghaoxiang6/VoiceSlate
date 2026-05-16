import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Search, Copy, Trash2, PencilLine, RotateCcw, Check, X } from 'lucide-react'
import { spring } from '../../lib/animations'
import { useAppStore } from '../../stores/appStore'
import { clearHistory, getHistory, getHistoryStats, updateHistoryCorrection } from '../../lib/tauri'
import { toast } from '../Toast'
import { getHistoryDisplayText } from '../../lib/history'

export function History() {
  const history = useAppStore((s) => s.history)
  const setHistory = useAppStore((s) => s.setHistory)
  const setHistoryStats = useAppStore((s) => s.setHistoryStats)
  const uiLanguage = useAppStore((s) => s.config.ui_language)
  const isZh = uiLanguage === 'zh'
  const [search, setSearch] = useState('')
  const [copiedId, setCopiedId] = useState<number | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draftText, setDraftText] = useState('')
  const [savingId, setSavingId] = useState<number | null>(null)

  const filtered = useMemo(
    () =>
      search
        ? history.filter((entry) => {
            const displayText = getHistoryDisplayText(entry)
            return (
              displayText.includes(search) ||
              entry.polished_text.includes(search) ||
              entry.raw_text.includes(search) ||
              entry.app_name.includes(search)
            )
          })
        : history,
    [history, search],
  )

  const handleCopy = (id: number, text: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopiedId(id)
        setTimeout(() => setCopiedId(null), 1500)
      })
      .catch(() => {
        toast.error(isZh ? '复制失败' : 'Failed to copy')
      })
  }

  const refreshHistory = async () => {
    const [nextHistory, stats] = await Promise.all([getHistory(200, 0), getHistoryStats()])
    setHistory(nextHistory)
    setHistoryStats(stats)
  }

  const handleClear = async () => {
    const confirmed = window.confirm(
      isZh ? '确定要清空所有历史记录吗？此操作无法撤销。' : 'Clear all history? This cannot be undone.',
    )
    if (!confirmed) return

    try {
      await clearHistory()
      setHistory([])
      setHistoryStats({
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
      })
    } catch (e) {
      console.error('Failed to clear history:', e)
      toast.error(isZh ? '清空历史失败' : 'Failed to clear history')
    }
  }

  const handleStartEdit = (id: number, text: string) => {
    setEditingId(id)
    setDraftText(text)
  }

  const handleCancelEdit = () => {
    setEditingId(null)
    setDraftText('')
  }

  const handleSaveEdit = async (entryId: number, polishedText: string) => {
    const trimmed = draftText.trim()
    const payload = !trimmed || trimmed === polishedText.trim() ? null : trimmed

    try {
      setSavingId(entryId)
      await updateHistoryCorrection(entryId, payload)
      await refreshHistory()
      setEditingId(null)
      setDraftText('')
      toast.success(isZh ? '纠错已保存' : 'Correction saved')
    } catch (e) {
      console.error('Failed to update correction:', e)
      toast.error(isZh ? '保存纠错失败' : 'Failed to save correction')
    } finally {
      setSavingId(null)
    }
  }

  const handleResetCorrection = async (entryId: number) => {
    try {
      setSavingId(entryId)
      await updateHistoryCorrection(entryId, null)
      await refreshHistory()
      toast.success(isZh ? '已恢复原始输出' : 'Original output restored')
    } catch (e) {
      console.error('Failed to reset correction:', e)
      toast.error(isZh ? '恢复失败' : 'Failed to restore original output')
    } finally {
      setSavingId(null)
    }
  }

  const grouped = useMemo(() => {
    const map = new Map<string, typeof filtered>()
    for (const entry of filtered) {
      const date = entry.created_at.split('T')[0] || entry.created_at.split(' ')[0]
      const today = new Date().toISOString().split('T')[0]
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]
      const label =
        date === today ? (isZh ? '今天' : 'Today') : date === yesterday ? (isZh ? '昨天' : 'Yesterday') : date
      if (!map.has(label)) map.set(label, [])
      map.get(label)!.push(entry)
    }
    return map
  }, [filtered, isZh])

  return (
    <div className="w-full h-full bg-bg-primary text-text-primary flex flex-col">
      <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-border">
        <h2 className="text-[15px] font-medium">{isZh ? '历史记录' : 'History'}</h2>
      </div>

      <div className="px-5 py-3">
        <div className="relative">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={isZh ? '搜索历史记录...' : 'Search history...'}
            className="w-full pl-8 pr-3 py-2.5 bg-bg-secondary border border-border rounded-[14px] text-[13px] text-text-primary outline-none focus:ring-2 focus:ring-jelly-primary focus:border-jelly-primary transition-all jelly-btn"
            style={{ transform: 'none' }}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-4">
        {filtered.length === 0 ? (
          <p className="text-center text-text-tertiary text-[13px] py-12">
            {search ? (
              isZh ? '没有匹配结果' : 'No matching results'
            ) : (
              <>
                {isZh ? '暂无历史记录。' : 'No history yet.'}
                <br />
                <span className="text-[12px]">
                  {isZh ? '按下快捷键开始录音，转录内容会显示在这里。' : 'Press your hotkey to start recording.'}
                </span>
              </>
            )}
          </p>
        ) : (
          <AnimatePresence>
            {Array.from(grouped.entries()).map(([label, entries]) => (
              <div key={label} className="mb-4">
                <h3 className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider mb-2 px-1 pb-1 border-b border-border">
                  {label}
                </h3>
                <div className="space-y-2">
                  {entries.map((entry) => {
                    const displayText = getHistoryDisplayText(entry)
                    const isEditing = editingId === entry.id
                    const hasCorrection = !!entry.corrected_text?.trim()

                    return (
                      <motion.div
                        key={entry.id}
                        whileHover={{ scale: 1.005 }}
                        transition={spring.jellyGentle}
                        className="group rounded-[12px] border border-border bg-bg-secondary/50 px-3 py-3"
                      >
                        <div className="flex items-start gap-3">
                          <div className="flex-1 min-w-0 space-y-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-[11px] text-text-tertiary">
                                {(entry.created_at.split('T')[1] || '').slice(0, 5)} · {entry.app_name}
                              </p>
                              {hasCorrection && (
                                <span className="inline-flex rounded-full bg-accent/10 px-2 py-0.5 text-[10px] text-accent">
                                  {isZh ? '已纠错' : 'Corrected'}
                                </span>
                              )}
                            </div>

                            {isEditing ? (
                              <>
                                <textarea
                                  value={draftText}
                                  onChange={(e) => setDraftText(e.target.value)}
                                  className="w-full min-h-[110px] rounded-[12px] border border-border bg-bg-primary px-3 py-2.5 text-[13px] leading-relaxed text-text-primary outline-none focus:ring-2 focus:ring-jelly-primary"
                                />
                                <div className="rounded-[10px] bg-bg-primary px-3 py-2 text-[12px] text-text-secondary space-y-1">
                                  <p className="font-medium text-text-primary">
                                    {isZh ? '识别参考' : 'Recognition reference'}
                                  </p>
                                  <p>{entry.raw_text}</p>
                                </div>
                              </>
                            ) : (
                              <>
                                <p className="whitespace-pre-wrap text-[13px] text-text-primary leading-relaxed">
                                  {displayText}
                                </p>
                                {hasCorrection && (
                                  <p className="text-[11px] text-text-tertiary whitespace-pre-wrap">
                                    {isZh ? '原始输出：' : 'Original output: '}
                                    {entry.polished_text}
                                  </p>
                                )}
                              </>
                            )}
                          </div>

                          <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                            {isEditing ? (
                              <>
                                <IconButton
                                  icon={Check}
                                  label={isZh ? '保存' : 'Save'}
                                  onClick={() => handleSaveEdit(entry.id, entry.polished_text)}
                                  disabled={savingId === entry.id}
                                />
                                <IconButton
                                  icon={X}
                                  label={isZh ? '取消' : 'Cancel'}
                                  onClick={handleCancelEdit}
                                  disabled={savingId === entry.id}
                                />
                              </>
                            ) : (
                              <>
                                <IconButton
                                  icon={Copy}
                                  label={isZh ? '复制' : 'Copy'}
                                  onClick={() => handleCopy(entry.id, displayText)}
                                />
                                <IconButton
                                  icon={PencilLine}
                                  label={isZh ? '纠错' : 'Correct'}
                                  onClick={() => handleStartEdit(entry.id, displayText)}
                                />
                                {hasCorrection && (
                                  <IconButton
                                    icon={RotateCcw}
                                    label={isZh ? '还原' : 'Reset'}
                                    onClick={() => handleResetCorrection(entry.id)}
                                    disabled={savingId === entry.id}
                                  />
                                )}
                              </>
                            )}
                            {copiedId === entry.id && (
                              <span className="text-[11px] text-success">
                                {isZh ? '已复制' : 'Copied'}
                              </span>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    )
                  })}
                </div>
              </div>
            ))}
          </AnimatePresence>
        )}
      </div>

      {history.length > 0 && (
        <div className="px-5 py-3 border-t border-border">
          <motion.button
            onClick={handleClear}
            whileHover={{ scale: 1.04 }}
            whileTap={{ scaleX: 1.06, scaleY: 0.94 }}
            transition={spring.jellyGentle}
            className="flex items-center justify-center gap-1.5 w-full py-2 text-[12px] text-text-tertiary hover:text-error rounded-[10px] cursor-pointer transition-colors jelly-btn"
          >
            <Trash2 size={12} />
            {isZh ? '清空所有历史记录' : 'Clear All History'}
          </motion.button>
        </div>
      )}
    </div>
  )
}

function IconButton({
  icon: Icon,
  label,
  onClick,
  disabled = false,
}: {
  icon: typeof Copy
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1 rounded-[8px] px-2 py-1.5 text-[11px] text-text-tertiary hover:text-accent hover:bg-bg-primary transition-colors bg-transparent border-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      aria-label={label}
    >
      <Icon size={12} />
      <span>{label}</span>
    </button>
  )
}
