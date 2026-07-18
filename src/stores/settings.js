import { defineStore } from 'pinia'
import { setTargetState as applyEQToEngine, EQ_PRESETS } from '@/utils/audioEQ'

// localStorage key：与 settings 里的其他开关保持同样的命名风格
const VIS_KEY = 'pink-music-audio-visualizer-enabled'
const VIS_INTENSITY_KEY = 'pink-music-audio-visualizer-intensity'

const EQ_ENABLED_KEY = 'pink-music-audio-eq-enabled'
const EQ_BANDS_KEY = 'pink-music-audio-eq-bands'
const EQ_PRESET_KEY = 'pink-music-audio-eq-preset'

const EQ_FLAT_BANDS = new Array(10).fill(0)

function readVisualizerEnabled() {
  // 默认开启：用户首次打开就能体验
  const raw = localStorage.getItem(VIS_KEY)
  if (raw === null) return true
  return raw === 'true'
}

function readVisualizerIntensity() {
  // 0-1，默认 0.6（比较激进的默认值）
  const raw = localStorage.getItem(VIS_INTENSITY_KEY)
  if (raw === null) return 0.6
  const v = parseFloat(raw)
  if (Number.isNaN(v)) return 0.6
  return Math.max(0, Math.min(1, v))
}

function readEQEnabled() {
  // 默认开启：让用户首次打开就能玩
  const raw = localStorage.getItem(EQ_ENABLED_KEY)
  if (raw === null) return true
  return raw === 'true'
}

function readEQBands() {
  const raw = localStorage.getItem(EQ_BANDS_KEY)
  if (!raw) return EQ_FLAT_BANDS.slice()
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.length === 10) {
      return parsed.map(v => {
        const n = Number(v)
        if (Number.isNaN(n)) return 0
        return Math.max(-12, Math.min(12, n))
      })
    }
  } catch (_) {}
  return EQ_FLAT_BANDS.slice()
}

function readEQPreset() {
  return localStorage.getItem(EQ_PRESET_KEY) || 'flat'
}

// 在 store 创建前把 localStorage 里的值灌进 audioEQ 的 pending 状态，
// 首次 attachAudioAnalyser 时 initEQ 会自动应用，避免"切歌才生效"。
const initialEQEnabled = readEQEnabled()
const initialEQBands = readEQBands()
applyEQToEngine(initialEQEnabled, initialEQBands)

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    showSettings: false,
    activeSettingsTab: 'general',
    downloadDirectory: '',
    cacheSize: 0,
    audioQuality: localStorage.getItem('pink-music-audio-quality') || 'auto',
    audioVisualizerEnabled: readVisualizerEnabled(),
    // 0-1：0 极保守（极少环 + 极小模糊），1 极激进（环密 + 模糊强）
    audioVisualizerIntensity: readVisualizerIntensity(),
    // 音频均衡器
    eqEnabled: initialEQEnabled,
    eqBands: initialEQBands,
    eqPreset: readEQPreset()
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
    setAudioVisualizerEnabled(enabled) {
      this.audioVisualizerEnabled = !!enabled
      localStorage.setItem(VIS_KEY, this.audioVisualizerEnabled ? 'true' : 'false')
    },
    setAudioVisualizerIntensity(value) {
      const v = Math.max(0, Math.min(1, Number(value) || 0))
      this.audioVisualizerIntensity = v
      localStorage.setItem(VIS_INTENSITY_KEY, String(v))
    },
    /**
     * 启用/禁用 EQ：禁用时所有 band 强制 0dB（peaking 在 0dB 透明）
     */
    setEQEnabled(enabled) {
      this.eqEnabled = !!enabled
      localStorage.setItem(EQ_ENABLED_KEY, this.eqEnabled ? 'true' : 'false')
      applyEQToEngine(this.eqEnabled, this.eqBands)
    },
    /**
     * 设置单段增益（dB），index 0-9
     */
    setEQBandGain(index, value) {
      const i = Math.max(0, Math.min(9, Number(index) || 0))
      const v = Math.max(-12, Math.min(12, Number(value) || 0))
      // 数组整体替换以保证 Pinia 响应式
      const next = this.eqBands.slice()
      next[i] = v
      this.eqBands = next
      localStorage.setItem(EQ_BANDS_KEY, JSON.stringify(next))
      applyEQToEngine(this.eqEnabled, this.eqBands)
    },
    /**
     * 应用预置曲线（dB 数组），同时记录预置名以便 UI 高亮
     */
    applyEQPreset(presetKey) {
      const bands = EQ_PRESETS[presetKey]
      if (!bands) return
      this.eqPreset = presetKey
      this.eqBands = bands.slice()
      localStorage.setItem(EQ_PRESET_KEY, presetKey)
      localStorage.setItem(EQ_BANDS_KEY, JSON.stringify(bands))
      applyEQToEngine(this.eqEnabled, this.eqBands)
    },
    /**
     * 一次性提交 10 段增益（draft 模式下的"应用"按钮调用）
     * - 一次 localStorage 写入 + 一次 audio engine apply
     * - 不改变 eqPreset（用户基于预置微调时，预置名应保留）
     */
    commitEQBands(bands) {
      if (!Array.isArray(bands) || bands.length !== 10) return
      const next = bands.map(v => {
        const n = Number(v)
        if (Number.isNaN(n)) return 0
        return Math.max(-12, Math.min(12, n))
      })
      this.eqBands = next
      localStorage.setItem(EQ_BANDS_KEY, JSON.stringify(next))
      applyEQToEngine(this.eqEnabled, this.eqBands)
    },
    /**
     * 重置 EQ 到默认（启用 + 全 0dB + flat 预置）
     */
    resetEQ() {
      this.eqEnabled = true
      this.eqPreset = 'flat'
      this.eqBands = EQ_FLAT_BANDS.slice()
      localStorage.setItem(EQ_ENABLED_KEY, 'true')
      localStorage.setItem(EQ_PRESET_KEY, 'flat')
      localStorage.setItem(EQ_BANDS_KEY, JSON.stringify(EQ_FLAT_BANDS))
      applyEQToEngine(true, this.eqBands)
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