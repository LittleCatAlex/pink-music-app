import { ref, computed, watch, onUnmounted } from 'vue'
import { usePlayerStore, useLyricStore, useSettingsStore, useThemeStore } from '@/stores'

/**
 * 桌面歌词（悬浮窗）主窗口侧桥接。
 *
 * 职责：
 * 1. 把播放状态以 ~250ms 节流快照推给歌词窗口（歌词窗本地 rAF 插值，丝滑滚动）
 * 2. 切歌/歌词加载/偏移量变化时推送整份解析后的歌词行
 * 3. 锁定态/显示模式/当前主题色变化时推送样式（字号配色固定，颜色自动跟随主题）
 * 4. 接收歌词窗回传命令：seek / lock / close / ready 握手
 * 5. 开关窗口并维护 dlEnabled 状态
 *
 * 数据流：主窗口 → ipc 'desktop-lyrics-state' → 主进程转发 → 歌词窗口
 */
export function useDesktopLyrics({ onSeek } = {}) {
  const playerStore = usePlayerStore()
  const lyricStore = useLyricStore()
  const settingsStore = useSettingsStore()
  const themeStore = useThemeStore()

  // 悬浮窗当前是否可见（按钮高亮依据）
  const dlEnabled = ref(false)
  let pushTimer = null
  let started = false

  function api() {
    return typeof window !== 'undefined' ? window.desktopLyricsAPI : null
  }

  function send(payload) {
    // 关键：JSON 深拷贝剥离 Vue reactive Proxy。
    // Electron IPC 用 V8 structured clone，Proxy 会抛 DataCloneError 且被静默吞掉，
    // 导致歌词行（来自 Pinia store 的 reactive 数组）永远到不了歌词窗。
    try {
      const plain = JSON.parse(JSON.stringify(payload))
      api()?.pushState?.(plain)
    } catch (e) {
      console.warn('[desktopLyrics] pushState 序列化失败:', e?.message)
    }
  }

  // ───────── 各类状态推送 ─────────
  function pushProgress() {
    if (!dlEnabled.value) return
    send({
      type: 'progress',
      currentTime: Number(playerStore.currentTime) || 0,
      isPlaying: !!playerStore.isPlaying,
      sentAt: Date.now()   // 跨进程用系统墙钟对齐，歌词窗换算到本地单调钟插值
    })
  }

  function pushTrack() {
    if (!dlEnabled.value) return
    const t = playerStore.currentTrack
    send({
      type: 'track',
      title: t?.title || '',
      artist: t?.author || ''
    })
  }

  function pushLyrics() {
    if (!dlEnabled.value) return
    const lyric = lyricStore.currentLyric
    send({
      type: 'lyrics',
      lines: Array.isArray(lyric?.lyrics) ? lyric.lyrics : [],
      offsetMs: Number(lyricStore.currentOffset) || 0
    })
  }

  /**
   * 读取主窗口当前已解析的主题色（--primary-color / --primary-gradient）。
   * 直接取 computed style：无论 data-theme/data-color 组合如何（含 apple-music 的纯色渐变写法）
   * 都能拿到最终值，歌词窗无需重复实现主题映射。
   */
  function readThemeColors() {
    let primaryColor = ''
    let primaryGradient = ''
    try {
      const cs = getComputedStyle(document.documentElement)
      primaryColor = (cs.getPropertyValue('--primary-color') || '').trim()
      primaryGradient = (cs.getPropertyValue('--primary-gradient') || '').trim()
    } catch (_) {}
    return {
      // 兜底默认粉（与 style.css 根变量一致）
      primaryColor: /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(primaryColor) ? primaryColor : '#FF69B4',
      primaryGradient
    }
  }

  function pushStyle() {
    if (!dlEnabled.value) return
    send({
      type: 'style',
      locked: !!settingsStore.desktopLyricsLocked,
      displayMode: settingsStore.lyricDisplayMode,   // original | romaji | translation，与大屏播放页一致
      ...readThemeColors()                           // 歌词颜色自动跟随当前主题
    })
  }

  /** 全量快照（开窗/恢复时立即同步一次） */
  function pushAll() {
    pushTrack()
    pushLyrics()
    pushStyle()
    pushProgress()
  }

  // ───────── 推送循环启停 ─────────
  function startPushing() {
    if (started) { pushAll(); return }
    started = true
    pushAll()
    // paused 时 timeupdate 不触发，靠定时器持续兜底推送最新快照
    pushTimer = setInterval(pushProgress, 250)
  }

  function stopPushing() {
    if (pushTimer) { clearInterval(pushTimer); pushTimer = null }
    started = false
  }

  // ───────── 歌词窗回传命令 ─────────
  function handleCommand(cmd) {
    if (!cmd || !cmd.action) return
    switch (cmd.action) {
      case 'seek':
        if (typeof onSeek === 'function') {
          try { onSeek(Number(cmd.time) || 0) } catch (_) {}
        }
        break
      case 'lock':
        settingsStore.setDesktopLyricsLocked(cmd.locked !== false)
        break
      case 'close':
        hideDesktopLyrics()
        break
      case 'lyrics-window-ready':
        // 歌词窗页面加载完成：全量重推一次（解决开窗瞬间推送早于页面加载的竞态）
        if (dlEnabled.value) pushAll()
        break
    }
  }

  // ───────── 对外动作 ─────────
  async function toggleDesktopLyrics() {
    const a = api()
    if (!a) return
    try {
      const res = await a.toggle()
      dlEnabled.value = !!(res && res.visible)
      if (dlEnabled.value) startPushing()
      else stopPushing()
    } catch (e) {
      console.warn('[desktopLyrics] toggle 失败:', e)
    }
  }

  function hideDesktopLyrics() {
    try { api()?.hide?.() } catch (_) {}
    dlEnabled.value = false
    stopPushing()
  }

  // 锁定状态（App.vue 按钮展示 + 解锁入口用）
  const dlLocked = computed(() => !!settingsStore.desktopLyricsLocked)

  // ───────── 响应式监听 ─────────
  const watches = []
  watches.push(watch(() => playerStore.currentTrack, () => { pushTrack(); pushLyrics() }))
  watches.push(watch(() => lyricStore.currentLyric, () => pushLyrics()))
  watches.push(watch(() => lyricStore.currentOffset, () => pushLyrics()))
  watches.push(watch(() => settingsStore.desktopLyricsLocked, () => pushStyle()))
  watches.push(watch(() => settingsStore.lyricDisplayMode, () => pushStyle()))
  // 主题（深浅色 / 主题色）变化时同步歌词窗配色；flush:'post' 确保 DOM 属性已应用后再读 computed style
  watches.push(watch(
    () => [themeStore.currentTheme, themeStore.currentColor],
    () => pushStyle(),
    { flush: 'post' }
  ))
  // 播放/暂停瞬间立即推一帧，避免歌词窗停在旧状态最长 250ms
  watches.push(watch(() => playerStore.isPlaying, () => pushProgress()))

  let unsubCommand = null
  let unsubVisibility = null
  if (typeof window !== 'undefined' && window.desktopLyricsAPI) {
    if (window.desktopLyricsAPI.onCommand) {
      unsubCommand = window.desktopLyricsAPI.onCommand(handleCommand)
    }
    // 可见性以主进程广播为唯一事实源：无论窗口经哪条路径开关（按钮/菜单/其他），
    // 主窗口的推送循环都会正确启停，不会出现"窗开着但没人推数据"的失联态。
    if (window.desktopLyricsAPI.onVisibilityChanged) {
      unsubVisibility = window.desktopLyricsAPI.onVisibilityChanged((visible) => {
        dlEnabled.value = visible
        visible ? startPushing() : stopPushing()
      })
      // 启动时查询一次（dev HMR 重载后保持状态一致）
      window.desktopLyricsAPI.getVisible?.().then((res) => {
        const visible = !!(res && res.visible)
        dlEnabled.value = visible
        visible ? startPushing() : stopPushing()
      }).catch(() => {})
    }
  }

  onUnmounted(() => {
    stopPushing()
    watches.forEach(un => { try { un() } catch (_) {} })
    try { unsubCommand?.() } catch (_) {}
    try { unsubVisibility?.() } catch (_) {}
  })

  return {
    dlEnabled,
    dlLocked,
    toggleDesktopLyrics,
    hideDesktopLyrics,
    unlockDesktopLyrics: () => settingsStore.setDesktopLyricsLocked(false),
    lockDesktopLyrics: () => settingsStore.setDesktopLyricsLocked(true)
  }
}
