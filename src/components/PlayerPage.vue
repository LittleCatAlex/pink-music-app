<script setup>
import { onMounted, ref, watch, nextTick } from 'vue'
import { usePlayerStore, useSearchStore, usePlaylistStore, useLyricStore } from '@/stores'
import { useAudioPlayer } from '@/composables/useAudioPlayer'
import { parseDuration, fixCoverUrl } from '@/utils/bilibili'
import LyricDisplay from './LyricDisplay.vue'

const playerStore = usePlayerStore()
const searchStore = useSearchStore()
const playlistStore = usePlaylistStore()
const lyricStore = useLyricStore()
const { togglePlayPause, playPrevious, playNext, onProgressInput, onProgressChange } = useAudioPlayer()

// 拖动期间禁用 .progress-fill 的 0.1s transition
const isSeeking = ref(false)
function onSeekStart() { isSeeking.value = true }
function onSeekEnd() { isSeeking.value = false }

function closePlayerPage() {
  playerStore.setShowPlayerPage(false)
}

function seekTo(time) {
  const { audioInstance } = useAudioPlayer()
  if (audioInstance && !isNaN(time)) {
    audioInstance.currentTime = time
    playerStore.setCurrentTime(time)
  }
}

function playFromSeries(episode) {
  const player = usePlayerStore()
  const newTrack = {
    bvid: episode.bvid,
    cid: episode.cid,
    title: episode.title,
    author: episode.author || player.currentTrack?.author || '未知作者',
    cover: episode.cover || player.currentTrack?.cover,
    duration: episode.duration || 180
  }
  player.setCurrentTrack(newTrack)
}

async function togglePlaylistManager() {
  const player = usePlayerStore()
  if (!player.currentTrack) {
    player.setShowPlaylistManager(false)
    return
  }
  
  player.togglePlaylistManager()
  
  if (player.showPlaylistManager) {
    await player.loadVideoEpisodes(player.currentTrack.bvid)
  }
}

function playEpisode(episode) {
  const player = usePlayerStore()
  if (!player.currentTrack) return
  
  const episodeIndex = player.currentVideoEpisodes.findIndex(e => e.cid === episode.cid)
  if (episodeIndex >= 0) {
    player.setCurrentEpisodeIndex(episodeIndex)
  }
  
  const episodeTrack = {
    ...player.currentTrack,
    cid: episode.cid,
    title: episode.part || player.currentTrack.title,
    duration: episode.duration || player.currentTrack.duration
  }
  
  player.setCurrentTrack(episodeTrack)
}

onMounted(() => {
  nextTick(() => {
    const page = document.querySelector('.player-page')
    if (page) {
      page.classList.add('active')
    }
  })
})

watch(() => playerStore.showPlayerPage, (newVal) => {
  const page = document.querySelector('.player-page')
  if (page) {
    if (newVal) {
      page.classList.add('active')
    } else {
      page.classList.remove('active')
    }
  }
})
</script>

<template>
  <div v-if="playerStore.showPlayerPage" class="player-page">
    <div class="player-page-overlay" @click="closePlayerPage"></div>
    
    <div class="player-page-content">
      <button class="close-btn" @click="closePlayerPage">
        <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
          <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
        </svg>
      </button>

      <div class="track-header">
        <img 
          class="header-cover" 
          :src="fixCoverUrl(playerStore.currentTrack?.cover)" 
          @error="$event.target.src='https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=60'"
        >
        <div class="header-info">
          <div class="header-title">{{ playerStore.currentTrack?.title || '未选择曲目' }}</div>
          <div class="header-artist">{{ playerStore.currentTrack?.author || '' }}</div>
        </div>
      </div>

      <div class="lyric-area">
        <LyricDisplay :currentTime="playerStore.currentTime" :onSeek="seekTo" />
      </div>

      <div class="player-bottom-bar">
        <div class="player-controls-large">
          <button @click="playPrevious" class="control-btn-large">
            <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
          </button>
          <button @click="togglePlayPause" class="control-btn-large play-main">
            <svg v-if="playerStore.isPlaying" viewBox="0 0 24 24" fill="currentColor" width="28" height="28"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
            <svg v-else viewBox="0 0 24 24" fill="currentColor" width="28" height="28"><path d="M8 5v14l11-7z"/></svg>
          </button>
          <button @click="playNext" class="control-btn-large">
            <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
          </button>
        </div>

        <div class="progress-container-large">
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
              <div
                class="progress-fill"
                :style="{ width: (playerStore.duration > 0 ? (playerStore.currentTime / playerStore.duration) * 100 : 0) + '%' }"
              ></div>
              <div
                class="buffered-fill"
                :style="{ width: playerStore.bufferedProgress + '%' }"
              ></div>
            </div>
          </div>
          <span class="progress-time">{{ parseDuration(playerStore.duration) }}</span>
        </div>

        <div class="player-options">
          <button 
            @click="playerStore.togglePlayMode()" 
            class="option-btn" 
            :class="{ active: playerStore.playMode !== 'order' }" 
            :title="playerStore.getPlayModeLabel()"
          >
            <span class="mode-icon-large">{{ playerStore.getPlayModeIcon() }}</span>
          </button>
          <button @click="togglePlaylistManager" class="option-btn" title="分P列表">
            <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
              <path d="M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zM9 9h2v2H9V9zm0 4h2v2H9v-2zm4-4h2v2h-2V9zm0 4h2v2h-2v-2z"/>
            </svg>
          </button>
        </div>
      </div>

      <div v-if="playerStore.showSeriesPanel && playerStore.currentSeries" class="series-panel">
        <div class="series-header">
          <h3>{{ playerStore.currentSeries.title }}</h3>
          <button @click="playerStore.setShowSeriesPanel(false)" class="close-series-btn">
            <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
          </button>
        </div>
        <div class="series-list">
          <button 
            v-for="(episode, index) in playerStore.currentSeries.episodes" 
            :key="index"
            class="series-item"
            :class="{ active: playerStore.currentTrack?.cid === episode.cid }"
            @click="playFromSeries(episode)"
          >
            <span class="episode-number">{{ index + 1 }}</span>
            <span class="episode-title">{{ episode.title }}</span>
            <span class="episode-duration">{{ parseDuration(episode.duration) }}</span>
          </button>
        </div>
      </div>

      <div v-if="playerStore.showPlaylistManager" class="playlist-manager-panel">
        <div class="playlist-manager-header">
          <h3>分P列表</h3>
          <button @click="playerStore.setShowPlaylistManager(false)" class="close-playlist-btn">
            <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
          </button>
        </div>
        
        <div v-if="playerStore.isLoadingEpisodes" class="loading">
          <div class="loading-spinner"></div>
        </div>
        
        <div v-else-if="playerStore.currentVideoEpisodes.length === 0" class="empty-list">
          <p>暂无分P</p>
        </div>
        
        <div v-else class="episode-list">
          <button 
            v-for="(episode, index) in playerStore.currentVideoEpisodes" 
            :key="episode.cid"
            class="episode-item"
            :class="{ active: playerStore.currentEpisodeIndex === index }"
            @click="playEpisode(episode)"
          >
            <span class="episode-index">{{ index + 1 }}</span>
            <span class="episode-part">{{ episode.part }}</span>
            <span class="episode-duration-text">{{ parseDuration(episode.duration) }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.player-page {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.9);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.3s ease, visibility 0.3s ease;
}

.player-page.active {
  opacity: 1;
  visibility: visible;
}

.player-page-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}

.player-page-content {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  height: 100%;
  max-width: 800px;
  margin: 0 auto;
}

.close-btn {
  position: absolute;
  top: 16px;
  left: 16px;
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  padding: 8px;
  transition: color 0.2s;
  z-index: 10;
}

.close-btn:hover {
  color: white;
}

.lyric-area {
  width: 100%;
  flex: 1;
  min-height: 0;
  /* LyricDisplay 内部：200 viewport + 12 actions margin + 30 actions + 22 offset badge ≈ 264 */
  max-height: 280px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.track-header {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  max-width: 520px;
  padding: 10px 0 6px;
  flex-shrink: 0;
}

.header-cover {
  width: 44px;
  height: 44px;
  border-radius: 6px;
  object-fit: cover;
  flex-shrink: 0;
}

.header-info {
  min-width: 0;
}

.header-title {
  font-size: 15px;
  font-weight: 600;
  color: white;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.header-artist {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
  margin-top: 2px;
}

.player-bottom-bar {
  width: 100%;
  max-width: 520px;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 0 24px;
  flex-shrink: 0;
}

.player-controls-large {
  display: flex;
  align-items: center;
  gap: 24px;
  margin-bottom: 12px;
}

.control-btn-large {
  background: transparent;
  border: none;
  color: white;
  cursor: pointer;
  padding: 6px;
  transition: transform 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.control-btn-large:hover {
  transform: scale(1.1);
}

.control-btn-large.play-main {
  width: 48px;
  height: 48px;
  background: var(--primary-color);
  border-radius: 50%;
}

.control-btn-large.play-main:hover {
  transform: scale(1.05);
}

.progress-container-large {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  max-width: 480px;
  margin-bottom: 12px;
}

.progress-time {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  min-width: 36px;
  text-align: center;
}

.progress-bar-wrapper {
  flex: 1;
  position: relative;
  height: 4px;
}

.progress-slider {
  position: absolute;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
  z-index: 2;
}

.progress-bar {
  position: absolute;
  width: 100%;
  height: 100%;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 2px;
}

.progress-fill {
  position: absolute;
  height: 100%;
  background: var(--primary-color);
  border-radius: 2px;
  transition: width 0.1s linear;
}

.buffered-fill {
  position: absolute;
  height: 100%;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 2px;
  transition: width 0.1s linear;
}

.player-options {
  display: flex;
  gap: 20px;
}

.option-btn {
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  padding: 6px;
  transition: color 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.option-btn:hover {
  color: white;
}

.option-btn.active {
  color: var(--primary-color);
}

.mode-icon-large {
  font-size: 18px;
}

.series-panel,
.playlist-manager-panel {
  position: fixed;
  bottom: 0;
  left: 0;
  width: 100%;
  background: rgba(20, 20, 20, 0.95);
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  padding: 20px;
  max-height: 400px;
  overflow-y: auto;
  z-index: 20;
}

.series-header,
.playlist-manager-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.series-header h3,
.playlist-manager-header h3 {
  color: white;
  font-size: 18px;
  margin: 0;
}

.close-series-btn,
.close-playlist-btn {
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
}

.close-series-btn:hover,
.close-playlist-btn:hover {
  color: white;
}

.series-list,
.episode-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.series-item,
.episode-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  border: none;
  color: white;
  cursor: pointer;
  transition: background 0.2s;
  text-align: left;
}

.series-item:hover,
.episode-item:hover {
  background: rgba(255, 255, 255, 0.1);
}

.series-item.active,
.episode-item.active {
  background: var(--primary-color);
}

.episode-number,
.episode-index {
  width: 30px;
  font-size: 14px;
  color: rgba(255, 255, 255, 0.5);
}

.episode-title,
.episode-part {
  flex: 1;
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.episode-duration,
.episode-duration-text {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.5);
}

.empty-list {
  text-align: center;
  color: rgba(255, 255, 255, 0.5);
  padding: 20px;
}

.loading {
  display: flex;
  justify-content: center;
  padding: 20px;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid rgba(255, 255, 255, 0.2);
  border-top-color: var(--primary-color);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>