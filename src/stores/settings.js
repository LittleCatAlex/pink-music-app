import { defineStore } from 'pinia'

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    showSettings: false,
    activeSettingsTab: 'general',
    downloadDirectory: '',
    cacheSize: 0,
    audioQuality: localStorage.getItem('pink-music-audio-quality') || 'auto'
  }),
  actions: {
    setShowSettings(show) {
      this.showSettings = show
    },
    setActiveSettingsTab(tab) {
      this.activeSettingsTab = tab
    },
    setDownloadDirectory(dir) {
      this.downloadDirectory = dir
    },
    setCacheSize(size) {
      this.cacheSize = size
    },
    setAudioQuality(quality) {
      this.audioQuality = quality
      localStorage.setItem('pink-music-audio-quality', quality)
    },
    async loadDownloadDirectory() {
      if (window.electronAPI) {
        const result = await window.electronAPI.getDownloadDirectory()
        if (result?.code === 0) {
          this.downloadDirectory = result.data
        }
      }
    },
    async selectDownloadDirectory() {
      if (window.electronAPI) {
        const result = await window.electronAPI.selectDownloadDirectory()
        if (result?.code === 0) {
          this.downloadDirectory = result.data
        }
      }
    },
    async loadCacheSize() {
      if (window.electronAPI) {
        const result = await window.electronAPI.getCacheSize()
        if (result?.code === 0) {
          this.cacheSize = result.data
        }
      }
    },
    async clearCache() {
      if (window.electronAPI) {
        const result = await window.electronAPI.clearCache()
        if (result?.code === 0) {
          this.cacheSize = 0
        }
        return result
      }
    },
    async openGitHub() {
      if (window.electronAPI) {
        await window.electronAPI.openGitHub()
      }
    }
  }
})