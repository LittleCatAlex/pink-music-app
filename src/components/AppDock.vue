<script setup>
import { computed, ref, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { usePlaylistStore } from '../stores'
import { applyLiquidGlass, destroyLiquidGlass } from '../composables/useLiquidGlass'

const playlistStore = usePlaylistStore()
const dockTrackRef = ref(null)
let glassInstance = null

onMounted(async () => {
  await nextTick()
  if (dockTrackRef.value) {
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light'
    glassInstance = applyLiquidGlass(dockTrackRef.value, {
      depth: isDark ? 0.06 : 0.08,
      edgeSoftness: isDark ? 0.35 : 0.3,
      backdrop: isDark
        ? 'blur(3px) contrast(1.15) brightness(0.9) saturate(1.2)'
        : 'blur(2px) contrast(1.25) brightness(1.05) saturate(1.4)'
    })
  }
})

onBeforeUnmount(() => {
  if (glassInstance) {
    destroyLiquidGlass(glassInstance.id)
    glassInstance = null
  }
})

const dockItems = [
  {
    key: 'home',
    label: '首页',
    icon: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z'
  },
  {
    key: 'search',
    label: '搜索',
    icon: 'M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z'
  },
  {
    key: 'playlist',
    label: '歌单',
    icon: 'M3 10h11v2H3v-2zm0-4h11v2H3V6zm0 8h7v2H3v-2zm13.59-5.41L20 12l-3.41 3.41-1.41-1.41L17.17 12l-1.99-1.99 1.41-1.42z'
  },
  {
    key: 'mine',
    label: '我的',
    icon: 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'
  }
]

const activeView = computed(() => playlistStore.currentView)

function selectView(key) {
  if (key === 'playlist') {
    playlistStore.setCurrentPlaylist(null)
    playlistStore.setCurrentView('playlist')
  } else {
    playlistStore.setCurrentView(key)
  }
}
</script>

<template>
  <nav class="dock" aria-label="主导航">
    <div ref="dockTrackRef" class="dock-track" role="tablist">
      <button
        v-for="item in dockItems"
        :key="item.key"
        class="dock-item"
        :class="{ active: activeView === item.key }"
        :aria-label="item.label"
        :aria-selected="activeView === item.key"
        role="tab"
        @click="selectView(item.key)"
      >
        <span class="dock-icon">
          <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20" aria-hidden="true">
            <path :d="item.icon" />
          </svg>
        </span>
        <span class="dock-label">{{ item.label }}</span>
        <span class="dock-indicator" aria-hidden="true"></span>
      </button>
    </div>
  </nav>
</template>
