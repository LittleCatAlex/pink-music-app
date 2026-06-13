import { defineStore } from 'pinia'

export const useLyricStore = defineStore('lyric', {
  state: () => {
    let cachedLyricData = {}
    let cachedOffsets = {}
    let cachedSources = {}
    try {
      const saved = localStorage.getItem('pink-music-lyric-cache')
      if (saved) cachedLyricData = JSON.parse(saved)
    } catch (e) {
      cachedLyricData = {}
    }
    try {
      const savedOffsets = localStorage.getItem('pink-music-lyric-offsets')
      if (savedOffsets) cachedOffsets = JSON.parse(savedOffsets)
    } catch (e) {
      cachedOffsets = {}
    }
    try {
      const savedSources = localStorage.getItem('pink-music-lyric-sources')
      if (savedSources) cachedSources = JSON.parse(savedSources)
    } catch (e) {
      cachedSources = {}
    }
    return {
      currentLyric: null,
      loadedHash: '',
      currentLineIndex: -1,
      isLyricLoading: false,
      lyricError: '',
      lyricSource: '',
      showLyricPanel: true,
      lyricCache: cachedLyricData,
      // 由 getCacheKey(bvid, cid, title) 索引；不再用单一标量
      lyricOffsets: cachedOffsets,
      // 记录"用户手动指定"的来源（netease cache / manual），便于重置
      lyricSources: cachedSources,
      // 当前正在浏览的 track（用于 per-track offset / source 关联）
      currentKey: ''
    }
  },
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
    // 当前 track 的偏移：未设置返回 0
    currentOffset() {
      if (!this.currentKey) return 0
      return this.lyricOffsets[this.currentKey] || 0
    },
    isManualSource() {
      return this.lyricSource === 'manual'
    }
  },
  actions: {
    setCurrentLyric(lyric) {
      this.currentLyric = lyric
      this.currentLineIndex = -1
      this.lyricError = ''
      this.lyricSource = ''
    },
    setLoadedHash(hash) {
      this.loadedHash = hash
    },
    setCurrentLineIndex(index) {
      this.currentLineIndex = index
    },
    setIsLyricLoading(loading) {
      this.isLyricLoading = loading
    },
    setLyricError(error) {
      this.lyricError = error
    },
    toggleLyricPanel() {
      this.showLyricPanel = !this.showLyricPanel
    },
    setShowLyricPanel(show) {
      this.showLyricPanel = show
    },
    // —— per-track offset ——
    setLyricOffset(offset) {
      if (!this.currentKey) {
        console.warn('[lyricStore] setLyricOffset: currentKey 为空，请检查 watch 是否在挂载时触发 loadLyricForTrack')
        return
      }
      this.lyricOffsets[this.currentKey] = offset
      this.saveOffsets()
    },
    adjustLyricOffset(delta) {
      if (!this.currentKey) {
        console.warn('[lyricStore] adjustLyricOffset: currentKey 为空，请检查 watch 是否在挂载时触发 loadLyricForTrack')
        return
      }
      const next = (this.lyricOffsets[this.currentKey] || 0) + delta
      this.lyricOffsets[this.currentKey] = next
      this.saveOffsets()
    },
    resetLyricOffset() {
      this.setLyricOffset(0)
    },
    // —— per-track source ——
    setLyricSource(source) {
      this.lyricSource = source
      if (this.currentKey) {
        this.lyricSources[this.currentKey] = source
        this.saveSources()
      }
    },
    // —— cache key ——
    // 加入 author 维度，避免同名/同 bvid 缺失的不同歌曲共用同一缓存槽。
    getCacheKey(bvid, cid, title = '', artist = '') {
      const safeTitle = String(title || '').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 40)
      const safeArtist = String(artist || '').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 20)
      return `${bvid}-${cid}-${safeArtist}-${safeTitle}`
    },
    getCachedLyric(bvid, cid, title, artist) {
      const key = this.getCacheKey(bvid, cid, title, artist)
      const cached = this.lyricCache[key]
      if (cached && cached.timestamp && Date.now() - cached.timestamp < 7 * 24 * 60 * 60 * 1000) {
        return cached.data
      }
      return null
    },
    cacheLyric(bvid, cid, title, artist, lyric, source = '') {
      const key = this.getCacheKey(bvid, cid, title, artist)
      this.lyricCache[key] = { data: lyric, timestamp: Date.now(), source }
      this.cleanupCache()
      this.saveCache()
      if (source) {
        this.lyricSources[key] = source
        this.saveSources()
      }
    },
    cleanupCache() {
      const keys = Object.keys(this.lyricCache)
      if (keys.length > 1000) {
        const sorted = keys.sort((a, b) => (this.lyricCache[b].timestamp - this.lyricCache[a].timestamp))
        const toRemove = sorted.slice(1000)
        toRemove.forEach(key => delete this.lyricCache[key])
      }
    },
    saveCache() {
      try {
        localStorage.setItem('pink-music-lyric-cache', JSON.stringify(this.lyricCache))
      } catch (e) {
        console.warn('歌词缓存写入失败', e)
      }
    },
    loadCache() {
      try {
        const saved = localStorage.getItem('pink-music-lyric-cache')
        if (saved) this.lyricCache = JSON.parse(saved)
        const o = localStorage.getItem('pink-music-lyric-offsets')
        if (o) this.lyricOffsets = JSON.parse(o)
        const s = localStorage.getItem('pink-music-lyric-sources')
        if (s) this.lyricSources = JSON.parse(s)
      } catch (e) {
        this.lyricCache = {}
        this.lyricOffsets = {}
        this.lyricSources = {}
      }
    },
    saveOffsets() {
      try {
        localStorage.setItem('pink-music-lyric-offsets', JSON.stringify(this.lyricOffsets))
      } catch (e) {
        console.warn('偏移写入失败', e)
      }
    },
    saveSources() {
      try {
        localStorage.setItem('pink-music-lyric-sources', JSON.stringify(this.lyricSources))
      } catch (e) {
        console.warn('来源写入失败', e)
      }
    },
    clearLyricCache() {
      this.lyricCache = {}
      this.lyricOffsets = {}
      this.lyricSources = {}
      this.saveCache()
      this.saveOffsets()
      this.saveSources()
    },
    // 把手动选中的歌词还原为"自动匹配"（B 站/网易云）
    async resetManualLyric() {
      const key = this.currentKey
      if (!key) {
        console.warn('[lyricStore] resetManualLyric: currentKey 为空，请检查 watch 是否在挂载时触发 loadLyricForTrack')
        return { success: false, error: 'no currentKey' }
      }
      // 清除 manual source；缓存中已写入 source 字段也覆盖为 auto
      if (this.lyricCache[key]) this.lyricCache[key].source = 'auto'
      delete this.lyricSources[key]
      this.saveSources()
      this.saveCache()
      this.lyricSource = ''
      // 实际的 track 由调用方（LyricDisplay 的 handleResetManual）持有，
      // 并通过 loadLyricForTrack 重新拉取，不在此处反向构造。
      return { success: true }
    },
    async loadLyricForTrack(track) {
      this.setCurrentLyric(null)
      this.setLoadedHash('')
      this.lyricError = ''
      // 不再 resetLyricOffset() —— 每个 track 独立保留偏移

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
        // 恢复 source（manual / auto）
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
        } else {
          return { success: false, error: result?.message }
        }
      } catch (error) {
        return { success: false, error: error.message }
      }
    },
    parseLyric(rawLyric) {
      if (!rawLyric) {
        return { lyrics: [], title: '', artist: '' }
      }

      const lyrics = []
      const lines = rawLyric.split('\n')
      let title = ''
      let artist = ''

      const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\](.+)/
      const titleRegex = /\[ti:(.+)\]/
      const artistRegex = /\[ar:(.+)\]/
      const creditRegex = /^(作词|作曲|编曲|制作人|和声编写|和声|吉他|贝斯|鼓|键盘|弦乐|录音工程|录音|混音工程|混音|母带|母带后期|母带工程|监制|OP|SP|原唱|翻唱|原曲|改编|发行|出品|封面|设计|统筹|企划)[''']?\s*[:：]/

      for (const line of lines) {
        const titleMatch = line.match(titleRegex)
        if (titleMatch) {
          title = titleMatch[1]
          continue
        }

        const artistMatch = line.match(artistRegex)
        if (artistMatch) {
          artist = artistMatch[1]
          continue
        }

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
            )) {
              continue
            }

            lyrics.push({
              time: timeMs,
              text
            })
          }
        }
      }

      lyrics.sort((a, b) => a.time - b.time)

      return { lyrics, title, artist }
    },
    updateCurrentLine(currentTime) {
      if (!this.hasLyric) {
        this.currentLineIndex = -1
        return
      }

      // 使用 per-track offset
      const offset = this.currentOffset
      const adjustedTime = currentTime * 1000 + offset
      const lyrics = this.currentLyric.lyrics
      let index = -1

      for (let i = lyrics.length - 1; i >= 0; i--) {
        if (lyrics[i].time <= adjustedTime + 500) {
          index = i
          break
        }
      }

      this.currentLineIndex = index
    }
  }
})