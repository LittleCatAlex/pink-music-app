<script setup>
import { ref, computed, onMounted } from 'vue'
import { useUserStore, usePlayerStore, usePlaylistStore, useSettingsStore } from '../stores'
import { parseDuration } from '../utils/bilibili'

const userStore = useUserStore()
const playerStore = usePlayerStore()
const playlistStore = usePlaylistStore()
const settingsStore = useSettingsStore()

const activeTab = ref('profile')
const cacheSize = ref(0)
const isCalculatingCache = ref(false)
const isClearingCache = ref(false)
const downloadDirectory = ref('')
const showClearCacheConfirm = ref(false)

const tabs = [
  { key: 'profile', label: '我的' },
  { key: 'history', label: '历史' },
  { key: 'settings', label: '设置' }
]

const playHistory = computed(() => playerStore.playHistory || [])
const hasUser = computed(() => !!userStore.userInfo)

function formatFileSize(bytes) {
  if (!bytes) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i]
}

async function calculateCacheSize() {
  if (!window.electronAPI) return
  isCalculatingCache.value = true
  try {
    const result = await window.electronAPI.getCacheSize()
    if (result.code === 0) {
      cacheSize.value = result.size
    }
  } catch (error) {
    console.error('计算缓存大小失败:', error)
  } finally {
    isCalculatingCache.value = false
  }
}

async function clearCache() {
  if (!window.electronAPI) return
  isClearingCache.value = true
  try {
    const result = await window.electronAPI.clearCache()
    if (result.code === 0) {
      cacheSize.value = 0
    }
  } catch (error) {
    console.error('清理缓存失败:', error)
  } finally {
    isClearingCache.value = false
    showClearCacheConfirm.value = false
  }
}

async function selectDownloadDirectory() {
  if (!window.electronAPI) return
  try {
    const result = await window.electronAPI.selectDownloadDirectory()
    if (result.code === 0) {
      downloadDirectory.value = result.path
      await window.electronAPI.setDownloadDirectory(result.path)
    }
  } catch (error) {
    console.error('选择下载目录失败:', error)
  }
}

async function getCurrentDownloadDirectory() {
  if (!window.electronAPI) return
  try {
    const result = await window.electronAPI.getDownloadDirectory()
    if (result.code === 0) {
      downloadDirectory.value = result.path
    }
  } catch (error) {
    console.error('获取下载目录失败:', error)
  }
}

function clearPlayHistory() {
  playerStore.clearPlayHistory()
}

function playFromHistory(music) {
  playerStore.setShowPlayerPage(true)
  // 派发自定义事件让父组件播放
  const evt = new CustomEvent('pink-music:play-track', { detail: music })
  window.dispatchEvent(evt)
}

function openLogin() {
  // 通知父组件打开登录面板
  window.dispatchEvent(new CustomEvent('pink-music:open-login'))
}

async function handleSyncFavorites() {
  if (!userStore.isLoggedIn || !userStore.userInfo?.mid) {
    alert('请先登录 B 站账号')
    return
  }
  const added = await userStore.syncFavorites(playlistStore)
  if (added === 0) {
    alert('收藏夹已为最新或没有可同步的项')
  } else {
    alert(`已同步 ${added} 个收藏夹到我的歌单`)
  }
}

function openGitHub() {
  if (window.electronAPI) {
    window.electronAPI.openGitHub()
  }
}

function openDownloadManager() {
  // 通过全局事件打开下载管理器
  const evt = new CustomEvent('pink-music:open-download')
  window.dispatchEvent(evt)
}

defineExpose({
  setActiveTab(tab) {
    activeTab.value = tab
  }
})

onMounted(() => {
  getCurrentDownloadDirectory()
  calculateCacheSize()
})
</script>

<template>
  <section class="mine-view">
    <div class="mine-header">
      <h2 class="mine-title text-gradient">我的</h2>
      <div class="mine-tabs" role="tablist">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          class="mine-tab"
          :class="{ active: activeTab === tab.key }"
          @click="activeTab = tab.key"
          role="tab"
          :aria-selected="activeTab === tab.key"
        >
          {{ tab.label }}
        </button>
      </div>
    </div>

    <!-- 我的 标签 -->
    <div v-if="activeTab === 'profile'" class="mine-content">
      <div class="profile-card glass-card">
        <div v-if="hasUser" class="profile-info">
          <img
            :src="userStore.userInfo.face"
            class="profile-avatar"
            :alt="userStore.userInfo.uname"
            @error="$event.target.style.display='none'"
          />
          <div class="profile-detail">
            <h3>{{ userStore.userInfo.uname }}</h3>
            <p>UID: {{ userStore.userInfo.mid }}</p>
            <div class="profile-actions">
              <button class="btn-primary" @click="openLogin">切换账号</button>
              <button class="btn-secondary" @click="handleSyncFavorites">同步收藏夹</button>
            </div>
          </div>
        </div>
        <div v-else class="profile-empty">
          <div class="profile-avatar profile-avatar-placeholder">
            <svg viewBox="0 0 24 24" fill="currentColor" width="32" height="32">
              <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
            </svg>
          </div>
          <div class="profile-detail">
            <h3>未登录</h3>
            <p>登录后可同步你的 B 站收藏夹</p>
            <div class="profile-actions">
              <button class="btn-primary" @click="openLogin">登录 B 站</button>
            </div>
          </div>
        </div>
      </div>

      <div class="quick-actions">
        <button class="quick-action glass-card" @click="activeTab = 'history'">
          <div class="quick-icon">
            <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
              <path d="M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/>
            </svg>
          </div>
          <div class="quick-info">
            <h4>播放历史</h4>
            <p>{{ playHistory.length }} 首</p>
          </div>
        </button>

        <button class="quick-action glass-card" @click="activeTab = 'settings'">
          <div class="quick-icon">
            <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
              <path d="M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.39-1.08-.7-1.66-.94l-.38-2.65c-.03-.24-.24-.42-.48-.42h-4c-.24 0-.45.18-.48.42l-.38 2.65c-.58.24-1.14.55-1.66.94l-2.49-1c-.22-.08-.49 0-.61.22l-2 3.46c-.12.22-.07.49.12.64l2.11 1.65c-.04.32-.07.64-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.39 1.08.7 1.66.94l.38 2.65c.03.24.24.42.48.42h4c.24 0 .45-.18.48-.42l.38-2.65c.58-.24 1.14-.55 1.66-.94l2.49 1c.22.08.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zm-7.43 2.52c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/>
            </svg>
          </div>
          <div class="quick-info">
            <h4>设置</h4>
            <p>主题、音质、缓存</p>
          </div>
        </button>

        <button class="quick-action glass-card" @click="openDownloadManager">
          <div class="quick-icon">
            <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
              <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
            </svg>
          </div>
          <div class="quick-info">
            <h4>下载管理</h4>
            <p>管理已下载音乐</p>
          </div>
        </button>
      </div>
    </div>

    <!-- 历史 标签 -->
    <div v-else-if="activeTab === 'history'" class="mine-content">
      <div class="history-header">
        <h3>播放历史</h3>
        <button v-if="playHistory.length > 0" class="btn-secondary" @click="clearPlayHistory">
          清空历史
        </button>
      </div>
      <div v-if="playHistory.length === 0" class="empty-state">
        <p>暂无播放历史</p>
      </div>
      <div v-else class="history-list">
        <div
          v-for="(music, index) in playHistory"
          :key="`${music.bvid}-${index}`"
          class="history-item glass-card"
          @click="playFromHistory(music)"
        >
          <span class="history-index">{{ index + 1 }}</span>
          <img
            :src="music.cover"
            :alt="music.title"
            class="history-cover"
            @error="$event.target.src='https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=100'"
          />
          <div class="history-info">
            <h4>{{ music.title }}</h4>
            <p>{{ music.author }}</p>
          </div>
          <span class="history-duration">{{ parseDuration(music.duration) }}</span>
        </div>
      </div>
    </div>

    <!-- 设置 标签 -->
    <div v-else-if="activeTab === 'settings'" class="mine-content">
      <div class="settings-section glass-card">
        <h3>播放设置</h3>
        <div class="setting-item">
          <label>默认播放音质</label>
          <select
            v-model="settingsStore.audioQuality"
            @change="settingsStore.setAudioQuality(settingsStore.audioQuality)"
            class="quality-select"
          >
            <option value="auto">自动（最高可用）</option>
            <option value="lossless">无损</option>
            <option value="high">高音质</option>
            <option value="medium">中音质</option>
            <option value="low">低音质</option>
          </select>
        </div>
      </div>

      <div class="settings-section glass-card">
        <h3>下载设置</h3>
        <div class="setting-item">
          <label>下载目录</label>
          <div class="setting-value">
            <span class="path-text">{{ downloadDirectory || '未设置' }}</span>
            <button class="btn-secondary" @click="selectDownloadDirectory">浏览</button>
          </div>
        </div>
      </div>

      <div class="settings-section glass-card">
        <h3>缓存管理</h3>
        <div class="setting-item">
          <label>当前缓存大小</label>
          <div class="setting-value">
            <span v-if="isCalculatingCache" class="loading-text">计算中...</span>
            <span v-else>{{ formatFileSize(cacheSize) }}</span>
            <button
              class="btn-danger"
              @click="showClearCacheConfirm = true"
              :disabled="isClearingCache"
            >
              {{ isClearingCache ? '清理中...' : '清理缓存' }}
            </button>
          </div>
        </div>
      </div>

      <div class="settings-section glass-card">
        <h3>关于</h3>
        <div class="about-content">
          <div class="about-header">
            <span class="logo-text">Pink Music</span>
            <span class="version">v2.0.1</span>
          </div>
          <p class="about-desc">一款优雅的 B 站音乐播放器，让你发现并享受喜欢的音乐。</p>
          <button class="btn-secondary" @click="openGitHub">
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
            GitHub
          </button>
          <p class="developer-info">Developed by Rayson Liu</p>
        </div>
      </div>
    </div>

    <!-- 清理缓存确认 -->
    <div v-if="showClearCacheConfirm" class="modal-overlay" @click="showClearCacheConfirm = false">
      <div class="modal small-modal" @click.stop>
        <h2>确认清理缓存</h2>
        <p>清理缓存将删除所有已下载的音频文件和应用缓存，此操作不可恢复。</p>
        <div class="modal-buttons">
          <button class="btn-secondary" @click="showClearCacheConfirm = false">取消</button>
          <button class="btn-danger" @click="clearCache">确认清理</button>
        </div>
      </div>
    </div>
  </section>
</template>
