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
      <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
        <line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
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
      <!-- 最大化：方框；已最大化：两个重叠方框表示还原 -->
      <svg v-if="!isMaximized" viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
        <rect x="1.25" y="1.25" width="7.5" height="7.5" fill="none" stroke="currentColor" stroke-width="1.2" />
      </svg>
      <svg v-else viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
        <rect x="1.5" y="3" width="5.5" height="5.5" fill="none" stroke="currentColor" stroke-width="1.1" />
        <path d="M3 3 V1.5 H8 V6.5 H6.5" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" />
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
      <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
        <line x1="1.5" y1="1.5" x2="8.5" y2="8.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
        <line x1="8.5" y1="1.5" x2="1.5" y2="8.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.window-controls {
  position: fixed;
  /* 顶到屏幕最右上角，与 38px 高的 drag-bar 同行 */
  top: 0;
  right: 0;
  height: 38px;
  display: flex;
  align-items: center;
  gap: 0;
  padding: 0 6px;
  z-index: 1001;
  /* 控件本身不要触发拖动；按钮单独再设一次 no-drag，避免父容器 drag 吞掉 click */
  -webkit-app-region: no-drag;
}

.control-btn {
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
  background: #e81123;
  color: #fff;
}

.control-btn svg {
  display: block;
  opacity: 0.9;
}

.control-btn:hover svg {
  opacity: 1;
}

/* 浅色模式：默认色用更深的灰色，与白底对比 */
:global([data-theme="light"]) .control-btn {
  color: #555;
}
:global([data-theme="light"]) .control-btn:hover {
  background: rgba(0, 0, 0, 0.06);
  color: #111;
}
:global([data-theme="light"]) .control-btn.close:hover {
  background: #e81123;
  color: #fff;
}
</style>
