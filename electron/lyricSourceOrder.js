/**
 * 歌词源偏好 → 主进程尝试顺序（纯函数）
 *
 * 语义：偏好源只决定「优先」，不是「唯一」——首选源失败时仍自动回退到其他源，
 * 保持多源可用性。渲染层把 settingsStore.lyricPreferredSource 通过 get-lyric IPC 传下来，
 * 默认优先使用 'bilibili'（B 站 CC 字幕），未知/缺失值一律兜底 'bilibili'。
 *
 * 独立成模块的原因：main.js 依赖整个 Electron 运行时，无法在 Node 里直接单测，
 * 抽成纯函数后仓库根目录的测试脚本可以直接 require 到主进程真正使用的那份实现。
 */

const LYRIC_SOURCES = ['bilibili', 'kugou', 'netease'];
const DEFAULT_LYRIC_SOURCE = 'bilibili';

/**
 * @param {unknown} preferred 渲染层传入的偏好源
 * @returns {string[]} 完整的尝试顺序，首位为偏好源
 */
function resolveLyricSourceOrder(preferred) {
  const primary = LYRIC_SOURCES.includes(preferred) ? preferred : DEFAULT_LYRIC_SOURCE;
  return [primary, ...LYRIC_SOURCES.filter((source) => source !== primary)];
}

module.exports = { LYRIC_SOURCES, DEFAULT_LYRIC_SOURCE, resolveLyricSourceOrder };
