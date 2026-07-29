<script setup>
import { ref } from 'vue'
import { usePlayerStore, usePlaylistStore } from '@/stores'
import { useAudioPlayer } from '@/composables/useAudioPlayer'
import { parseDuration } from '@/utils/bilibili'

const playerStore = usePlayerStore()
const playlistStore = usePlaylistStore()
const { togglePlayPause, playPrevious, playNext, onProgressInput, onProgressChange } = useAudioPlayer()

// 拖动期间禁用 .progress-fill 的 0.1s transition，避免进度条追不上手指
const isSeeking = ref(false)
function onSeekStart() { isSeeking.value = true }
function onSeekEnd() { isSeeking.value = false }

function openPlayerPage() {
  playerStore.setShowPlayerPage(true)
}

function openAddToPlaylist() {
  if (playerStore.currentTrack) {
    playlistStore.setShowAddToPlaylistModal(true)
  }
}

function addToPlaylist(playlist) {
  if (!playerStore.currentTrack || !playlist) return
  // store 签名是 addToPlaylist(music, targetPlaylist)，注意参数顺序
  playlistStore.addToPlaylist(playerStore.currentTrack, playlist)
  playlistStore.setShowAddToPlaylistModal(false)
}
</script>

<template>
  <div v-if="playerStore.currentTrack" class="player-bar">
    <div class="current-track">
      <button class="current-cover-btn" @click="openPlayerPage">
        <img :src="playerStore.currentTrack.cover" :alt="playerStore.currentTrack.title" class="current-cover" @error="$event.target.src='https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=400'">
        <div class="cover-overlay">
          <svg viewBox="0 0 24 24" fill="white" width="24" height="24"><path d="M8 5v14l11-7z"/></svg>
        </div>
      </button>
      <div class="current-info">
        <h4>{{ playerStore.currentTrack.title }}</h4>
        <p>{{ playerStore.currentTrack.author }}</p>
      </div>
    </div>

    <div class="player-controls">
      <div class="control-buttons">
        <button @click="playerStore.togglePlayMode()" class="control-btn mode-btn" :class="{ active: playerStore.playMode !== 'order' }" :title="playerStore.getPlayModeLabel()">
          <span class="mode-icon">{{ playerStore.getPlayModeIcon() }}</span>
        </button>
        <button @click="playPrevious" class="control-btn">
          <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
        </button>
        <button @click="togglePlayPause" class="control-btn play">
          <svg v-if="playerStore.isPlaying" viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
          <svg v-else viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M8 5v14l11-7z"/></svg>
        </button>
        <button @click="playNext" class="control-btn">
          <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
        </button>
      </div>

      <div class="progress-container">
        <span class="progress-time">{{ parseDuration(playerStore.currentTime) }}</span>
        <div class="progress-bar-wrapper" :class="{ seeking: isSeeking }">
          <input
            type="range"
            min="0"
            :max="playerStore.duration || 100"
            :value="playerStore.currentTime"
            @input="onProgressInput"
            @change="onProgressChange"
            @pointerdown="onSeekStart"
            @pointerup="onSeekEnd"
            @pointercancel="onSeekEnd"
            class="progress-slider"
          />
          <div class="progress-bar">
            <div class="progress-fill" :style="{ width: (playerStore.duration > 0 ? (playerStore.currentTime / playerStore.duration) * 100 : 0) + '%' }"></div>
          </div>
        </div>
        <span class="progress-time">{{ parseDuration(playerStore.duration) }}</span>
      </div>
    </div>

    <div class="player-actions">
      <button @click="openAddToPlaylist" class="action-btn" title="添加到歌单">
        <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
      </button>
    </div>
  </div>

  <div v-if="playlistStore.showAddToPlaylistModal" class="modal-overlay" @click.self="playlistStore.setShowAddToPlaylistModal(false)">
    <div class="modal-content">
      <h3>添加到歌单</h3>
      <div class="playlist-list">
        <button 
          v-for="playlist in playlistStore.userPlaylists" 
          :key="playlist.id" 
          class="playlist-option" 
          @click="addToPlaylist(playlist)"
        >
          <span>{{ playlist.name }}</span>
          <span class="count">{{ playlist.music?.length || 0 }} 首</span>
        </button>
      </div>
      <button @click="playlistStore.setShowAddToPlaylistModal(false)" class="btn btn-secondary" style="width:100%;">取消</button>
    </div>
  </div>
</template>
