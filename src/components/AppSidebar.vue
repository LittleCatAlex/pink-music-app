<script setup>
import { ref } from 'vue'
import { usePlaylistStore, usePlayerStore, useSettingsStore } from '@/stores'
import { appConfirm } from '@/utils/confirm'

const playlistStore = usePlaylistStore()
const playerStore = usePlayerStore()
const settingsStore = useSettingsStore()

const newPlaylistName = ref('')

function goToHome() {
  playlistStore.setCurrentView('home')
}

function goToSearch() {
  playlistStore.setCurrentView('search')
}

function goToPlaylist(playlist) {
  playlistStore.setCurrentPlaylist(playlist)
  playlistStore.setCurrentView('playlist')
}

function createPlaylist() {
  playlistStore.setShowCreatePlaylistModal(true)
  newPlaylistName.value = ''
}

function confirmCreatePlaylist() {
  const name = newPlaylistName.value.trim()
  if (!name) return
  // 用 store 的统一 createPlaylist，id 走稳定生成器（Date.now+random），避免快速连点冲突
  playlistStore.createPlaylist(name)
  playlistStore.savePlaylists()
  playlistStore.setShowCreatePlaylistModal(false)
}

function cancelCreatePlaylist() {
  playlistStore.setShowCreatePlaylistModal(false)
  newPlaylistName.value = ''
}

function exportPlaylist(playlist) {
  if (!playlist) return
  const dataStr = JSON.stringify(playlist, null, 2)
  const blob = new Blob([dataStr], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${playlist.name || '歌单'}.json`
  a.click()
  URL.revokeObjectURL(url)
}

function importPlaylist() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json'
  input.onchange = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target.result)
        if (imported.name && Array.isArray(imported.music)) {
          // 用统一 createPlaylist，id 走稳定生成器
          playlistStore.createPlaylist(imported.name, {
            cover: imported.cover || '',
            music: imported.music
          })
          playlistStore.savePlaylists()
        }
      } catch (error) {
        console.error('导入歌单失败:', error)
      }
    }
    reader.readAsText(file)
  }
  input.click()
}

function openDownloadFolder() {
  if (window.electronAPI) {
    window.electronAPI.openDownloadFolder()
  }
}

function deletePlaylist(playlist) {
  if (!playlist || playlist.isDefault) return
  const songCount = playlist.music?.length || playlist.media_count || 0
  // B 站同步的收藏夹删的是本地副本，B 站云端不受影响——文案上明确告知
  const extra = playlist.isBiliFavorite ? '（仅删除本地副本，不会影响 B 站云端）' : ''
  const detail = `该歌单包含 ${songCount} 首音乐，此操作不可恢复。${extra}`
  const ok = await appConfirm({
    title: '删除歌单',
    message: `确定要删除歌单「${playlist.name}」吗？`,
    detail,
    confirmText: '删除',
    cancelText: '取消'
  })
  if (!ok) return
  playlistStore.deletePlaylist(playlist.id)
  // 通知父组件（App.vue）兜底处理「如果删的是当前正在查看的歌单则跳回列表」
  // 侧边栏自己拿不到 currentPlaylist 的实时值，交给 App.vue 统一管理
  window.dispatchEvent(new CustomEvent('pink-music:playlist-deleted', { detail: { id: playlist.id } }))
}
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar-header">
      <h1 class="logo">Pink Music</h1>
    </div>

    <nav>
      <button class="nav-item" @click="goToHome" :class="{ active: playlistStore.currentView === 'home' }">
        <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>
        <span>首页</span>
      </button>

      <button class="nav-item" @click="goToSearch" :class="{ active: playlistStore.currentView === 'search' }">
        <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
        <span>搜索</span>
      </button>

      <div class="nav-section">
        <h3>我的歌单</h3>
        <div class="playlist-nav-buttons">
          <button class="nav-item" @click="createPlaylist">
            <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
            <span>创建</span>
          </button>
          <button class="nav-item" @click="importPlaylist">
            <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z"/></svg>
            <span>导入</span>
          </button>
        </div>
        <button class="nav-item" @click="openDownloadFolder">
          <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>
          <span>下载</span>
        </button>
        
        <button 
          v-for="playlist in playlistStore.userPlaylists" 
          :key="playlist.id" 
          class="playlist-item" 
          @click="goToPlaylist(playlist)" 
          :class="{ playing: playlistStore.currentPlaylist?.id === playlist.id && playlistStore.currentView === 'playlist', default: playlist.isDefault }"
        >
          <span>{{ playlist.name }}</span>
          <span class="playlist-count">{{ playlist.music?.length || 0 }}</span>
          <button v-if="!playlist.isDefault" class="delete-playlist-btn" @click.stop="deletePlaylist(playlist)" title="删除歌单">
            <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
          </button>
        </button>

        <div class="nav-section">
          <div class="section-header">
            <h3>播放历史</h3>
            <button v-if="playerStore.playHistory.length > 0" class="refresh-btn" @click="playerStore.clearPlayHistory()" title="清空历史">
              <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
              </svg>
            </button>
          </div>
          <button v-if="playerStore.playHistory.length === 0" class="playlist-item disabled">
            <span>暂无播放历史</span>
          </button>
          <button v-for="(music, index) in playerStore.playHistory.slice(0, 5)" :key="music.bvid" class="playlist-item">
            <span class="text-truncate">{{ music.title }}</span>
            <span class="playlist-count">{{ index + 1 }}</span>
          </button>
          <div v-if="playerStore.playHistory.length > 5" class="history-more">
            <span>还有 {{ playerStore.playHistory.length - 5 }} 首</span>
          </div>
        </div>
      </div>
    </nav>

    <div class="sidebar-footer">
      <button class="nav-item settings-btn" @click="settingsStore.setShowSettings(true)" title="设置">
        <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.39-1.08-.7-1.66-.94l-.38-2.65c-.03-.24-.24-.42-.48-.42h-4c-.24 0-.45.18-.48.42l-.38 2.65c-.58.24-1.14.55-1.66.94l-2.49-1c-.22-.08-.49 0-.61.22l-2 3.46c-.12.22-.07.49.12.64l2.11 1.65c-.04.32-.07.64-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.39 1.08.7 1.66.94l.38 2.65c.03.24.24.42.48.42h4c.24 0 .45-.18.48-.42l.38-2.65c.58-.24 1.14-.55 1.66-.94l2.49 1c.22.08.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zm-7.43 2.52c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/></svg>
        <span>设置</span>
      </button>
    </div>

    <div v-if="playlistStore.showCreatePlaylistModal" class="modal-overlay" @click.self="cancelCreatePlaylist">
      <div class="modal-content">
        <h3>创建新歌单</h3>
        <input 
          v-model="newPlaylistName" 
          type="text" 
          placeholder="歌单名称" 
          class="modal-input"
          @keyup.enter="confirmCreatePlaylist"
        />
        <div class="modal-buttons">
          <button @click="cancelCreatePlaylist" class="btn btn-secondary">取消</button>
          <button @click="confirmCreatePlaylist" class="btn btn-primary">创建</button>
        </div>
      </div>
    </div>
  </aside>
</template>
