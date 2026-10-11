/**
 * LRC 歌词解析器（纯函数，无状态）。
 * 由主窗口 lyricStore 与桌面歌词窗口共用 —— 修改时注意两个入口的兼容性。
 *
 * 输入：
 *   - 字符串：纯 lrc 文本
 *   - 对象：{ lrc, rv, tv }（网易云 API 的原文/罗马音/翻译三路文本）
 * 输出：
 *   { lyrics: [{ time(ms), text, romaji?, translation? }], title, artist, _lyricV3: true }
 *   按 time 升序排列；_lyricV3 标记用于缓存版本识别（见 stores/lyric.js getCachedLyric）
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
  const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\](.+)/
  const titleRegex = /\[ti:(.+)\]/
  const artistRegex = /\[ar:(.+)\]/
  const creditRegex = /^(作词|作曲|编曲|制作人|和声编写|和声|吉他|贝斯|鼓|键盘|弦乐|录音工程|录音|混音工程|混音|母带|母带后期|母带工程|监制|OP|SP|原唱|翻唱|原曲|改编|发行|出品|封面|设计|统筹|企划)[''']?\s*[:：]/

  // 把 [mm:ss.xx] 行解析成完整毫秒时间戳（与 lrc 主循环的 timeMs 同算法）
  function lineToTimeMs(m) {
    return parseInt(m[1]) * 60000 + parseInt(m[2]) * 1000 + parseInt(m[3].padEnd(3, '0'))
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
  const rvLines = rvText ? rvText.split('\n') : []
  const rvMap = {}
  for (const line of rvLines) {
    const m = line.match(timeRegex)
    if (m) {
      rvMap[lineToTimeMs(m)] = m[4].trim()
    }
  }

  // 解析 tv 翻译（可选）
  const tvLines = tvText ? tvText.split('\n') : []
  const tvMap = {}
  for (const line of tvLines) {
    const m = line.match(timeRegex)
    if (m) {
      tvMap[lineToTimeMs(m)] = m[4].trim()
    }
  }

  for (const line of lines) {
    const titleMatch = line.match(titleRegex)
    if (titleMatch) { title = titleMatch[1]; continue }
    const artistMatch = line.match(artistRegex)
    if (artistMatch) { artist = artistMatch[1]; continue }
    const match = line.match(timeRegex)
    if (match) {
      const minutes = parseInt(match[1])
      const seconds = parseInt(match[2])
      const milliseconds = parseInt(match[3].padEnd(3, '0'))
      const text = match[4].trim()
      if (text) {
        const timeMs = minutes * 60000 + seconds * 1000 + milliseconds
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
  }
  lyrics.sort((a, b) => a.time - b.time)
  // _lyricV3 标记：新解析器（rv/tv 完整时间戳匹配 + 主进程 romalrc 字段修复）产出的结果。
  // getCachedLyric 用该标记识别"旧 Bug 解析器产出的缓存"（romaji/translation 缺失），
  // 命中旧缓存视为过期重新拉取，否则修复后已缓存的歌仍然切不出翻译/罗马音。
  return { lyrics, title, artist, _lyricV3: true }
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
