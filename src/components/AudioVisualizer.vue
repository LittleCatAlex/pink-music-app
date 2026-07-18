<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { getAnalyser, isAnalyserReady } from '@/utils/audioAnalyser'

/**
 * 大屏播放页音频可视化组件
 *
 * 设计要点：
 * - 横向居中频谱条，左右镜像，营造对称美感
 * - 颜色直接读 CSS 变量 --primary-color，
 *   切主题时通过 MutationObserver 监听 data-theme / data-color 自动重读
 * - 深色模式：较高透明度 + glow 感；浅色模式：降低透明度避免刺眼
 * - 暂停时条形平滑下滑到 0（依赖频谱数据自然衰减 + 平滑系数）
 * - 开关关闭时由父组件 v-if 整体不渲染，避免空 canvas 浪费
 */
defineProps({
  // 是否启用（来自设置，仅用于未来扩展，目前由父组件 v-if 控制）
  enabled: {
    type: Boolean,
    default: true
  }
})

const domCanvas = ref(null)

// === 主题色（懒读 + MutationObserver 监听主题变化） ===
let themeColor = ''
let isDark = true

function readTheme() {
  const style = getComputedStyle(document.documentElement)
  themeColor = (style.getPropertyValue('--primary-color') || '#FF69B4').trim()
  isDark = document.documentElement.getAttribute('data-theme') !== 'light'
}

// === 渲染状态 ===
let ctx
let bufferLength = 0
let dataArray
let WIDTH = 0
let HEIGHT = 0
let midX = 0
let baseY = 0
let maxBarHeight = 0
let isPlaying = false
let animationId = null
let resizeObserver = null
let themeObserver = null

// 平滑后的频谱值（让条形不会跳变）
const smoothed = []
const SMOOTH_FACTOR_DOWN = 0.18 // 下落慢一点，音乐感更强
const SMOOTH_FACTOR_UP = 0.55

function resizeCanvas() {
  const canvas = domCanvas.value
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  // 高 DPI 屏幕：用 devicePixelRatio 让画布更清晰（封顶 2x 防止 4K 屏过载）
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = Math.max(1, Math.floor(rect.width * dpr))
  canvas.height = Math.max(1, Math.floor(rect.height * dpr))
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  WIDTH = rect.width
  HEIGHT = rect.height
  midX = WIDTH / 2
  // 全屏背景：让条形贴在屏幕最底部，作为"底部装饰条"，
  // 最高占画布 18% 高度，避免抢中部（封面/歌词）的视觉位置
  baseY = HEIGHT * 0.97
  maxBarHeight = HEIGHT * 0.18
}

function ensureDataArray() {
  const analyser = getAnalyser()
  if (!analyser) {
    bufferLength = 0
    dataArray = null
    return false
  }
  if (bufferLength !== analyser.frequencyBinCount) {
    bufferLength = analyser.frequencyBinCount
    dataArray = new Uint8Array(bufferLength)
    // 重置平滑数组
    for (let i = 0; i < bufferLength; i++) smoothed[i] = 0
  }
  return true
}

function drawFrame() {
  if (!ctx || !WIDTH) {
    animationId = null
    return
  }

  const analyser = getAnalyser()
  if (!analyser || !dataArray) {
    ctx.clearRect(0, 0, WIDTH, HEIGHT)
    animationId = null
    return
  }

  analyser.getByteFrequencyData(dataArray)

  // 残影拖尾：透明度更低，让画面更"轻"
  ctx.fillStyle = isDark ? 'rgba(10, 10, 20, 0.22)' : 'rgba(248, 250, 252, 0.28)'
  ctx.fillRect(0, 0, WIDTH, HEIGHT)

  // 频谱条：从 bufferLength 取前 128 个 bin（跳过低频直流 + 高频噪声）
  const startBin = 2
  const endBin = Math.min(bufferLength, 128)
  const usable = endBin - startBin
  if (usable <= 0) {
    animationId = isPlaying ? requestAnimationFrame(drawFrame) : null
    return
  }

  // === 频率→位置映射：中心反映低频，两侧反映高频（视觉上"鼓点在中央"）===
  // 用 distFromCenter 把 bar i 映射到 [0, totalCount/2) 的频段索引：
  //   i = center → bandIdx 0（最低频，能量最大）
  //   i = edge   → bandIdx totalCount/2-1（最高频，能量小）
  // 这样中间最高（kick/bass 的视觉冲击）
  const totalCount = 64
  const step = WIDTH / totalCount
  const realBarWidth = Math.max(2, Math.floor(step * 0.55))
  const realGap = Math.floor(step - realBarWidth)
  const half = totalCount / 2

  // 给条形加 glow：阴影颜色随主题色
  ctx.shadowBlur = isDark ? 14 : 0
  ctx.shadowColor = themeColor
  // 整体不透明度：深色 0.75，浅色 0.35
  ctx.globalAlpha = isDark ? 0.75 : 0.35
  ctx.fillStyle = themeColor

  let peak = 0
  for (let i = 0; i < totalCount; i++) {
    // 中心→低频的镜像映射：bandIdx 从 0（中心）到 half-1（边缘）
    const distFromCenter = Math.abs(i - half + 0.5) / half // 0 中心，1 边缘
    const bandIdx = Math.floor(distFromCenter * half)
    const segStart = startBin + Math.floor((bandIdx * usable) / half)
    const segEnd = startBin + Math.floor(((bandIdx + 1) * usable) / half)
    let sum = 0
    let n = 0
    for (let k = segStart; k < segEnd && k < bufferLength; k++) {
      sum += dataArray[k]
      n++
    }
    const raw = n > 0 ? sum / n : 0
    const prev = smoothed[i] || 0
    const next = raw >= prev
      ? prev + (raw - prev) * SMOOTH_FACTOR_UP
      : prev + (raw - prev) * SMOOTH_FACTOR_DOWN
    smoothed[i] = next
    if (next > peak) peak = next

    // 高度：sqrt 压缩 + 1.6 倍 maxBarHeight（让中心峰值更"打"）
    const boosted = Math.sqrt(next / 255)
    const h = Math.max(2, boosted * maxBarHeight * 1.6)
    const y = baseY - h
    const x = Math.floor(i * step + realGap / 2)
    ctx.fillRect(x, y, realBarWidth, h)
  }

  // 中心高亮：用峰值做"心跳"效果
  const peakH = Math.max(2, Math.sqrt(peak / 255) * maxBarHeight * 1.6)
  ctx.shadowBlur = isDark ? 22 : 0
  ctx.fillRect(midX - 2, baseY - peakH, 4, peakH)
  ctx.shadowBlur = 0
  ctx.globalAlpha = 1

  animationId = isPlaying ? requestAnimationFrame(drawFrame) : null
}

function start() {
  if (animationId) return
  if (!ensureDataArray()) return
  isPlaying = true
  animationId = requestAnimationFrame(drawFrame)
}

function stop() {
  isPlaying = false
  if (animationId) {
    cancelAnimationFrame(animationId)
    animationId = null
  }
  // 不清空画面，让条形自然下垂到 0（视觉更柔和）
}

// analyser 是延迟就绪的（首次 playMusic 才会 attach），
// 用 setInterval 轮询直到就绪后启动渲染
let checkInterval = null
function watchAnalyserReady() {
  if (checkInterval) return
  checkInterval = setInterval(() => {
    if (!isAnalyserReady()) return
    clearInterval(checkInterval)
    checkInterval = null
    if (!isPlaying) start()
  }, 200)
}

onMounted(() => {
  readTheme()
  const canvas = domCanvas.value
  if (!canvas) return
  ctx = canvas.getContext('2d')
  resizeCanvas()

  // 监听尺寸变化（窗口缩放/布局变化时重算）
  resizeObserver = new ResizeObserver(() => resizeCanvas())
  resizeObserver.observe(canvas)

  // 监听主题切换：data-theme / data-color 改变时重读色值
  themeObserver = new MutationObserver(() => {
    readTheme()
  })
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'data-color']
  })

  // 如果播放已经开始（用户从播放栏点开），立即开始
  if (isAnalyserReady()) {
    start()
  } else {
    watchAnalyserReady()
  }
})

onBeforeUnmount(() => {
  stop()
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
  if (themeObserver) {
    themeObserver.disconnect()
    themeObserver = null
  }
  if (checkInterval) {
    clearInterval(checkInterval)
    checkInterval = null
  }
})

// 对外暴露：开始 / 停止（备用 API，目前由父组件 v-if 控制生命周期）
defineExpose({ start, stop })
</script>

<template>
  <div :class="['audio-visualizer', { 'is-dark': isDark, 'is-light': !isDark }]">
    <!-- 暗色底层 + 径向渐变，让频谱条有舞台感 -->
    <div class="audio-visualizer-base"></div>
    <canvas ref="domCanvas" class="audio-visualizer-canvas"></canvas>
  </div>
</template>

<style scoped>
/* 大屏播放页全屏背景：在 .player-page 内部以 absolute 铺满整个屏幕 */
.audio-visualizer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  /* 浮在 .player-page::before 装饰之上、.player-page-content 之下 */
  z-index: 0;
  /* 暗色底层：保证可读性，浅色模式用更浅的遮罩 */
  background: linear-gradient(180deg, #0a0a14 0%, #14102a 100%);
  overflow: hidden;
  transition: background 0.3s ease;
}

/* 浅色主题背景：白 → 极淡主题色，让频谱条也有对比度 */
.audio-visualizer.is-light {
  background: linear-gradient(180deg, #FAFAFC 0%, #F0E8F4 100%);
}

/* 中心径向高光：让频谱条集中在中心区域时更有舞台感 */
.audio-visualizer-base {
  position: absolute;
  inset: 0;
  background: radial-gradient(
    ellipse at 50% 100%,
    var(--primary-color, #FF69B4) 0%,
    transparent 60%
  );
  opacity: 0.18;
  mix-blend-mode: screen;
  transition: opacity 0.3s ease;
}

.audio-visualizer.is-light .audio-visualizer-base {
  opacity: 0.12;
  mix-blend-mode: multiply;
}

.audio-visualizer-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}
</style>
