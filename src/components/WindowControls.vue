<script setup>
import { ref, onMounted } from 'vue'

const isMac = ref(false)

onMounted(() => {
  if (window.electronAPI) {
    const platform = window.electronAPI.getPlatform()
    isMac.value = platform === 'darwin'
  }
})

function minimizeWindow() {
  if (window.electronAPI) {
    window.electronAPI.minimizeWindow()
  }
}

function maximizeWindow() {
  if (window.electronAPI) {
    window.electronAPI.maximizeWindow()
  }
}

function closeWindow() {
  if (window.electronAPI) {
    window.electronAPI.closeWindow()
  }
}
</script>

<template>
  <div v-if="!isMac" class="window-controls">
    <button class="control-btn minimize" @click="minimizeWindow" title="最小化">
      <svg viewBox="0 0 10 10" width="10" height="10">
        <line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
    </button>
    <button class="control-btn maximize" @click="maximizeWindow" title="最大化">
      <svg viewBox="0 0 10 10" width="10" height="10">
        <rect x="1" y="1" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1.5"/>
      </svg>
    </button>
    <button class="control-btn close" @click="closeWindow" title="关闭">
      <svg viewBox="0 0 10 10" width="10" height="10">
        <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
    </button>
  </div>
</template>

<style scoped>
.window-controls {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  gap: 8px;
  z-index: 100;
}

.control-btn {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: #666;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: all 0.15s ease;
  -webkit-app-region: no-drag;
}

.control-btn:hover {
  background: rgba(0, 0, 0, 0.1);
}

.control-btn.minimize:hover {
  background: rgba(0, 0, 0, 0.15);
}

.control-btn.maximize:hover {
  background: rgba(0, 0, 0, 0.15);
}

.control-btn.close:hover {
  background: #e81123;
  color: white;
}

.control-btn:active {
  transform: scale(0.95);
}

.control-btn svg {
  opacity: 0.8;
}

.control-btn:hover svg {
  opacity: 1;
}
</style>
