<script setup>
import { computed, ref, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { usePlaylistStore } from '../stores'
import { applyLiquidGlass, destroyLiquidGlass } from '../composables/useLiquidGlass'
import { t } from '../i18n'

const playlistStore = usePlaylistStore()
const dockTrackRef = ref(null)
let glassInstance = null

// Liquid Glass 的 <filter> 区域在创建时按当时尺寸固化，尺寸变了要重建，
// 否则超出旧尺寸的那一段不再走玻璃滤镜（顶栏右侧矩形遮罩即由此产生）。
let glassResizeObserver = null
let glassResyncTimer = null

function applyTrackGlass() {
  const el = dockTrackRef.value
  if (!el) return
  if (glassInstance) {
    destroyLiquidGlass(glassInstance.id)
    glassInstance = null
  }
  const isDark = document.documentElement.getAttribute('data-theme') !== 'light'
  glassInstance = applyLiquidGlass(el, {
    width: el.offsetWidth,
    height: el.offsetHeight,
    depth: isDark ? 0.06 : 0.08,
    edgeSoftness: isDark ? 0.35 : 0.3,
    backdrop: isDark
      ? 'blur(3px) contrast(1.15) brightness(0.9) saturate(1.2)'
      : 'blur(2px) contrast(1.25) brightness(1.05) saturate(1.4)'
  })
}

function scheduleGlassResync() {
  const el = dockTrackRef.value
  if (!el) return
  if (glassInstance && glassInstance.width === el.offsetWidth && glassInstance.height === el.offsetHeight) return
  clearTimeout(glassResyncTimer)
  glassResyncTimer = setTimeout(() => {
    const target = dockTrackRef.value
    if (!target) return
    if (glassInstance && glassInstance.width === target.offsetWidth && glassInstance.height === target.offsetHeight) return
    applyTrackGlass()
  }, 180)
}

onMounted(async () => {
  await nextTick()
  applyTrackGlass()
  if (dockTrackRef.value && typeof ResizeObserver !== 'undefined') {
    glassResizeObserver = new ResizeObserver(() => scheduleGlassResync())
    glassResizeObserver.observe(dockTrackRef.value)
  }
})

onBeforeUnmount(() => {
  clearTimeout(glassResyncTimer)
  if (glassResizeObserver) {
    glassResizeObserver.disconnect()
    glassResizeObserver = null
  }
  if (glassInstance) {
    destroyLiquidGlass(glassInstance.id)
    glassInstance = null
  }
})

const dockItems = computed(() => [
  {
    key: 'home',
    label: t('nav.discover', '发现'),
    icon: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z'
  },
  {
    key: 'search',
    label: t('topbar.search', '搜索'),
    icon: 'M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z'
  },
  {
    key: 'playlist',
    label: t('nav.playlists', '歌单'),
    icon: 'M3 10h11v2H3v-2zm0-4h11v2H3V6zm0 8h7v2H3v-2zm13.59-5.41L20 12l-3.41 3.41-1.41-1.41L17.17 12l-1.99-1.99 1.41-1.42z'
  },
  {
    key: 'local',
    label: t('nav.local', '本地'),
    icon: 'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z'
  },
  {
    key: 'mine',
    label: t('nav.library', '我的'),
    icon: 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'
  }
])

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
        <div class="dock-icon-wrapper">
          <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
            <path :d="item.icon" />
          </svg>
        </div>
        <span class="dock-label">{{ item.label }}</span>
      </button>
    </div>
  </nav>
</template>

<style scoped>
.dock {
  position: fixed;
  bottom: 92px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 90;
  pointer-events: none;
}

.dock-track {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: var(--radius-full);
  background: var(--bg-card);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid var(--border-color);
  box-shadow: var(--shadow-dock);
}

.dock-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 6px 12px;
  border-radius: var(--radius-md);
  color: var(--text-tertiary);
  transition: all var(--duration-fast) var(--ease-spring);
  min-width: 48px;
}

.dock-item:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
  transform: translateY(-2px);
}

.dock-item.active {
  color: var(--accent-color);
  background: var(--accent-light);
}

.dock-icon-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
}

.dock-label {
  font-size: 11px;
  font-weight: 500;
  line-height: 1;
}
</style>
