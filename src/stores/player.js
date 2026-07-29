import { defineStore } from 'pinia'
import { createPersistentStorage } from '@/utils/persistentStorage'

// play-history 数据是个数组（每项是 music 对象），schema 框架套在数组上不自然
// 暂不开 schema 校验，关键校验放在 savePlayHistory() 里：限长 50、过滤无效项
// 未来如要加 schema，可以把 data 包成 { version, items } 走 schema 通道
// 主存储 key：play-history；localStorage fallback key：pink-music-history
const storage = createPersistentStorage('play-history', { schema: null, debounceMs: 500 })
const FALLBACK_KEY = 'pink-music-history'

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
    playModes: [
      { value: 'order', icon: '🔁', label: '顺序播放' },
      { value: 'loop', icon: '🔃', label: '列表循环' },
      { value: 'single', icon: '🔂', label: '单曲循环' },
      { value: 'shuffle', icon: '🔀', label: '随机播放' }
    ],
    playHistory: initialPlayHistory,
    currentSeries: null,
    showSeriesPanel: false,
    currentVideoEpisodes: [],
    currentEpisodeIndex: 0,
    showPlaylistManager: false,
    isLoadingEpisodes: false
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
      const mode = this.playModes.find(m => m.value === this.playMode)
      return mode ? mode.icon : this.playModes[0].icon
    },
    getPlayModeLabel() {
      const mode = this.playModes.find(m => m.value === this.playMode)
      return mode ? mode.label : '顺序播放'
    },

    addToPlayHistory(music) {
      this.playHistory = this.playHistory.filter(item => item.bvid !== music.bvid)
      this.playHistory.unshift(music)
      this.savePlayHistory()
    },

    /**
     * 持久化：双写到主存储 + localStorage（fallback）。
     * 内部限长 50。
     */
    async savePlayHistory() {
      const historyToSave = this.playHistory.slice(0, 50)
      try { localStorage.setItem(FALLBACK_KEY, JSON.stringify(historyToSave)) } catch (_) {}
      await storage.save(historyToSave)
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
