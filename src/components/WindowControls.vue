<script setup>
/**
 * 自定义窗口控件（最小化 / 最大化还原 / 关闭）
 *
 * - 位置：固定在右上角，与项目 38px 高的拖动栏兼容（按钮在拖动栏下方一行内可点）
 * - 交互：所有按钮均设置 -webkit-app-region: no-drag，
 *   否则会被父容器的 drag 区域吞掉导致点击无效
 * - 状态：订阅主进程的 maximize 事件，最大化时按钮图标切换为「还原」
 * - 开关：在设置里可隐藏（windowControlsEnabled = false）
 * - macOS 上用系统交通灯，这里直接不渲染（避免和系统按钮叠加）
 */
import { ref, onMounted, onBeforeUnmount, computed } from 'vue'
import { useSettingsStore } from '../stores'

const settingsStore = useSettingsStore()

const isMac = ref(false)
const isMaximized = ref(false)
const isFullScreen = ref(false)
let unbindMaximizeListener = null

onMounted(async () => {
  if (!window.electronAPI) {
    // 浏览器/非 Electron 环境直接隐藏
    return
  }

  // 平台判断：macOS 用系统交通灯，本控件不渲染
  try {
    const platform = await window.electronAPI.getPlatform()
    isMac.value = platform === 'darwin'
  } catch (_) {
    isMac.value = false
  }

  // 初始同步一次状态（防止冷启动时按钮图标错误）
  try {
    const res = await window.electronAPI.isWindowMaximized()
    if (res && res.code === 0) {
      isMaximized.value = !!res.isMaximized
      isFullScreen.value = !!res.isFullScreen
    }
  } catch (_) { /* ignore */ }

  // 订阅后续状态变化
  if (typeof window.electronAPI.onWindowMaximizeChange === 'function') {
    unbindMaximizeListener = window.electronAPI.onWindowMaximizeChange((payload) => {
      if (!payload) return
      isMaximized.value = !!payload.isMaximized
      isFullScreen.value = !!payload.isFullScreen
    })
  }
})

onBeforeUnmount(() => {
  if (typeof unbindMaximizeListener === 'function') unbindMaximizeListener()
})

// 设置里关闭时整个组件隐藏
const visible = computed(() => !isMac.value && settingsStore.windowControlsEnabled !== false)

function minimizeWindow() {
  if (window.electronAPI) window.electronAPI.minimizeWindow()
}

async function toggleMaximize() {
  if (!window.electronAPI) return
  const res = await window.electronAPI.maximizeWindow()
  // 主进程已发送 state 事件，但部分平台/部分时序下事件可能晚到；
  // 立即用返回值兜底更新一次，避免图标不切
  if (res && typeof res.isMaximized === 'boolean') {
    isMaximized.value = res.isMaximized
  }
}

function closeWindow() {
  if (window.electronAPI) window.electronAPI.closeWindow()
}

// 双击拖动栏最大化（Windows/Linux 习惯）：如果用户没在按钮上点，吞掉多余事件
function onBtnMouseDown(e) {
  e.stopPropagation()
}
</script>

<template>
  <div v-if="visible" class="window-controls" role="group" aria-label="窗口控制">
    <button
      class="control-btn minimize"
      type="button"
      title="最小化"
      aria-label="最小化"
      @click="minimizeWindow"
      @mousedown="onBtnMouseDown"
    >
      <!-- 横线垂直居中，与最大化/关闭图标的视觉重心一致 -->
      <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
        <path d="M2.5 6 H9.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
      </svg>
    </button>
    <button
      class="control-btn maximize"
      type="button"
      :title="isMaximized ? '还原' : '最大化'"
      :aria-label="isMaximized ? '还原窗口' : '最大化窗口'"
      @click="toggleMaximize"
      @mousedown="onBtnMouseDown"
    >
      <!-- 最大化：圆角方框 -->
      <svg v-if="!isMaximized" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
        <rect x="2.5" y="2.5" width="7" height="7" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.3" />
      </svg>
      <!-- 还原：前方圆角框 + 右上后框（仅画可见的顶边与右边，避免交叠穿线） -->
      <svg v-else viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
        <path d="M4.25 2.25 H9.75 V7.75" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
        <rect x="1.75" y="4.75" width="6.5" height="6.5" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.3" />
      </svg>
    </button>
    <button
      class="control-btn close"
      type="button"
      title="关闭"
      aria-label="关闭"
      @click="closeWindow"
      @mousedown="onBtnMouseDown"
    >
      <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
        <path d="M3.5 3.5 L8.5 8.5 M8.5 3.5 L3.5 8.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.window-controls {
  position: fixed;
  /* 顶到屏幕最右上角，与 drag-bar 同行（高度跟随 A1 的 --shell-dragbar-height） */
  top: 0;
  right: 0;
  height: var(--shell-dragbar-height, 38px);
  display: flex;
  align-items: center;
  gap: 0;
  padding: 0 6px;
  /* 层级：A1 全局 token + 数值兜底（900）。必须永远压在所有浮层之上，
     否则 .drag-bar（--z-dragbar: 40）或任何弹窗会把窗口按钮盖掉/吞掉点击 */
  z-index: var(--z-window-controls, 900);
  /* 容器本身不接收点击：只有按钮可点，容器留白不会遮挡内容区按钮 */
  pointer-events: none;
  /* 控件本身不要触发拖动；按钮单独再设一次 no-drag，避免父容器 drag 吞掉 click */
  -webkit-app-region: no-drag;
}

.control-btn {
  /* 与父容器 pointer-events: none 配对 */
  pointer-events: auto;
  width: 30px;
  height: 28px;
  border: none;
  background: transparent;
  color: var(--text-secondary, #888);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  transition: background 0.15s ease, color 0.15s ease, transform 0.08s ease;
  -webkit-app-region: no-drag;
  padding: 0;
  margin: 0 1px;
}

.control-btn:hover {
  background: var(--hover-bg, rgba(255, 255, 255, 0.08));
  color: var(--text-primary, #fff);
}

.control-btn:active {
  transform: scale(0.94);
}

.control-btn.close:hover {
  background: var(--error-color);
  color: #fff;
}

.control-btn.close:active {
  background: var(--error-color);
  color: #fff;
  filter: brightness(0.88);
}

.control-btn svg {
  display: block;
  opacity: 0.85;
  transition: transform 0.18s ease, opacity 0.15s ease;
}

.control-btn:hover svg {
  opacity: 1;
  transform: scale(1.08);
}

.control-btn:active svg {
  transform: scale(0.95);
}

/* 浅色模式：默认色用更深的灰色，与白底对比 */
:root[data-theme="light"] .control-btn {
  color: var(--text-secondary);
}
:root[data-theme="light"] .control-btn:hover {
  background: var(--bg-card-hover);
  color: var(--text-primary);
}
:root[data-theme="light"] .control-btn.close:hover {
  background: var(--error-color);
  color: #fff;
}
:root[data-theme="light"] .control-btn.close:active {
  background: var(--error-color);
  color: #fff;
  filter: brightness(0.88);
}
</style>
