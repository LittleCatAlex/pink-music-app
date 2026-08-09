import { defineStore } from 'pinia'
import { createPersistentStorage } from '@/utils/persistentStorage'
import { s, defineSchema } from '@/utils/schema'

// Schema v1：主题和颜色
// 已知 currentTheme: 'light' | 'dark' | 'apple-light' | 'apple-dark'
// 已知 currentColor: 'pink' | 'blue' | 'green' | 'orange' | 'purple'（用户可扩展，先用 string）
const themeSchema = defineSchema({
  version: 1,
  fields: {
    currentTheme: s.string('dark'),
    currentColor: s.string('pink')
  }
})

// 主存储 key：theme；localStorage 兜底：'pink-music-theme'
// 老的 'pink-music-color' key 只在 initialState 同步初值时 peek 一次（历史兜底），
// 之后无人再写 —— 让首次升级的旧用户能恢复自己选的颜色。
const storage = createPersistentStorage('theme', { schema: themeSchema, debounceMs: 0 })

// localStorage 同步初值（防首屏闪烁；主存储 load() 完成后会覆盖）
const initialTheme = storage.peek({ currentTheme: 'dark', currentColor: 'pink' })
const initialState = {
  // 兼容老数据：旧版把 theme 和 color 分两个 key 存的，peek 拿到的是单个值
  currentTheme: (typeof initialTheme === 'string')
    ? initialTheme
    : (initialTheme?.currentTheme || 'dark'),
  currentColor: (typeof initialTheme === 'object' && initialTheme?.currentColor)
    ? initialTheme.currentColor
    : (() => {
        // 历史兜底：升级前用户单独存的 'pink-music-color'，仅在 initialState 阶段读一次
        try {
          const r = localStorage.getItem('pink-music-color')
          return r ? r : 'pink'
        } catch (_) { return 'pink' }
      })()
}

export const useThemeStore = defineStore('theme', {
  state: () => initialState,
  actions: {
    /**
     * 应用启动时调用一次：从主存储读最新值并覆盖 state。
     * 第一次跑会自动从 localStorage 迁移到主存储。
     */
    async load() {
      const data = await storage.load({ currentTheme: this.currentTheme, currentColor: this.currentColor })
      this.currentTheme = data.currentTheme || 'dark'
      this.currentColor = data.currentColor || 'pink'
      this.initTheme()
    },

    setTheme(theme) {
      this.currentTheme = theme
      this.persist()
      document.documentElement.setAttribute('data-theme', theme)
    },
    setColor(color) {
      this.currentColor = color
      this.persist()
      document.documentElement.setAttribute('data-color', color)
    },
    initTheme() {
      document.documentElement.setAttribute('data-theme', this.currentTheme)
      document.documentElement.setAttribute('data-color', this.currentColor)
    },

    /** 内部：把当前 state 写入主存储 + localStorage 双写 */
    async persist() {
      await storage.save({
        currentTheme: this.currentTheme,
        currentColor: this.currentColor
      })
    }
  }
})
