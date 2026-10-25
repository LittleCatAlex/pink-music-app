/**
 * Electron accelerator → 平台友好文案（纯函数，零依赖）
 * ─────────────────────────────────────────────────────────
 * 用途：桌面歌词窗的 style 消息里带 hotkeyLabel，让歌词窗显示「⌘D」而不是
 * 「CommandOrControl+D」。映射与 MineView 设置页的 formatHotkey 保持同一套语义，
 * 两处文案必须一致（改一处要同步另一处）。
 *
 * 独立成模块：无 Vue / DOM 依赖，Node 里可直接单测（scripts/test-hotkey-label.mjs）。
 */

const MAC = 'mac'
const WIN = 'win'

const MAC_MODIFIERS = {
  CommandOrControl: '⌘', CmdOrCtrl: '⌘', Command: '⌘', Cmd: '⌘', Super: '⌘',
  // macOS 上物理 Ctrl 只是修饰键之一，设置页同样显示为 ⌘，保持一致
  Control: '⌘', Ctrl: '⌘',
  Alt: '⌥', Option: '⌥',
  Shift: '⇧'
}

const WIN_MODIFIERS = {
  CommandOrControl: 'Ctrl', CmdOrCtrl: 'Ctrl', Control: 'Ctrl', Ctrl: 'Ctrl',
  Command: 'Win', Cmd: 'Win', Super: 'Win',
  Alt: 'Alt', Option: 'Alt', AltGr: 'AltGr',
  Shift: 'Shift'
}

/** 平台归一：darwin/mac → mac，其余（含缺失）→ win */
export function normalizePlatform(platform) {
  const p = typeof platform === 'string' ? platform.toLowerCase() : ''
  return p === MAC || p === 'darwin' ? MAC : WIN
}

/** 从 navigator 探测平台（默认 win，调用方可显式传入覆盖） */
export function detectPlatform(nav) {
  const n = nav || (typeof navigator !== 'undefined' ? navigator : null)
  const probe = n ? String(n.platform || '') + ' ' + String(n.userAgent || '') : ''
  return /Mac|iPod|iPhone|iPad/.test(probe) ? MAC : WIN
}

/**
 * @param {string} accel Electron accelerator，如 'CommandOrControl+D'
 * @param {'mac'|'win'|'darwin'|'win32'} [platform] 省略时按 navigator 探测
 * @returns {string} 平台友好文案：mac '⌘D' / win 'Ctrl+D'；非法输入返回 ''
 */
export function toHotkeyLabel(accel, platform) {
  if (typeof accel !== 'string') return ''
  const parts = accel.split('+').filter((part) => part)
  if (!parts.length) return ''
  const isMac = normalizePlatform(platform || detectPlatform()) === MAC
  const table = isMac ? MAC_MODIFIERS : WIN_MODIFIERS
  const key = parts.pop()
  const mods = parts.map((part) => table[part] || part)
  return isMac ? mods.join('') + key : mods.concat(key).join('+')
}
