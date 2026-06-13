import { defineStore } from 'pinia'

export const useThemeStore = defineStore('theme', {
  state: () => ({
    currentTheme: localStorage.getItem('pink-music-theme') || 'dark',
    currentColor: localStorage.getItem('pink-music-color') || 'pink'
  }),
  actions: {
    setTheme(theme) {
      this.currentTheme = theme
      localStorage.setItem('pink-music-theme', theme)
      document.documentElement.setAttribute('data-theme', theme)
    },
    setColor(color) {
      this.currentColor = color
      localStorage.setItem('pink-music-color', color)
      document.documentElement.setAttribute('data-color', color)
    },
    initTheme() {
      document.documentElement.setAttribute('data-theme', this.currentTheme)
      document.documentElement.setAttribute('data-color', this.currentColor)
    }
  }
})
