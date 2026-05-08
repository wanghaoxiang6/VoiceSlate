import { useEffect, useRef } from 'react'
import { useAppStore, type PipelineState } from '../stores/appStore'

interface CapsuleSize {
  width: number
  height: number
}

function getSizeForState(
  state: PipelineState,
  expanded: boolean,
  hasError: boolean,
  contextMenuOpen: boolean,
): CapsuleSize {
  if (contextMenuOpen) return { width: 220, height: 220 }
  if (hasError) return { width: 200, height: 36 }
  if (expanded) return { width: 220, height: 90 }

  switch (state) {
    case 'idle':
      return { width: 36, height: 36 }
    case 'recording':
      return { width: 200, height: 36 }
    case 'transcribing':
    case 'polishing':
      return { width: 220, height: 36 }
    case 'outputting':
      return { width: 120, height: 36 }
    default:
      return { width: 36, height: 36 }
  }
}

export function useCapsuleResize() {
  const pipelineState = useAppStore((s) => s.pipelineState)
  const capsuleExpanded = useAppStore((s) => s.capsuleExpanded)
  const pipelineError = useAppStore((s) => s.pipelineError)
  const contextMenuOpen = useAppStore((s) => s.contextMenuOpen)
  const setContextMenuReady = useAppStore((s) => s.setContextMenuReady)
  const capsuleAutoHide = useAppStore((s) => s.config.capsule_auto_hide)
  const initialized = useRef(false)
  const prevWindowSize = useRef<{ width: number; height: number } | null>(null)
  const prevState = useRef<PipelineState>('idle')
  const prevAutoHide = useRef(false)
  const isWindows =
    typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('WIN')

  const hasError = pipelineError !== null

  useEffect(() => {
    const size = getSizeForState(pipelineState, capsuleExpanded, hasError, contextMenuOpen)
    const windowWidth = size.width + 24
    const windowHeight = size.height + 24

    import('@tauri-apps/api/window')
      .then(async ({ getCurrentWindow, LogicalSize, LogicalPosition, currentMonitor }) => {
        const win = getCurrentWindow()

        const becameIdle = prevState.current !== 'idle' && pipelineState === 'idle'
        const leftIdle = prevState.current === 'idle' && pipelineState !== 'idle'
        prevState.current = pipelineState

        if (!isWindows && capsuleAutoHide && !contextMenuOpen && !capsuleExpanded) {
          if (leftIdle) {
            await win.show().catch(() => {})
          } else if (becameIdle && initialized.current) {
            await win.hide().catch(() => {})
            prevAutoHide.current = capsuleAutoHide
            return
          }
        }

        if (!isWindows && prevAutoHide.current && !capsuleAutoHide && pipelineState === 'idle') {
          await win.show().catch(() => {})
        }
        prevAutoHide.current = capsuleAutoHide

        if (!initialized.current) {
          await win.setSize(new LogicalSize(windowWidth, windowHeight)).catch(() => {})
          try {
            const monitor = await currentMonitor()
            if (monitor) {
              const sw = monitor.size.width / monitor.scaleFactor
              const sh = monitor.size.height / monitor.scaleFactor
              const x = Math.round(sw / 2 - windowWidth / 2)
              const y = Math.round(sh - windowHeight - 80)
              await win.setPosition(new LogicalPosition(x, y)).catch(() => {})
            }
            if (!capsuleAutoHide || isWindows) {
              await win.show().catch(() => {})
            }
          } catch {
            if (!capsuleAutoHide || isWindows) {
              await win.show().catch(() => {})
            }
          }

          initialized.current = true
          prevWindowSize.current = { width: windowWidth, height: windowHeight }
          return
        }

        const prev = prevWindowSize.current
        if (prev) {
          const pos = await win.outerPosition().catch(() => null)
          if (pos) {
            const monitor = await currentMonitor()
            const scale = monitor?.scaleFactor ?? 1
            const oldLeftX = pos.x / scale
            const oldCenterY = pos.y / scale + prev.height / 2
            const newX = Math.round(oldLeftX)
            const newY = Math.round(oldCenterY - windowHeight / 2)
            await win.setPosition(new LogicalPosition(newX, newY)).catch(() => {})
            await win.setSize(new LogicalSize(windowWidth, windowHeight)).catch(() => {})
          } else {
            await win.setSize(new LogicalSize(windowWidth, windowHeight)).catch(() => {})
          }
        } else {
          await win.setSize(new LogicalSize(windowWidth, windowHeight)).catch(() => {})
        }

        prevWindowSize.current = { width: windowWidth, height: windowHeight }

        if (contextMenuOpen) {
          setContextMenuReady(true)
        }
      })
      .catch(() => {})
  }, [
    pipelineState,
    capsuleExpanded,
    hasError,
    contextMenuOpen,
    capsuleAutoHide,
    isWindows,
    setContextMenuReady,
  ])

  return getSizeForState(pipelineState, capsuleExpanded, hasError, contextMenuOpen)
}
