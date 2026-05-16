import type { HistoryEntry } from '../stores/appStore'

export function getHistoryDisplayText(entry: HistoryEntry) {
  return entry.corrected_text?.trim() || entry.polished_text || entry.raw_text
}

export function formatDuration(ms: number, isZh: boolean) {
  if (ms <= 0) return isZh ? '0 分钟' : '0 min'

  const totalSeconds = Math.round(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return isZh
      ? `${hours} 小时 ${minutes} 分`
      : `${hours}h ${minutes}m`
  }

  if (minutes > 0) {
    return isZh
      ? `${minutes} 分 ${seconds} 秒`
      : `${minutes}m ${seconds}s`
  }

  return isZh ? `${seconds} 秒` : `${seconds}s`
}

export function formatInteger(value: number) {
  return new Intl.NumberFormat().format(Math.round(value))
}

export function formatPace(charsPerMinute: number, isZh: boolean) {
  if (!Number.isFinite(charsPerMinute) || charsPerMinute <= 0) {
    return isZh ? '0 字/分钟' : '0 chars/min'
  }

  const rounded = Math.round(charsPerMinute)
  return isZh ? `${formatInteger(rounded)} 字/分钟` : `${formatInteger(rounded)} chars/min`
}

export function formatCurrency(value: number, currency: 'CNY' | 'USD') {
  const normalized = Number.isFinite(value) ? value : 0
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    minimumFractionDigits: normalized < 1 ? 3 : 2,
    maximumFractionDigits: normalized < 1 ? 3 : 2,
  }).format(normalized)
}
