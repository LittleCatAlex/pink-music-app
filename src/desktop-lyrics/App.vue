<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { findLineIndexAtTime } from '@/utils/lrcParser'

// ───────── 来自主窗口的状态（经 desktop-lyrics-state 消息流） ─────────
const lines = ref([])
const offsetMs = ref(0)
const trackTitle = ref('')
const trackArtist = ref('')
const displayMode = ref('original')   // original | romaji | translation，与大屏播放页设置一致
const locked = ref(false)

// ───────── 主题色（主窗口解析后的 CSS 变量随 style 消息下发） ─────────
const primaryColor = ref('#FF69B4')
const primaryGradient = ref('')       // 可能为 linear-gradient(...) 或纯色值（apple-music 主题）

// ───────── 插值时间基准 ─────────
// 主窗口推送 { currentTime, isPlaying, sentAt(Date.now) } 快照；
// 本窗口用本地单调钟 performance.now() 锚定 sentAt 后逐帧推进。
const baseTime = ref(0)        // 秒
const isPlaying = ref(false)
let anchorPerfNow = 0          // 收到快照瞬间对应的本地 performance.now()
let rafId = 0
let lineDirty = true           // 是否有新快照需要重算行号（未播放时省掉逐帧重算）
const interpolatedTime = ref(0)

// ───────── UI 状态 ─────────
const hovered = ref(false)
const currentLineIndex = ref(-1)

const hasLyric = computed(() => lines.value.length > 0)
const currentLine = computed(() =>
  currentLineIndex.value >= 0 ? lines.value[currentLineIndex.value] : null
)

/** 副行文本：按显示模式取罗马音/翻译（与主行同时显示） */
function subTextOf(line) {
  if (!line || displayMode.value === 'original') return ''
  if (displayMode.value === 'romaji') return line.romaji || ''
  if (displayMode.value === 'translation') return line.translation || ''
  return ''
}
const currentSub = computed(() => subTextOf(currentLine.value))

// ───────── 样式：字号固定，颜色跟随主题 ─────────
/** 统一转成渐变写法：官方 --primary-gradient 若是纯色（apple-music），包一层同色渐变 */
const gradientCss = computed(() => {
  const g = primaryGradient.value.trim()
  if (/^linear-gradient/i.test(g)) return g
  const c = g || primaryColor.value
  return `linear-gradient(135deg, ${c} 0%, ${c} 100%)`
})

const mainTextStyle = computed(() => ({
  fontSize: '30px',
  background: gradientCss.value,
  webkitBackgroundClip: 'text',
  backgroundClip: 'text',
  webkitTextFillColor: 'transparent',
  filter: `drop-shadow(0 1px 2px rgba(0,0,0,.6)) drop-shadow(0 0 8px rgba(0,0,0,.25)) drop-shadow(0 0 10px ${primaryColor.value}40)`
}))

// ───────── 消息协议 ─────────
let unsubState = null

function applyProgress(payload) {
  baseTime.value = Number(payload.currentTime) || 0
  isPlaying.value = !!payload.isPlaying
  anchorPerfNow = performance.now() - Math.max(0, Date.now() - (Number(payload.sentAt) || Date.now()))
  lineDirty = true
}

function applyStyle(style) {
  if (!style || typeof style !== 'object') return
  if (typeof style.displayMode === 'string') displayMode.value = style.displayMode
  if (typeof style.primaryColor === 'string' && style.primaryColor) primaryColor.value = style.primaryColor
  if (typeof style.primaryGradient === 'string') primaryGradient.value = style.primaryGradient
  if (typeof style.locked === 'boolean' && style.locked !== locked.value) {
    locked.value = style.locked
    syncIgnoreMouse()
  }
}

function syncIgnoreMouse() {
  try {
    window.desktopLyricsAPI?.setIgnoreMouseEvents?.(locked.value)
  } catch (_) {}
}

function sendCommand(action, payload = {}) {
  try {
    window.desktopLyricsAPI?.pushState?.({ type: 'command', action, ...payload })
  } catch (_) {}
}

// ───────── 工具条动作 ─────────
function toggleLock() {
  sendCommand('lock', { locked: true })   // 解锁只能从主窗口进（锁定后本窗收不到事件）
}
function closeWindow() {
  sendCommand('close')
}
function seekTo(line) {
  if (!line || locked.value) return
  // 与主窗口 handleLyricClick 一致：seek 目标要扣掉用户微调的 offset
  const adjusted = (Number(line.time) || 0) - (Number(offsetMs.value) || 0)
  sendCommand('seek', { time: Math.max(0, adjusted / 1000) })
}

// ───────── 插值循环 ─────────
function tick() {
  if (isPlaying.value) {
    interpolatedTime.value = baseTime.value + Math.max(0, performance.now() - anchorPerfNow) / 1000
  } else if (!lineDirty) {
    // 未播放且没有新进度/样式/歌词到达：时间与行号都不会变，不必逐帧重算
    rafId = requestAnimationFrame(tick)
    return
  } else {
    interpolatedTime.value = baseTime.value
  }
  lineDirty = false
  const idx = findLineIndexAtTime(lines.value, interpolatedTime.value, offsetMs.value)
  if (idx !== currentLineIndex.value) currentLineIndex.value = idx
  rafId = requestAnimationFrame(tick)
}

onMounted(() => {
  unsubState = window.desktopLyricsAPI?.onState?.((payload) => {
    if (!payload || !payload.type) return
    switch (payload.type) {
      case 'progress': applyProgress(payload); break
      case 'track':
        trackTitle.value = payload.title || ''
        trackArtist.value = payload.artist || ''
        break
      case 'lyrics':
        lines.value = Array.isArray(payload.lines) ? payload.lines : []
        offsetMs.value = Number(payload.offsetMs) || 0
        currentLineIndex.value = -1
        lineDirty = true
        break
      case 'style': applyStyle(payload); lineDirty = true; break
    }
  })
  syncIgnoreMouse()
  // 就绪握手：让主窗口立即重推全量快照，避免开窗瞬间消息早于本页加载而丢失
  try { window.desktopLyricsAPI?.notifyReady?.() } catch (_) {}
  rafId = requestAnimationFrame(tick)
})

onUnmounted(() => {
  if (rafId) cancelAnimationFrame(rafId)
  try { unsubState?.() } catch (_) {}
})
</script>

<template>
  <div class="dl-root" :class="{ locked }" :data-track="`${trackTitle} · ${trackArtist}`"
       @mouseenter="hovered = true" @mouseleave="hovered = false">
    <!-- 悬浮工具条：hover 显示；整窗 drag 区域，按钮单独 no-drag -->
    <Transition name="toolbar">
      <div v-if="hovered && !locked" class="dl-toolbar no-drag">
        <span class="tb-track" :title="`${trackTitle} - ${trackArtist}`">
          {{ trackTitle }}<template v-if="trackArtist"> · {{ trackArtist }}</template>
        </span>
        <span class="tb-spacer"></span>
        <button class="tb-btn" title="锁定（在主窗口或 Ctrl/Cmd+D 解锁）" @click="toggleLock">
          <svg viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="M17 8h-1V6a4 4 0 10-8 0v2H7a2 2 0 00-2 2v9a2 2 0 002 2h10a2 2 0 002-2v-9a2 2 0 00-2-2m-7-2a2 2 0 114 0v2h-4z"/></svg>
        </button>
        <button class="tb-btn tb-close" title="关闭桌面歌词" @click="closeWindow">
          <svg viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </button>
      </div>
    </Transition>

    <!-- 锁定角标 -->
    <div v-if="locked" class="dl-lock-badge">已锁定</div>

    <!-- 歌词主体：当前行 + 翻译/罗马音副行（固定单行） -->
    <div class="dl-body">
      <div v-if="!hasLyric" class="dl-empty">
        ♪ 暂无歌词<template v-if="trackTitle"> · {{ trackTitle }}</template>
      </div>
      <template v-else>
        <p class="dl-line no-drag clickable" :style="mainTextStyle"
           title="点击跳转"
           @click="seekTo(currentLine)">
          {{ currentLine?.text }}
        </p>
        <p v-if="currentSub" class="dl-sub">{{ currentSub }}</p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.dl-root {
  position: relative;
  width: 100vw;
  height: 100vh;
  box-sizing: border-box;
  padding: 34px 20px 12px;
  overflow: hidden;
  /* 整窗可拖动；交互元素加 .no-drag */
  -webkit-app-region: drag;
  font-family: 'PingFang SC', 'Microsoft YaHei', 'Helvetica Neue', sans-serif;
  cursor: default;
  /* 文字不可选中：鼠标滑动不产生选区 */
  user-select: none;
  -webkit-user-select: none;
  -webkit-user-drag: element;
}

/* ── 工具条 ── */
.dl-toolbar {
  position: absolute;
  top: 4px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 2px;
  max-width: calc(100% - 24px);
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(20, 20, 28, 0.72);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  z-index: 10;
  white-space: nowrap;
}
.tb-track {
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.65);
  margin-right: 4px;
}
.tb-spacer { flex: 1 1 auto; min-width: 12px; }
.tb-btn {
  -webkit-app-region: no-drag;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: rgba(255, 255, 255, 0.82);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.tb-btn:hover { background: rgba(255, 255, 255, 0.16); color: #fff; }
.tb-close:hover { background: rgba(255, 80, 110, 0.55); }

.toolbar-enter-active, .toolbar-leave-active { transition: opacity 0.18s ease, transform 0.18s ease; }
.toolbar-enter-from, .toolbar-leave-to { opacity: 0; transform: translateX(-50%) translateY(-6px); }

/* ── 锁定角标 ── */
.dl-lock-badge {
  position: absolute;
  top: 6px;
  right: 10px;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 11px;
  letter-spacing: 1px;
  color: rgba(255, 255, 255, 0.55);
  background: rgba(20, 20, 28, 0.35);
  pointer-events: none;
}

/* ── 歌词主体 ── */
.dl-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  height: 100%;
}
.dl-line {
  margin: 0;
  font-weight: 700;
  line-height: 1.25;
  text-align: center;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dl-line.clickable { cursor: pointer; }
.dl-sub {
  margin: 0;
  font-size: 15px;
  font-weight: 500;
  line-height: 1.25;
  text-align: center;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: rgba(255, 255, 255, 0.85);
  filter: drop-shadow(0 1px 1.5px rgba(0, 0, 0, 0.55));
}
.dl-empty {
  font-size: 22px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.75);
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.6));
}
</style>
