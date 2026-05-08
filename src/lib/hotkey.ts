const HOTKEY_LABELS: Record<string, string> = {
  AltRight: '右 Alt',
  AltLeft: '左 Alt',
  ControlRight: '右 Ctrl',
  ControlLeft: '左 Ctrl',
  ShiftRight: '右 Shift',
  ShiftLeft: '左 Shift',
  MetaRight: '右 Win',
  MetaLeft: '左 Win',
  Slash: '/',
}

export function formatHotkeyLabel(hotkey: string): string {
  return hotkey
    .split('+')
    .map((part) => HOTKEY_LABELS[part] ?? part)
    .join('+')
}
