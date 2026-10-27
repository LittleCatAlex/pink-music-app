import { defineStore } from 'pinia'
import { setTargetState as applyEQToEngine, EQ_PRESETS } from '@/utils/audioEQ'
import { createPersistentStorage } from '@/utils/persistentStorage'
import { s, defineSchema } from '@/utils/schema'

const EQ_FLAT_BANDS = new Array(10).fill(0)

// persist 串行链：确保并发 persist() 调用有序执行且读取最新 state
let _persistChain = Promise.resolve()

// ───────── Schema ─────────
// Schema v7：新增桌面歌词全局快捷键 desktopLyricsHotkey
// （默认值与 electron/main.js 的 DESKTOP_LYRICS_HOTKEY_DEFAULT 互指，改动需两处同步）
// Schema v8：新增首次启动引导完成标记 onboardingCompleted
// Schema v9：新增启动时自动检查更新开关 checkUpdateOnStartup
// Schema v10：新增本地音乐库相关开关 localIncludeUnplayable / localCheckMissingOnStartup
// Schema v11：新增本地封面自动匹配开关 localAutoFetchCover
// Schema v12：新增默认歌词源偏好 lyricPreferredSource（默认酷狗；老数据缺失时迁移补默认值）
// Schema v13：新增桌面歌词高对比模式开关 desktopLyricsHighContrast
const settingsSchema = defineSchema({
  version: 14,
  fields: {
    audioQuality: s.enum(['auto', 'lossless', 'high', 'medium', 'low'], 'auto'),
    // 首次启动默认关闭：可视化较吃性能，需要时在引导页或「我的 → 设置」里开启
    audioVisualizerEnabled: s.boolean(false),
    audioVisualizerIntensity: s.number(0, 1, 0.6),
    eqEnabled: s.boolean(true),
    eqBands: s.array(s.number(-12, 12, 0), 10),
    eqPreset: s.string('flat'),
    windowControlsEnabled: s.boolean(true),
    lyricDisplayMode: s.enum(['original', 'romaji', 'translation'], 'original'),
    // 默认歌词源：语义是「优先使用」，取词失败时主进程自动回退到另一个源（electron/lyricSourceOrder.js）
    lyricPreferredSource: s.enum(['bilibili', 'kugou', 'netease'], 'bilibili'),
    desktopLyricsLocked: s.boolean(false),
    desktopLyricsHotkey: s.string('CommandOrControl+D'),
    // 高对比：浅色壁纸/浅色主题下歌词窗改用白字描边，避免歌词发虚
    desktopLyricsHighContrast: s.boolean(false),
    onboardingCompleted: s.boolean(false),
    checkUpdateOnStartup: s.boolean(true),
    // 本地音乐库
    localIncludeUnplayable: s.boolean(true),
    localCheckMissingOnStartup: s.boolean(true),
    localAutoFetchCover: s.boolean(false)
  },
  migrations: {
    2: (data) => ({ ...data, windowControlsEnabled: data.windowControlsEnabled ?? true }),
    3: (data) => ({ ...data, lyricDisplayMode: data.lyricDisplayMode ?? 'original' }),
    // v4 → v5（历史）：desktopLyrics 对象（已被 v6 移除）
    4: (data) => ({ ...data, desktopLyrics: data.desktopLyrics ?? { fontSize: 30, colorIndex: 0, lineMode: 'single', locked: false } }),
    // v5 → v6：从旧对象里只提取 locked，其余字段丢弃
    5: (data) => {
      const { desktopLyrics, ...rest } = data
      return { ...rest, desktopLyricsLocked: !!desktopLyrics?.locked }
    },
    // v6 → v7：补桌面歌词全局快捷键默认值
    6: (data) => ({ ...data, desktopLyricsHotkey: data.desktopLyricsHotkey ?? 'CommandOrControl+D' }),
    // v7 → v8：补首次启动引导完成标记默认值
    7: (data) => ({ ...data, onboardingCompleted: data.onboardingCompleted ?? false }),
    // v8 → v9：补启动时自动检查更新开关默认值
    8: (data) => ({ ...data, checkUpdateOnStartup: data.checkUpdateOnStartup ?? true }),
    // v9 → v10：补本地音乐库开关默认值
    9: (data) => ({
      ...data,
      localIncludeUnplayable: data.localIncludeUnplayable ?? true,
      localCheckMissingOnStartup: data.localCheckMissingOnStartup ?? true
    }),
    // v10 → v11：补本地封面自动匹配开关默认值（默认关闭，避免导入时大量网络请求）
    10: (data) => ({ ...data, localAutoFetchCover: data.localAutoFetchCover ?? false }),
    // v11 → v12：补默认歌词源偏好（默认酷狗；非法值同样兜底为酷狗，不留脏数据）
    11: (data) => ({
      ...data,
      lyricPreferredSource: data.lyricPreferredSource === 'netease' ? 'netease' : 'kugou'
    }),
    // v12 → v13：补桌面歌词高对比模式默认值（默认关闭，保持既有视觉）
    // 注意：loader 按 migrations[目标版本] 取迁移函数（见 utils/schema.js），v12→v13 对应 key 13
    13: (data) => ({ ...data, desktopLyricsHighContrast: data.desktopLyricsHighContrast ?? false }),
    14: (data) => ({
      ...data,
      lyricPreferredSource: ['bilibili', 'kugou', 'netease'].includes(data.lyricPreferredSource) ? data.lyricPreferredSource : 'bilibili'
    })
  }
})

// 主存储 key：settings
// 注意：downloadDirectory 不在主存 schema 里 —— 它是纯 IPC 内存态，不落盘。
// 所有 7 个字段都通过 createPersistentStorage 走主存 + localStorage 双写。
const storage = createPersistentStorage('settings', { schema: settingsSchema, debounceMs: 0 })

// 同步初值（localStorage peek，避免首屏闪）
// 7 个字段统一从 storage.peek() 拿，老 key 不再独立 peek —— storage 双写策略保证新 key 总是最新。
// 兜底逻辑：peek 拿不到时用 schema 的 default（schema.parse 内部处理）
const _peekedSettings = storage.peek(null) || {}

// 启动期同步：把 EQ pending 状态先灌进 audioEQ，attachAudioAnalyser 时 initEQ 会自动应用
applyEQToEngine(
  typeof _peekedSettings.eqEnabled === 'boolean' ? _peekedSettings.eqEnabled : true,
  Array.isArray(_peekedSettings.eqBands) && _peekedSettings.eqBands.length === 10
    ? _peekedSettings.eqBands
    : EQ_FLAT_BANDS.slice()
)

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    showSettings: false,
    activeSettingsTab: 'general',
    // downloadDirectory：纯 IPC 内存态（不落盘），启动时由 loadDownloadDirectory() 拉主进程值填充
    downloadDirectory: '',
    cacheSize: 0,
    // 非反应性字段：unsub 函数引用。Pinia state 里加这个只是为了能放在 store 上
    // 方便其他 action / 组件访问；本身不会被外部 set。
    _unsubDownloadDir: null,
    audioQuality: _peekedSettings.audioQuality ?? 'auto',
    audioVisualizerEnabled: typeof _peekedSettings.audioVisualizerEnabled === 'boolean'
      ? _peekedSettings.audioVisualizerEnabled
      : false,
    audioVisualizerIntensity: typeof _peekedSettings.audioVisualizerIntensity === 'number'
      ? _peekedSettings.audioVisualizerIntensity
      : 0.6,
    eqEnabled: typeof _peekedSettings.eqEnabled === 'boolean' ? _peekedSettings.eqEnabled : true,
    eqBands: Array.isArray(_peekedSettings.eqBands) && _peekedSettings.eqBands.length === 10
      ? _peekedSettings.eqBands.map(v => Number(v) || 0)
      : EQ_FLAT_BANDS.slice(),
    eqPreset: typeof _peekedSettings.eqPreset === 'string' ? _peekedSettings.eqPreset : 'flat',
    windowControlsEnabled: typeof _peekedSettings.windowControlsEnabled === 'boolean'
      ? _peekedSettings.windowControlsEnabled
      : true,
    lyricDisplayMode: typeof _peekedSettings.lyricDisplayMode === 'string'
      ? _peekedSettings.lyricDisplayMode
      : 'original',
    // 老数据（无该键 / 非法值）一律落到默认 'kugou'
    lyricPreferredSource: ['bilibili', 'kugou', 'netease'].includes(_peekedSettings.lyricPreferredSource) ? _peekedSettings.lyricPreferredSource : 'bilibili',
    desktopLyricsLocked: !!_peekedSettings.desktopLyricsLocked,
    desktopLyricsHotkey: typeof _peekedSettings.desktopLyricsHotkey === 'string'
      ? _peekedSettings.desktopLyricsHotkey
      : 'CommandOrControl+D',
    desktopLyricsHighContrast: _peekedSettings.desktopLyricsHighContrast === true,
    onboardingCompleted: _peekedSettings.onboardingCompleted === true,
    checkUpdateOnStartup: typeof _peekedSettings.checkUpdateOnStartup === 'boolean'
      ? _peekedSettings.checkUpdateOnStartup
      : true,
    localIncludeUnplayable: typeof _peekedSettings.localIncludeUnplayable === 'boolean'
      ? _peekedSettings.localIncludeUnplayable
      : true,
    localCheckMissingOnStartup: typeof _peekedSettings.localCheckMissingOnStartup === 'boolean'
      ? _peekedSettings.localCheckMissingOnStartup
      : true,
    localAutoFetchCover: _peekedSettings.localAutoFetchCover === true
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
        if (typeof data.lyricDisplayMode === 'string') this.lyricDisplayMode = data.lyricDisplayMode
        if (['bilibili', 'kugou', 'netease'].includes(data.lyricPreferredSource)) {
          this.lyricPreferredSource = data.lyricPreferredSource
        }
        if (typeof data.desktopLyricsLocked === 'boolean') this.desktopLyricsLocked = data.desktopLyricsLocked
        if (typeof data.desktopLyricsHotkey === 'string' && data.desktopLyricsHotkey) this.desktopLyricsHotkey = data.desktopLyricsHotkey
        if (typeof data.desktopLyricsHighContrast === 'boolean') this.desktopLyricsHighContrast = data.desktopLyricsHighContrast
        if (typeof data.onboardingCompleted === 'boolean') this.onboardingCompleted = data.onboardingCompleted
        if (typeof data.checkUpdateOnStartup === 'boolean') this.checkUpdateOnStartup = data.checkUpdateOnStartup
        if (typeof data.localIncludeUnplayable === 'boolean') this.localIncludeUnplayable = data.localIncludeUnplayable
        if (typeof data.localCheckMissingOnStartup === 'boolean') this.localCheckMissingOnStartup = data.localCheckMissingOnStartup
        if (typeof data.localAutoFetchCover === 'boolean') this.localAutoFetchCover = data.localAutoFetchCover
        applyEQToEngine(this.eqEnabled, this.eqBands)
      }
    },

    setShowSettings(show) { this.showSettings = show },
    /** 首次启动引导：完成/跳过时调用，落盘后不再显示 */
    completeOnboarding() {
      this.onboardingCompleted = true
      this.persist()
    },
    setActiveSettingsTab(tab) { this.activeSettingsTab = tab },
    setDownloadDirectory(dir) { this.downloadDirectory = dir },
    setCacheSize(size) { this.cacheSize = size },

    // 7 个 setter：所有写盘动作统一走 this.persist() → createPersistentStorage 主存 + localStorage 双写
    // 老的 'pink-music-audio-*' localStorage 不再被 set；peek 阶段已不再读它们，schema 默认值兜底
    setAudioQuality(quality) {
      this.audioQuality = quality
      this.persist()
    },
    setAudioVisualizerEnabled(enabled) {
      this.audioVisualizerEnabled = !!enabled
      this.persist()
    },
    setAudioVisualizerIntensity(value) {
      const v = Math.max(0, Math.min(1, Number(value) || 0))
      this.audioVisualizerIntensity = v
      this.persist()
    },
    setWindowControlsEnabled(enabled) {
      this.windowControlsEnabled = !!enabled
      this.persist()
    },
    setCheckUpdateOnStartup(enabled) {
      this.checkUpdateOnStartup = !!enabled
      this.persist()
    },
    /** 本地音乐库：是否收录 Chromium 无法直接播放的格式（wma/ape/dsf 等，标记为需转码） */
    setLocalIncludeUnplayable(enabled) {
      this.localIncludeUnplayable = !!enabled
      this.persist()
    },
    /** 本地音乐库：启动时是否自动校验文件是否仍存在 */
    setLocalCheckMissingOnStartup(enabled) {
      this.localCheckMissingOnStartup = !!enabled
      this.persist()
    },
    /** 本地音乐库：导入后是否自动为缺失封面匹配云端封面（参考 LrcApi） */
    setLocalAutoFetchCover(enabled) {
      this.localAutoFetchCover = !!enabled
      this.persist()
    },
    setLyricDisplayMode(mode) {
      this.lyricDisplayMode = mode
      this.persist()
      // 派发自定义事件通知歌词组件重新加载
      window.dispatchEvent(new CustomEvent('pink-music:lyric-mode-changed', { detail: mode }))
    },
    /**
     * 默认歌词源偏好（'kugou' | 'netease'）。
     * 语义是「优先使用」：主进程按 [偏好源, 另一个源] 顺序尝试，偏好源失败仍会回退。
     * 非法值直接忽略（保持现值），避免脏数据写进持久化快照。
     */
    setLyricPreferredSource(source) {
      if (!['bilibili', 'kugou', 'netease'].includes(source)) return
      this.lyricPreferredSource = source
      this.persist()
    },
    /**
     * 桌面歌词锁定态（唯一保留的桌面歌词设置项）。
     * 锁定后歌词窗点击穿透；解锁入口在主窗口播放栏按钮或全局快捷键。
     */
    setDesktopLyricsLocked(locked) {
      this.desktopLyricsLocked = !!locked
      this.persist()
    },
    /**
     * 桌面歌词全局快捷键（Electron accelerator 字符串，如 'CommandOrControl+Shift+L'）。
     * 仅持久化；实际注册/冲突校验由主进程 desktop-lyrics-hotkey-set 完成，
     * 调用方（设置页）需先拿到 ok:true 再写这里。
     */
    setDesktopLyricsHotkey(accel) {
      if (typeof accel !== 'string' || !accel) return
      this.desktopLyricsHotkey = accel
      this.persist()
    },
    /**
     * 桌面歌词高对比模式：浅色壁纸 / 浅色主题下歌词窗改用白字描边，避免歌词发虚。
     * 只影响桌面歌词窗（主窗口视觉不变），切换即持久化。
     */
    setDesktopLyricsHighContrast(enabled) {
      this.desktopLyricsHighContrast = !!enabled
      this.persist()
    },
    setEQEnabled(enabled) {
      this.eqEnabled = !!enabled
      applyEQToEngine(this.eqEnabled, this.eqBands)
      this.persist()
    },
    setEQBandGain(index, value) {
      const i = Math.max(0, Math.min(9, Number(index) || 0))
      const v = Math.max(-12, Math.min(12, Number(value) || 0))
      const next = this.eqBands.slice()
      next[i] = v
      this.eqBands = next
      applyEQToEngine(this.eqEnabled, this.eqBands)
      this.persist()
    },
    applyEQPreset(presetKey) {
      const bands = EQ_PRESETS[presetKey]
      if (!bands) return
      this.eqPreset = presetKey
      this.eqBands = bands.slice()
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
      applyEQToEngine(this.eqEnabled, this.eqBands)
      this.persist()
    },
    resetEQ() {
      this.eqEnabled = true
      this.eqPreset = 'flat'
      this.eqBands = EQ_FLAT_BANDS.slice()
      applyEQToEngine(true, this.eqBands)
      this.persist()
    },

    /** 内部：把当前关键 state 写入主存储（双写） */
    async persist() {
      _persistChain = _persistChain.then(async () => {
        await storage.save({
          audioQuality: this.audioQuality,
          audioVisualizerEnabled: this.audioVisualizerEnabled,
          audioVisualizerIntensity: this.audioVisualizerIntensity,
          eqEnabled: this.eqEnabled,
          eqBands: this.eqBands,
          eqPreset: this.eqPreset,
          windowControlsEnabled: this.windowControlsEnabled,
          lyricDisplayMode: this.lyricDisplayMode,
          lyricPreferredSource: this.lyricPreferredSource,
          desktopLyricsLocked: this.desktopLyricsLocked,
          desktopLyricsHotkey: this.desktopLyricsHotkey,
          desktopLyricsHighContrast: this.desktopLyricsHighContrast,
          onboardingCompleted: this.onboardingCompleted,
          checkUpdateOnStartup: this.checkUpdateOnStartup,
          localIncludeUnplayable: this.localIncludeUnplayable,
          localCheckMissingOnStartup: this.localCheckMissingOnStartup,
          localAutoFetchCover: this.localAutoFetchCover
        })
      })
      return _persistChain
    },

    // ============== 下载目录：纯 IPC 内存态 ==============
    // 主进程持有 currentDownloadDir 内存变量；渲染层 store 仅镜像。
    // loadDownloadDirectory：启动时拉一次
    // selectDownloadDirectory：用户选完目录后调
    // registerDownloadDirListener：注册推送监听，主进程变更时同步
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
    registerDownloadDirListener() {
      if (!window.electronAPI?.onDownloadDirChanged) return
      if (this._unsubDownloadDir) return  // 已注册过，避免重复
      this._unsubDownloadDir = window.electronAPI.onDownloadDirChanged((dir) => {
        this.downloadDirectory = dir
      })
    },
    unregisterDownloadDirListener() {
      if (this._unsubDownloadDir) {
        try { this._unsubDownloadDir() } catch (_) {}
        this._unsubDownloadDir = null
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
