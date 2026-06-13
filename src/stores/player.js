import { defineStore } from 'pinia'

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
    playHistory: JSON.parse(localStorage.getItem('pink-music-history') || '[]'),
    currentSeries: null,
    showSeriesPanel: false,
    currentVideoEpisodes: [],
    currentEpisodeIndex: 0,
    showPlaylistManager: false,
    isLoadingEpisodes: false
  }),
  actions: {
    setCurrentTrack(track) {
      this.currentTrack = track
      if (track) {
        this.addToPlayHistory(track)
      }
    },
    setIsPlaying(playing) {
      this.isPlaying = playing
    },
    setShowPlayerPage(show) {
      this.showPlayerPage = show
    },
    setCurrentTime(time) {
      this.currentTime = time
    },
    setDuration(duration) {
      this.duration = duration
    },
    setIsAudioLoading(loading) {
      this.isAudioLoading = loading
    },
    setAudioError(error) {
      this.audioError = error
    },
    setBufferedProgress(progress) {
      this.bufferedProgress = progress
    },
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
    savePlayHistory() {
      const historyToSave = this.playHistory.slice(0, 50)
      localStorage.setItem('pink-music-history', JSON.stringify(historyToSave))
    },
    loadPlayHistory() {
      const saved = localStorage.getItem('pink-music-history')
      if (saved) {
        this.playHistory = JSON.parse(saved)
      }
    },
    clearPlayHistory() {
      this.playHistory = []
      this.savePlayHistory()
    },
    setCurrentSeries(series) {
      this.currentSeries = series
    },
    setShowSeriesPanel(show) {
      this.showSeriesPanel = show
    },
    toggleSeriesPanel() {
      this.showSeriesPanel = !this.showSeriesPanel
    },
    setCurrentVideoEpisodes(episodes) {
      this.currentVideoEpisodes = episodes
    },
    setCurrentEpisodeIndex(index) {
      this.currentEpisodeIndex = index
    },
    setShowPlaylistManager(show) {
      this.showPlaylistManager = show
    },
    togglePlaylistManager() {
      this.showPlaylistManager = !this.showPlaylistManager
    },
    setIsLoadingEpisodes(loading) {
      this.isLoadingEpisodes = loading
    },
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
