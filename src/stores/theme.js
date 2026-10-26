import { defineStore } from 'pinia'
import { createPersistentStorage } from '@/utils/persistentStorage'
import { s, defineSchema } from '@/utils/schema'

// Schema v2：主题、颜色与自定义背景设置
// 已知 currentTheme: 'light' | 'dark' | 'apple-light' | 'apple-dark'
// 已知 currentColor: 'pink' | 'blue' | 'green' | 'orange' | 'purple'
const themeSchema = defineSchema({
  version: 2,
  fields: {
    currentTheme: s.string('dark'),
    currentColor: s.string('pink'),
    // 自定义背景设置
    customBgEnabled: s.boolean(false),
    customBgUrl: s.string(''),
    customBgOpacity: s.number(0, 1, 0.8),
    customBgBlur: s.number(0, 50, 0),
    customBgScale: s.number(0.5, 3, 1),
    customBgPosition: s.string('center'),
    customBgPosX: s.number(0, 100, 50),
    customBgPosY: s.number(0, 100, 50),
    customBgFit: s.string('cover'),
    customBgMaskOpacity: s.number(0, 1, 0.3)
  },
  migrations: {
    2: (data) => ({
      ...data,
      customBgEnabled: data.customBgEnabled ?? false,
      customBgUrl: data.customBgUrl ?? '',
      customBgOpacity: data.customBgOpacity ?? 0.8,
      customBgBlur: data.customBgBlur ?? 0,
      customBgScale: data.customBgScale ?? 1,
      customBgPosition: data.customBgPosition ?? 'center',
      customBgPosX: data.customBgPosX ?? 50,
      customBgPosY: data.customBgPosY ?? 50,
      customBgFit: data.customBgFit ?? 'cover',
      customBgMaskOpacity: data.customBgMaskOpacity ?? 0.3
    })
  }
})

// 主存储 key：theme；localStorage 兜底：'pink-music-theme'
const storage = createPersistentStorage('theme', { schema: themeSchema, debounceMs: 200 })

// 默认背景初始值
const defaultBgValues = {
  customBgEnabled: false,
  customBgUrl: '',
  customBgOpacity: 0.8,
  customBgBlur: 0,
  customBgScale: 1,
  customBgPosition: 'center',
  customBgPosX: 50,
  customBgPosY: 50,
  customBgFit: 'cover',
  customBgMaskOpacity: 0.3
}

// localStorage 同步初值（防首屏闪烁；主存储 load() 完成后会覆盖）
const initialTheme = storage.peek({
  currentTheme: 'dark',
  currentColor: 'pink',
  ...defaultBgValues
})

const initialState = {
  currentTheme: (typeof initialTheme === 'string')
    ? initialTheme
    : (initialTheme?.currentTheme || 'dark'),
  currentColor: (typeof initialTheme === 'object' && initialTheme?.currentColor)
    ? initialTheme.currentColor
    : (() => {
        try {
          const r = localStorage.getItem('pink-music-color')
          return r ? r : 'pink'
        } catch (_) { return 'pink' }
      })(),
  customBgEnabled: typeof initialTheme === 'object' ? (initialTheme?.customBgEnabled ?? false) : false,
  customBgUrl: typeof initialTheme === 'object' ? (initialTheme?.customBgUrl || '') : '',
  customBgOpacity: typeof initialTheme === 'object' ? (initialTheme?.customBgOpacity ?? 0.8) : 0.8,
  customBgBlur: typeof initialTheme === 'object' ? (initialTheme?.customBgBlur ?? 0) : 0,
  customBgScale: typeof initialTheme === 'object' ? (initialTheme?.customBgScale ?? 1) : 1,
  customBgPosition: typeof initialTheme === 'object' ? (initialTheme?.customBgPosition || 'center') : 'center',
  customBgPosX: typeof initialTheme === 'object' ? (initialTheme?.customBgPosX ?? 50) : 50,
  customBgPosY: typeof initialTheme === 'object' ? (initialTheme?.customBgPosY ?? 50) : 50,
  customBgFit: typeof initialTheme === 'object' ? (initialTheme?.customBgFit || 'cover') : 'cover',
  customBgMaskOpacity: typeof initialTheme === 'object' ? (initialTheme?.customBgMaskOpacity ?? 0.3) : 0.3
}

export const useThemeStore = defineStore('theme', {
  state: () => ({ ...initialState }),
  actions: {
    /**
     * 应用启动时调用一次：从主存储读最新值并覆盖 state。
     */
    async load() {
      const data = await storage.load({
        currentTheme: this.currentTheme,
        currentColor: this.currentColor,
        customBgEnabled: this.customBgEnabled,
        customBgUrl: this.customBgUrl,
        customBgOpacity: this.customBgOpacity,
        customBgBlur: this.customBgBlur,
        customBgScale: this.customBgScale,
        customBgPosition: this.customBgPosition,
        customBgPosX: this.customBgPosX,
        customBgPosY: this.customBgPosY,
        customBgFit: this.customBgFit,
        customBgMaskOpacity: this.customBgMaskOpacity
      })
      this.currentTheme = data.currentTheme || 'dark'
      this.currentColor = data.currentColor || 'pink'
      this.customBgEnabled = !!data.customBgEnabled
      this.customBgUrl = data.customBgUrl || ''
      this.customBgOpacity = data.customBgOpacity ?? 0.8
      this.customBgBlur = data.customBgBlur ?? 0
      this.customBgScale = data.customBgScale ?? 1
      this.customBgPosition = data.customBgPosition || 'center'
      this.customBgPosX = data.customBgPosX ?? 50
      this.customBgPosY = data.customBgPosY ?? 50
      this.customBgFit = data.customBgFit || 'cover'
      this.customBgMaskOpacity = data.customBgMaskOpacity ?? 0.3
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

    // 自定义背景相关操作
    setCustomBgEnabled(enabled) {
      this.customBgEnabled = !!enabled
      this.persist()
    },
    setCustomBgUrl(url) {
      this.customBgUrl = url || ''
      if (url && !this.customBgEnabled) {
        this.customBgEnabled = true
      }
      this.persist()
    },
    setCustomBgOpacity(val) {
      this.customBgOpacity = Math.max(0, Math.min(1, Number(val) ?? 0.8))
      this.persist()
    },
    setCustomBgBlur(val) {
      this.customBgBlur = Math.max(0, Math.min(50, Number(val) ?? 0))
      this.persist()
    },
    setCustomBgScale(val) {
      this.customBgScale = Math.max(0.5, Math.min(3, Number(val) ?? 1))
      this.persist()
    },
    setCustomBgFit(fit) {
      this.customBgFit = fit || 'cover'
      this.persist()
    },
    setCustomBgPosition(pos) {
      this.customBgPosition = pos || 'center'
      if (pos === 'center') {
        this.customBgPosX = 50
        this.customBgPosY = 50
      } else if (pos === 'top') {
        this.customBgPosX = 50
        this.customBgPosY = 0
      } else if (pos === 'bottom') {
        this.customBgPosX = 50
        this.customBgPosY = 100
      } else if (pos === 'left') {
        this.customBgPosX = 0
        this.customBgPosY = 50
      } else if (pos === 'right') {
        this.customBgPosX = 100
        this.customBgPosY = 50
      }
      this.persist()
    },
    setCustomBgPosX(x) {
      this.customBgPosX = Math.max(0, Math.min(100, Number(x) ?? 50))
      this.customBgPosition = 'custom'
      this.persist()
    },
    setCustomBgPosY(y) {
      this.customBgPosY = Math.max(0, Math.min(100, Number(y) ?? 50))
      this.customBgPosition = 'custom'
      this.persist()
    },
    setCustomBgMaskOpacity(val) {
      this.customBgMaskOpacity = Math.max(0, Math.min(1, Number(val) ?? 0.3))
      this.persist()
    },
    resetCustomBgParams() {
      this.customBgOpacity = 0.8
      this.customBgBlur = 0
      this.customBgScale = 1
      this.customBgPosition = 'center'
      this.customBgPosX = 50
      this.customBgPosY = 50
      this.customBgFit = 'cover'
      this.customBgMaskOpacity = 0.3
      this.persist()
    },
    clearCustomBg() {
      this.customBgEnabled = false
      this.customBgUrl = ''
      this.resetCustomBgParams()
    },

    /** 内部：把当前 state 写入主存储 + localStorage 双写 */
    async persist() {
      await storage.save({
        currentTheme: this.currentTheme,
        currentColor: this.currentColor,
        customBgEnabled: this.customBgEnabled,
        customBgUrl: this.customBgUrl,
        customBgOpacity: this.customBgOpacity,
        customBgBlur: this.customBgBlur,
        customBgScale: this.customBgScale,
        customBgPosition: this.customBgPosition,
        customBgPosX: this.customBgPosX,
        customBgPosY: this.customBgPosY,
        customBgFit: this.customBgFit,
        customBgMaskOpacity: this.customBgMaskOpacity
      })
    }
  }
})
