import { defineStore } from 'pinia'
import { createPersistentStorage } from '@/utils/persistentStorage'

// play-history 数据是个数组（每项是 music 对象），schema 框架套在数组上不自然
// 暂不开 schema 校验，关键校验放在 savePlayHistory() 里：限长 50、过滤无效项
// 未来如要加 schema，可以把 data 包成 { version, items } 走 schema 通道
// 主存储 key：play-history；localStorage fallback key：pink-music-history
const storage = createPersistentStorage('play-history', { schema: null, debounceMs: 0 })
const FALLBACK_KEY = 'pink-music-history'

// save 串行链：确保并发 savePlayHistory() 调用有序执行且读取最新 state
let _saveChain = Promise.resolve()

// 同步初值（localStorage peek，避免首屏历史为空）
const peeked = storage.peek(null)
const initialPlayHistory = Array.isArray(peeked)
  ? peeked
  : (() => {
      try {
        const raw = localStorage.getItem(FALLBACK_KEY)
        return raw ? JSON.parse(raw) : []
      } catch (_) { return [] }
    })()

export const usePlayerStore = defineStore('player', {
  state: () => ({
    currentTrack: null,
    isPlaying: false,
    showPlayerPage: false,
    currentTime: 0,
    duration: 0,
    isAudioLoading: false,
    audioError: '',
    bufferedProgress: 0,
    playMode: 'order', // order, loop, single, shuffle
    playHistory: initialPlayHistory,
    currentSeries: null,
    showSeriesPanel: false,
    currentVideoEpisodes: [],
    currentEpisodeIndex: 0,
    showPlaylistManager: false,
    isLoadingEpisodes: false,
    // 内部：playHistory 的 debounce 定时器（非反应性，不参与持久化）
    _historySaveTimer: null,
    _historySavePending: false
  }),
  actions: {
    /**
     * 启动时调用：从主存储拉取最新 playHistory（缺失则从 localStorage 迁移）。
     */
    async load() {
      const data = await storage.load(null)
      if (Array.isArray(data)) this.playHistory = data
    },

    setCurrentTrack(track) {
      this.currentTrack = track
      if (track) this.addToPlayHistory(track)
    },
    setIsPlaying(playing) { this.isPlaying = playing },
    setShowPlayerPage(show) { this.showPlayerPage = show },
    setCurrentTime(time) { this.currentTime = time },
    setDuration(duration) { this.duration = duration },
    setIsAudioLoading(loading) { this.isAudioLoading = loading },
    setAudioError(error) { this.audioError = error },
    setBufferedProgress(progress) { this.bufferedProgress = progress },

    togglePlayMode() {
      const modes = ['order', 'loop', 'single', 'shuffle']
      const currentIndex = modes.indexOf(this.playMode)
      this.playMode = modes[(currentIndex + 1) % modes.length]
    },
    getPlayModeIcon() {
      const modes = ['order', 'loop', 'single', 'shuffle']
      const idx = modes.indexOf(this.playMode)
      return modes[idx === -1 ? 0 : idx] === 'order' ? '🔁'
        : modes[idx] === 'loop' ? '🔃'
        : modes[idx] === 'single' ? '🔂'
        : '🔀'
    },
    getPlayModeLabel() {
      const modes = ['order', 'loop', 'single', 'shuffle']
      const idx = modes.indexOf(this.playMode)
      return modes[idx === -1 ? 0 : idx] === 'order' ? '顺序播放'
        : modes[idx] === 'loop' ? '列表循环'
        : modes[idx] === 'single' ? '单曲循环'
        : '随机播放'
    },

    addToPlayHistory(music) {
      this.playHistory = this.playHistory.filter(item => item.bvid !== music.bvid)
      this.playHistory.unshift(music)
      this.debouncedSavePlayHistory()
    },

    /**
     * 节流版 savePlayHistory：1s 内多次 addToPlayHistory 合并为一次写盘。
     * 切歌频繁时大幅减少主进程 fs.writeFileSync 与 IPC 次数。
     * 关窗 flush 通过 flushPendingHistorySave() 强制立即写。
     */
    debouncedSavePlayHistory(delayMs = 1000) {
      if (this._historySaveTimer) clearTimeout(this._historySaveTimer)
      this._historySavePending = true
      this._historySaveTimer = setTimeout(() => {
        this._historySaveTimer = null
        this._historySavePending = false
        this.savePlayHistory().catch(e => {
          console.warn('[playerStore] debounced save failed:', e.message)
        })
      }, delayMs)
    },

    /**
     * 强制 flush pending 的 playHistory 写。关窗 flush 时调用，
     * 确保 debounce 窗口内的最后一次切歌不丢。
     */
    async flushPendingHistorySave() {
      if (this._historySaveTimer) {
        clearTimeout(this._historySaveTimer)
        this._historySaveTimer = null
        this._historySavePending = false
        try { await this.savePlayHistory() } catch (e) {
          console.warn('[playerStore] flush pending history failed:', e.message)
        }
      }
    },

    /**
     * 持久化：双写到主存储 + localStorage（由 createPersistentStorage 自动处理）。
     * 内部限长 50。
     * 老的 FALLBACK_KEY（pink-music-history）只在 initialPlayHistory 同步初值时读一次（历史兜底），之后无人再写。
     * 串行链保证并发调用时最后一个执行者始终拿到最新 state。
     */
    async savePlayHistory() {
      _saveChain = _saveChain.then(async () => {
        const historyToSave = this.playHistory.slice(0, 50)
        await storage.save(historyToSave)
      })
      return _saveChain
    },

    /** 兼容老 API 同步签名（fire-and-forget） */
    savePlayHistorySync() {
      this.savePlayHistory().catch(e => console.warn('[playerStore] savePlayHistory failed:', e.message))
    },

    async loadPlayHistory() {
      // 兼容老 API，等价于 load()
      await this.load()
    },

    clearPlayHistory() {
      this.playHistory = []
      // 清空是显式操作，立即写一次（用户预期"清空 = 立刻生效"）
      if (this._historySaveTimer) {
        clearTimeout(this._historySaveTimer)
        this._historySaveTimer = null
        this._historySavePending = false
      }
      this.savePlayHistory()
    },

    setCurrentSeries(series) { this.currentSeries = series },
    setShowSeriesPanel(show) { this.showSeriesPanel = show },
    toggleSeriesPanel() { this.showSeriesPanel = !this.showSeriesPanel },
    setCurrentVideoEpisodes(episodes) { this.currentVideoEpisodes = episodes },
    setCurrentEpisodeIndex(index) { this.currentEpisodeIndex = index },
    setShowPlaylistManager(show) { this.showPlaylistManager = show },
    togglePlaylistManager() { this.showPlaylistManager = !this.showPlaylistManager },
    setIsLoadingEpisodes(loading) { this.isLoadingEpisodes = loading },

    async loadVideoEpisodes(bvid) {
      this.setIsLoadingEpisodes(true)
      try {
        const response = await window.electronAPI.getVideoEpisodes(bvid)
        if (response.code === 0 && response.data) {
          this.setCurrentVideoEpisodes(response.data)
          if (this.currentTrack?.cid) {
            const currentIndex = this.currentVideoEpisodes.findIndex(episode => episode.cid === this.currentTrack.cid)
            this.setCurrentEpisodeIndex(currentIndex >= 0 ? currentIndex : 0)
          } else {
            this.setCurrentEpisodeIndex(0)
          }
        } else {
          this.setCurrentVideoEpisodes([])
          this.setCurrentEpisodeIndex(0)
        }
      } catch (error) {
        console.error('获取分P列表失败:', error)
        this.setCurrentVideoEpisodes([])
        this.setCurrentEpisodeIndex(0)
      } finally {
        this.setIsLoadingEpisodes(false)
      }
    }
  }
})
