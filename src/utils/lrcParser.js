/**
 * LRC 歌词解析器（纯函数，无状态）。
 * 由主窗口 lyricStore 与桌面歌词窗口共用 —— 修改时注意两个入口的兼容性。
 *
 * 输入：
 *   - 字符串：纯 lrc 文本
 *   - 对象：{ lrc, rv, tv }（网易云 API 的原文/罗马音/翻译三路文本）
 * 输出：
 *   { lyrics: [{ time(ms), text, romaji?, translation? }], title, artist, _lyricV3: true, _lyricParserV: 4 }
 *   按 time 升序排列；_lyricV3 / _lyricParserV 用于缓存版本识别（见 stores/lyric.js getCachedLyric）
 *   支持一行多时间戳（[t1][t2]词）与全局 [offset:±ms]（正 offset = 歌词提前，rv/tv 对齐一并生效）
 */
export function parseLyric(rawLyric) {
  // 支持新版对象格式 { lrc, rv, tv }
  let lrcText = rawLyric
  let rvText = ''
  let tvText = ''
  if (rawLyric && typeof rawLyric === 'object' && !Array.isArray(rawLyric) && 'lrc' in rawLyric) {
    lrcText = rawLyric.lrc || ''
    rvText = rawLyric.rv || ''
    tvText = rawLyric.tv || ''
  }
  const lyrics = []
  const lines = lrcText.split('\n')
  let title = ''
  let artist = ''
  // [mm:ss] / [mm:ss.x] / [mm:ss.xx] / [mm:ss.xxx] / [m:ss.xx] / [mmm:ss.xx]
  const timeRegex = /\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?\]/g
  const offsetMatch = lrcText.match(/\[offset:\s*([+-]?\d+)\s*\]/i)
  // 正 offset = 歌词提前：timestamp - offset，与 findLineIndexAtTime 的「正偏移=提前」一致
  const offsetMs = offsetMatch ? parseInt(offsetMatch[1], 10) || 0 : 0
  const titleRegex = /\[ti:(.+)\]/
  const artistRegex = /\[ar:(.+)\]/
  const creditRegex = /^(作词|作曲|编曲|制作人|和声编写|和声|吉他|贝斯|鼓|键盘|弦乐|录音工程|录音|混音工程|混音|母带|母带后期|母带工程|监制|OP|SP|原唱|翻唱|原曲|改编|发行|出品|封面|设计|统筹|企划)[''']?\s*[:：]/

  // 小数位 1/2/3 位分别按 ×100/×10/×1 折算毫秒，再减去全局 offset（正 offset 提前）
  function toTimeMs(m) {
    return parseInt(m[1], 10) * 60000 + parseInt(m[2], 10) * 1000 + parseInt((m[3] || '').padEnd(3, '0'), 10) - offsetMs
  }
  // 解析行首连续的多个时间戳：[t1][t2]词 → 每个时间戳一条，文本不含时间戳
  function parseTimestampLine(line) {
    const times = []
    let cursor = 0
    timeRegex.lastIndex = 0
    let m
    while ((m = timeRegex.exec(line))) {
      if (line.slice(cursor, m.index).trim()) break
      times.push(toTimeMs(m))
      cursor = timeRegex.lastIndex
    }
    if (!times.length) return null
    return { times, text: line.slice(cursor).trim() }
  }
  // 就近匹配：rv/tv 与 lrc 的时间精度可能有微小差异，精确 key 找不到时在 ±500ms 内取最近一条
  function findTimeMatch(map, target) {
    if (map[target]) return map[target]
    let best = null
    let bestDiff = Infinity
    for (const key in map) {
      const diff = Math.abs(Number(key) - target)
      if (diff < bestDiff) {
        bestDiff = diff
        best = map[key]
        if (diff === 0) break
      }
    }
    return bestDiff <= 500 ? best : null
  }

  // 解析 rv 罗马音（可选）
  const rvMap = {}
  for (const line of rvText ? rvText.split('\n') : []) {
    const parsed = parseTimestampLine(line)
    if (!parsed) continue
    for (const timeMs of parsed.times) rvMap[timeMs] = parsed.text
  }

  // 解析 tv 翻译（可选）
  const tvMap = {}
  for (const line of tvText ? tvText.split('\n') : []) {
    const parsed = parseTimestampLine(line)
    if (!parsed) continue
    for (const timeMs of parsed.times) tvMap[timeMs] = parsed.text
  }

  for (const line of lines) {
    const titleMatch = line.match(titleRegex)
    if (titleMatch) { title = titleMatch[1]; continue }
    const artistMatch = line.match(artistRegex)
    if (artistMatch) { artist = artistMatch[1]; continue }
    const parsed = parseTimestampLine(line)
    if (!parsed || !parsed.text) continue
    const text = parsed.text
    for (const timeMs of parsed.times) {
      if (creditRegex.test(text)) {
        if (timeMs < 11000) continue
      }
      if (timeMs < 11000 && (
        text.includes('·原版') || text.includes('·伴奏') ||
        text.includes('·和声') || text.includes('·纯音乐') ||
        text.includes('未经许可') || text.includes('未经授权') ||
        text.includes('版权所有') || text.includes('本歌曲') ||
        text.includes('https://') || text.includes('http://')
      )) continue
      lyrics.push({
        time: timeMs,
        text,
        romaji: findTimeMatch(rvMap, timeMs),
        translation: findTimeMatch(tvMap, timeMs)
      })
    }
  }
  lyrics.sort((a, b) => a.time - b.time)
  // _lyricV3 标记：新解析器（rv/tv 完整时间戳匹配 + 主进程 romalrc 字段修复）产出的结果。
  // getCachedLyric 用该标记识别"旧 Bug 解析器产出的缓存"（romaji/translation 缺失），
  // 命中旧缓存视为过期重新拉取，否则修复后已缓存的歌仍然切不出翻译/罗马音。
  // _lyricParserV 为解析规则版本（4 = 多时间戳 + offset 符号修正），缓存据此失效重解析
  return { lyrics, title, artist, _lyricV3: true, _lyricParserV: 4 }
}

/**
 * 歌词行定位（与 stores/lyric.js updateCurrentLine 同算法：二分 + +500ms 提前量）。
 * offset 为每首偏移量（毫秒）。
 */
export function findLineIndexAtTime(lyrics, currentTimeSeconds, offsetMs = 0) {
  if (!Array.isArray(lyrics) || lyrics.length === 0) return -1
  const t = Number(currentTimeSeconds)
  if (!Number.isFinite(t)) return -1
  const offset = Number(offsetMs) || 0
  const target = t * 1000 + offset + 500
  let lo = 0
  let hi = lyrics.length - 1
  let index = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const lineTime = Number(lyrics[mid]?.time)
    if (Number.isFinite(lineTime) && lineTime <= target) {
      index = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return index
}
