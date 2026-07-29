import { defineStore } from 'pinia'
import { setTargetState as applyEQToEngine, EQ_PRESETS } from '@/utils/audioEQ'
import { createPersistentStorage } from '@/utils/persistentStorage'
import { s, defineSchema } from '@/utils/schema'

// localStorage key：与项目其他 pink-music-* 命名风格保持一致（仅作 fallback）
const VIS_KEY = 'pink-music-audio-visualizer-enabled'
const VIS_INTENSITY_KEY = 'pink-music-audio-visualizer-intensity'
const EQ_ENABLED_KEY = 'pink-music-audio-eq-enabled'
const EQ_BANDS_KEY = 'pink-music-audio-eq-bands'
const EQ_PRESET_KEY = 'pink-music-audio-eq-preset'
const QUALITY_KEY = 'pink-music-audio-quality'
const WIN_CTRL_KEY = 'pink-music-window-controls-enabled'

const EQ_FLAT_BANDS = new Array(10).fill(0)

// ───────── Schema ─────────
// v2 在 2.5.0 之后：新增 windowControlsEnabled
// v1 → v2 不需要数据迁移，只是给老数据补一个默认值
const settingsSchema = defineSchema({
  version: 2,
  fields: {
    audioQuality: s.enum(['auto', '64', '128', '192', '320', 'flac'], 'auto'),
    audioVisualizerEnabled: s.boolean(true),
    audioVisualizerIntensity: s.number(0, 1, 0.6),
    eqEnabled: s.boolean(true),
    eqBands: s.array(s.number(-12, 12, 0), 10),
    eqPreset: s.string('flat'),
    windowControlsEnabled: s.boolean(true)
  },
  migrations: {
    2: (data) => ({ ...data, windowControlsEnabled: data.windowControlsEnabled ?? true })
  }
})

// 主存储 key：settings
const storage = createPersistentStorage('settings', { schema: settingsSchema, debounceMs: 300 })

function readLocalEnabled() {
  const raw = localStorage.getItem(VIS_KEY)
  if (raw === null) return true
  return raw === 'true'
}
function readLocalIntensity() {
  const raw = localStorage.getItem(VIS_INTENSITY_KEY)
  if (raw === null) return 0.6
  const v = parseFloat(raw)
  if (Number.isNaN(v)) return 0.6
  return Math.max(0, Math.min(1, v))
}
function readLocalEQEnabled() {
  const raw = localStorage.getItem(EQ_ENABLED_KEY)
  if (raw === null) return true
  return raw === 'true'
}
function readLocalEQBands() {
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
function readLocalEQPreset() {
  return localStorage.getItem(EQ_PRESET_KEY) || 'flat'
}
function readLocalWindowControlsEnabled() {
  const raw = localStorage.getItem(WIN_CTRL_KEY)
  if (raw === null) return true
  return raw === 'true'
}

// 同步初值（localStorage peek，避免首屏闪）
const peeked = storage.peek(null)
const initialAudioVisualizerEnabled = peeked?.audioVisualizerEnabled ?? readLocalEnabled()
const initialAudioVisualizerIntensity = peeked?.audioVisualizerIntensity ?? readLocalIntensity()
const initialEqEnabled = peeked?.eqEnabled ?? readLocalEQEnabled()
const initialEqBands = peeked?.eqBands ?? readLocalEQBands()
const initialEqPreset = peeked?.eqPreset ?? readLocalEQPreset()
const initialAudioQuality = peeked?.audioQuality ?? localStorage.getItem(QUALITY_KEY) ?? 'auto'
const initialWindowControlsEnabled = peeked?.windowControlsEnabled ?? readLocalWindowControlsEnabled()

// 启动期同步：把 EQ pending 状态先灌进 audioEQ，attachAudioAnalyser 时 initEQ 会自动应用
applyEQToEngine(initialEqEnabled, initialEqBands)

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    showSettings: false,
    activeSettingsTab: 'general',
    downloadDirectory: '',
    cacheSize: 0,
    audioQuality: initialAudioQuality,
    audioVisualizerEnabled: initialAudioVisualizerEnabled,
    audioVisualizerIntensity: initialAudioVisualizerIntensity,
    eqEnabled: initialEqEnabled,
    eqBands: initialEqBands,
    eqPreset: initialEqPreset,
    windowControlsEnabled: initialWindowControlsEnabled
  }),
  actions: {
    /**
     * 应用启动时调用一次：从主存储读最新值并覆盖 state，
     * 同时触发一次 EQ 引擎同步（保险）。
     */
    async load() {
      const data = await storage.load(null)
      if (data) {
        if (typeof data.audioVisualizerEnabled === 'boolean') this.audioVisualizerEnabled = data.audioVisualizerEnabled
        if (typeof data.audioVisualizerIntensity === 'number') this.audioVisualizerIntensity = data.audioVisualizerIntensity
        if (typeof data.eqEnabled === 'boolean') this.eqEnabled = data.eqEnabled
        if (Array.isArray(data.eqBands) && data.eqBands.length === 10) this.eqBands = data.eqBands.map(v => Number(v) || 0)
        if (typeof data.eqPreset === 'string') this.eqPreset = data.eqPreset
        if (typeof data.audioQuality === 'string') this.audioQuality = data.audioQuality
        if (typeof data.windowControlsEnabled === 'boolean') this.windowControlsEnabled = data.windowControlsEnabled
        applyEQToEngine(this.eqEnabled, this.eqBands)
      }
    },

    setShowSettings(show) { this.showSettings = show },
    setActiveSettingsTab(tab) { this.activeSettingsTab = tab },
    setDownloadDirectory(dir) { this.downloadDirectory = dir },
    setCacheSize(size) { this.cacheSize = size },

    setAudioQuality(quality) {
      this.audioQuality = quality
      try { localStorage.setItem(QUALITY_KEY, quality) } catch (_) {}
      this.persist()
    },
    setAudioVisualizerEnabled(enabled) {
      this.audioVisualizerEnabled = !!enabled
      try { localStorage.setItem(VIS_KEY, this.audioVisualizerEnabled ? 'true' : 'false') } catch (_) {}
      this.persist()
    },
    setAudioVisualizerIntensity(value) {
      const v = Math.max(0, Math.min(1, Number(value) || 0))
      this.audioVisualizerIntensity = v
      try { localStorage.setItem(VIS_INTENSITY_KEY, String(v)) } catch (_) {}
      this.persist()
    },
    setWindowControlsEnabled(enabled) {
      this.windowControlsEnabled = !!enabled
      try { localStorage.setItem(WIN_CTRL_KEY, this.windowControlsEnabled ? 'true' : 'false') } catch (_) {}
      this.persist()
    },
    setEQEnabled(enabled) {
      this.eqEnabled = !!enabled
      try { localStorage.setItem(EQ_ENABLED_KEY, this.eqEnabled ? 'true' : 'false') } catch (_) {}
      applyEQToEngine(this.eqEnabled, this.eqBands)
      this.persist()
    },
    setEQBandGain(index, value) {
      const i = Math.max(0, Math.min(9, Number(index) || 0))
      const v = Math.max(-12, Math.min(12, Number(value) || 0))
      const next = this.eqBands.slice()
      next[i] = v
      this.eqBands = next
      try { localStorage.setItem(EQ_BANDS_KEY, JSON.stringify(next)) } catch (_) {}
      applyEQToEngine(this.eqEnabled, this.eqBands)
      this.persist()
    },
    applyEQPreset(presetKey) {
      const bands = EQ_PRESETS[presetKey]
      if (!bands) return
      this.eqPreset = presetKey
      this.eqBands = bands.slice()
      try { localStorage.setItem(EQ_PRESET_KEY, presetKey) } catch (_) {}
      try { localStorage.setItem(EQ_BANDS_KEY, JSON.stringify(bands)) } catch (_) {}
      applyEQToEngine(this.eqEnabled, this.eqBands)
      this.persist()
    },
    commitEQBands(bands) {
      if (!Array.isArray(bands) || bands.length !== 10) return
      const next = bands.map(v => {
        const n = Number(v)
        if (Number.isNaN(n)) return 0
        return Math.max(-12, Math.min(12, n))
      })
      this.eqBands = next
      try { localStorage.setItem(EQ_BANDS_KEY, JSON.stringify(next)) } catch (_) {}
      applyEQToEngine(this.eqEnabled, this.eqBands)
      this.persist()
    },
    resetEQ() {
      this.eqEnabled = true
      this.eqPreset = 'flat'
      this.eqBands = EQ_FLAT_BANDS.slice()
      try { localStorage.setItem(EQ_ENABLED_KEY, 'true') } catch (_) {}
      try { localStorage.setItem(EQ_PRESET_KEY, 'flat') } catch (_) {}
      try { localStorage.setItem(EQ_BANDS_KEY, JSON.stringify(EQ_FLAT_BANDS)) } catch (_) {}
      applyEQToEngine(true, this.eqBands)
      this.persist()
    },

    /** 内部：把当前关键 state 写入主存储（双写） */
    async persist() {
      await storage.save({
        audioQuality: this.audioQuality,
        audioVisualizerEnabled: this.audioVisualizerEnabled,
        audioVisualizerIntensity: this.audioVisualizerIntensity,
        eqEnabled: this.eqEnabled,
        eqBands: this.eqBands,
        eqPreset: this.eqPreset,
        windowControlsEnabled: this.windowControlsEnabled
      })
    },

    async loadDownloadDirectory() {
      if (window.electronAPI) {
        const result = await window.electronAPI.getDownloadDirectory()
        if (result?.code === 0) this.downloadDirectory = result.path
      }
    },
    async selectDownloadDirectory() {
      if (window.electronAPI) {
        const result = await window.electronAPI.selectDownloadDirectory()
        if (result?.code === 0) this.downloadDirectory = result.path
      }
    },
    async loadCacheSize() {
      if (window.electronAPI) {
        const result = await window.electronAPI.getCacheSize()
        if (result?.code === 0) this.cacheSize = result.size
      }
    },
    async clearCache() {
      if (window.electronAPI) {
        const result = await window.electronAPI.clearCache()
        if (result?.code === 0) this.cacheSize = 0
        return result
      }
    },
    async openGitHub() {
      if (window.electronAPI) await window.electronAPI.openGitHub()
    }
  }
})
