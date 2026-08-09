import { defineStore } from 'pinia'
import { createPersistentStorage } from '@/utils/persistentStorage'
import { s, defineSchema } from '@/utils/schema'

// ───────── 持久化结构改造 ─────────
// 老版本把歌词数据分 3 个 localStorage key：
//   pink-music-lyric-cache / pink-music-lyric-offsets / pink-music-lyric-sources
// 新版本统一存到主存储的 'lyrics' 一个文件里：
//   { cache: { key: { data, timestamp, source } }, offsets: { key: number }, sources: { key: string } }
//   ↓ 一次原子写，三个字段同步更新，彻底杜绝"半新半旧"
//
// localStorage 兜底：第一次启动时 storage.load() 会自动从老 3 key 拼起来迁到主存储。

// Schema v1：歌词数据 3 个 map
// cache/offsets/sources 都是 { [key: string]: any }，不强校验内部结构（保留扩展性）
const lyricsSchema = defineSchema({
  version: 1,
  fields: {
    cache: s.object({}, false),    // 嵌套 object 走 any 字段
    offsets: s.object({}, false),
    sources: s.object({}, false)
  }
})

const storage = createPersistentStorage('lyrics', { schema: lyricsSchema, debounceMs: 0 })

const FALLBACK_CACHE = 'pink-music-lyric-cache'
const FALLBACK_OFFSETS = 'pink-music-lyric-offsets'
const FALLBACK_SOURCES = 'pink-music-lyric-sources'

// 同步 peek：主存储 peek 不到时，从 3 个老 key 拼装一份
function peekLyrics() {
  const main = storage.peek(null)
  if (main && typeof main === 'object' && (main.cache || main.offsets || main.sources)) {
    return main
  }
  // 回退 3 个老 key
  let cache = {}, offsets = {}, sources = {}
  try { const r = localStorage.getItem(FALLBACK_CACHE); if (r) cache = JSON.parse(r) } catch (_) {}
  try { const r = localStorage.getItem(FALLBACK_OFFSETS); if (r) offsets = JSON.parse(r) } catch (_) {}
  try { const r = localStorage.getItem(FALLBACK_SOURCES); if (r) sources = JSON.parse(r) } catch (_) {}
  if (Object.keys(cache).length === 0 && Object.keys(offsets).length === 0 && Object.keys(sources).length === 0) {
    return null
  }
  return { cache, offsets, sources }
}

const initial = peekLyrics() || { cache: {}, offsets: {}, sources: {} }

export const useLyricStore = defineStore('lyric', {
  state: () => ({
    currentLyric: null,
    loadedHash: '',
    currentLineIndex: -1,
    isLyricLoading: false,
    lyricError: '',
    lyricSource: '',
    showLyricPanel: true,
    // 由 getCacheKey(bvid, cid, author, title) 索引
    lyricCache: initial.cache || {},
    // 用户调整的每首歌偏移量（"歌词进度"）
    lyricOffsets: initial.offsets || {},
    // 记录"用户手动指定"的来源（netease cache / manual），便于重置
    lyricSources: initial.sources || {},
    // 当前正在浏览的 track
    currentKey: ''
  }),
  getters: {
    hasLyric() {
      return this.currentLyric && this.currentLyric.lyrics && this.currentLyric.lyrics.length > 0
    },
    currentLyricText() {
      if (!this.hasLyric || this.currentLineIndex < 0) return ''
      return this.currentLyric.lyrics[this.currentLineIndex]?.text || ''
    },
    lyricSourceLabel() {
      const labels = { netease: '网易云', manual: '手动选择' }
      return labels[this.lyricSource] || ''
    },
    currentOffset() {
      if (!this.currentKey) return 0
      return this.lyricOffsets[this.currentKey] || 0
    },
    isManualSource() {
      return this.lyricSource === 'manual'
    }
  },
  actions: {
    /**
     * 启动时调用：从主存储拉取最新的 cache/offsets/sources（缺失时回退 localStorage 老 3 key 并自动迁移）。
     */
    async load() {
      const data = await storage.load(null)
      if (data && typeof data === 'object') {
        if (data.cache && typeof data.cache === 'object') this.lyricCache = data.cache
        if (data.offsets && typeof data.offsets === 'object') this.lyricOffsets = data.offsets
        if (data.sources && typeof data.sources === 'object') this.lyricSources = data.sources
      }
    },

    setCurrentLyric(lyric) {
      this.currentLyric = lyric
      this.currentLineIndex = -1
      this.lyricError = ''
      this.lyricSource = ''
    },
    setLoadedHash(hash) { this.loadedHash = hash },
    setCurrentLineIndex(index) { this.currentLineIndex = index },
    setIsLyricLoading(loading) { this.isLyricLoading = loading },
    setLyricError(error) { this.lyricError = error },
    toggleLyricPanel() { this.showLyricPanel = !this.showLyricPanel },
    setShowLyricPanel(show) { this.showLyricPanel = show },

    // —— per-track offset ——
    setLyricOffset(offset) {
      if (!this.currentKey) {
        console.warn('[lyricStore] setLyricOffset: currentKey 为空')
        return
      }
      this.lyricOffsets[this.currentKey] = offset
      this.persist()
    },
    adjustLyricOffset(delta) {
      if (!this.currentKey) {
        console.warn('[lyricStore] adjustLyricOffset: currentKey 为空')
        return
      }
      const next = (this.lyricOffsets[this.currentKey] || 0) + delta
      this.lyricOffsets[this.currentKey] = next
      this.persist()
    },
    resetLyricOffset() { this.setLyricOffset(0) },

    // —— per-track source ——
    setLyricSource(source) {
      this.lyricSource = source
      if (this.currentKey) {
        this.lyricSources[this.currentKey] = source
        this.persist()
      }
    },

    // —— cache key ——
    getCacheKey(bvid, cid, title = '', artist = '') {
      const safeTitle = String(title || '').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 40)
      const safeArtist = String(artist || '').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 20)
      return `${bvid}-${cid}-${safeArtist}-${safeTitle}`
    },
    getCachedLyric(bvid, cid, title, artist) {
      const key = this.getCacheKey(bvid, cid, title, artist)
      const cached = this.lyricCache[key]
      if (cached && cached.timestamp && Date.now() - cached.timestamp < 7 * 24 * 60 * 60 * 1000) {
        const data = cached.data
        // _lyricV3 缺失 = 旧解析器产物（romaji/translation 缺失），视为过期
        if (data && typeof data === 'object' && !Array.isArray(data) && 'lyrics' in data && data._lyricV3) {
          return data
        }
        return null
      }
      return null
    },
    cacheLyric(bvid, cid, title, artist, lyric, source = '') {
      const key = this.getCacheKey(bvid, cid, title, artist)
      this.lyricCache[key] = { data: lyric, timestamp: Date.now(), source }
      this.cleanupCache()
      if (source) this.lyricSources[key] = source
      this.persist()
    },
    cleanupCache() {
      const keys = Object.keys(this.lyricCache)
      if (keys.length > 1000) {
        const sorted = keys.sort((a, b) => (this.lyricCache[b].timestamp - this.lyricCache[a].timestamp))
        const toRemove = sorted.slice(1000)
        toRemove.forEach(key => delete this.lyricCache[key])
      }
    },

    /**
     * 统一持久化：把 cache / offsets / sources 三件套作为一份 JSON 原子写。
     * 不再额外写 localStorage 老 3 key —— 主存 + createPersistentStorage 的 localStorage 双写已足够。
     * 老的 FALLBACK_* key 只在 peekLyrics() 第一次启动时读一次（用于历史数据兜底），之后无人再写。
     */
    async persist() {
      const payload = {
        cache: this.lyricCache,
        offsets: this.lyricOffsets,
        sources: this.lyricSources
      }
      // 主存储：1 个原子写覆盖全部
      await storage.save(payload)
    },

    /** 兼容老 API 同步签名 */
    persistSync() { this.persist().catch(e => console.warn('[lyricStore] persist failed:', e.message)) },
    saveCache() { this.persistSync() },
    saveOffsets() { this.persistSync() },
    saveSources() { this.persistSync() },

    async loadCache() {
      // 兼容老 API
      await this.load()
    },

    clearLyricCache() {
      this.lyricCache = {}
      this.lyricOffsets = {}
      this.lyricSources = {}
      this.persist()
    },

    async resetManualLyric() {
      const key = this.currentKey
      if (!key) return { success: false, error: 'no currentKey' }
      if (this.lyricCache[key]) this.lyricCache[key].source = 'auto'
      delete this.lyricSources[key]
      this.persist()
      this.lyricSource = ''
      return { success: true }
    },

    async loadLyricForTrack(track) {
      this.setCurrentLyric(null)
      this.setLoadedHash('')
      this.lyricError = ''
      const bvid = track.bvid
      const cid = track.cid || 1
      const title = track.title || ''
      const artist = track.author || ''
      this.currentKey = this.getCacheKey(bvid, cid, title, artist)
      return await this.fetchLyric(bvid, cid, title, artist)
    },

    async fetchLyric(bvid, cid, title, artist) {
      const cacheKey = this.getCacheKey(bvid, cid, title, artist)
      const cached = this.getCachedLyric(bvid, cid, title, artist)
      if (cached) {
        this.setCurrentLyric(cached)
        this.setLoadedHash(cacheKey)
        const source = this.lyricSources[cacheKey] || cached.source || 'auto'
        this.lyricSource = source === 'manual' ? 'manual' : 'auto'
        return { success: true, fromCache: true }
      }
      this.setIsLyricLoading(true)
      try {
        const result = await window.electronAPI.getLyric({ bvid, cid, title, artist })
        if (result?.code === 0 && result.data) {
          const lyric = this.parseLyric(result.data)
          this.setCurrentLyric(lyric)
          this.setLyricSource('netease')
          this.setLoadedHash(cacheKey)
          this.cacheLyric(bvid, cid, title, artist, lyric, 'netease')
          return { success: true, fromCache: false }
        } else {
          this.setLyricError(result?.message || '获取歌词失败')
          return { success: false, error: result?.message }
        }
      } catch (error) {
        this.setLyricError(error.message || '网络错误')
        return { success: false, error: error.message }
      } finally {
        this.setIsLyricLoading(false)
      }
    },

    async searchLyric(keyword) {
      try {
        const result = await window.electronAPI.searchLyric(keyword)
        if (result?.code === 0 && result.data) {
          return { success: true, data: result.data }
        }
        return { success: false, error: result?.message }
      } catch (error) {
        return { success: false, error: error.message }
      }
    },

    parseLyric(rawLyric, options = {}) {
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
          const diff = Math.abs(key - target)
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
    },

    updateCurrentLine(currentTime) {
      if (!this.hasLyric) { this.currentLineIndex = -1; return }
      const offset = this.currentOffset
      const adjustedTime = currentTime * 1000 + offset
      const lyrics = this.currentLyric.lyrics
      let index = -1
      for (let i = lyrics.length - 1; i >= 0; i--) {
        if (lyrics[i].time <= adjustedTime + 500) { index = i; break }
      }
      this.currentLineIndex = index
    }
  }
})
