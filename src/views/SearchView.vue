<script setup>
import { useSearchStore, useSettingsStore, useDownloadStore } from '@/stores'
import { useMusic } from '@/composables/useMusic'
import { useAudioPlayer } from '@/composables/useAudioPlayer'
import { parseDuration, formatPlayCount } from '@/utils/bilibili'
import { selectAudioInfo } from '@/utils/audio.js'

const searchStore = useSearchStore()
const settingsStore = useSettingsStore()
const downloadStore = useDownloadStore()
const { handleSearch } = useMusic()
const { playMusic } = useAudioPlayer()

async function downloadMusic(music) {
  try {
    let musicInfoResult
    if (!music.cid) {
      musicInfoResult = await window.electronAPI.getMusicInfo(music.bvid)
      if (musicInfoResult.code !== 0) {
        throw new Error('获取音乐信息失败')
      }
    }
    const cid = music.cid || musicInfoResult?.data?.cid

    const playUrlResult = await window.electronAPI.getMusicPlayUrl(music.bvid, cid)
    if (playUrlResult.code !== 0) {
      throw new Error('获取播放地址失败')
    }

    const audioUrl = selectAudioUrl(playUrlResult.data, settingsStore.audioQuality)
    if (!audioUrl) {
      throw new Error('未找到音频地址')
    }

    downloadStore.setShowDownloadManager(true)
    await downloadStore.addTask({
      audioUrl,
      fileName: `${music.title} - ${music.author}`,
      bvid: music.bvid,
      cid,
      title: music.title,
      author: music.author,
      quality: settingsStore.audioQuality
    })
  } catch (error) {
    console.error('下载音乐失败:', error)
    alert('下载失败：' + error.message)
  }
}
</script>

<template>
  <section class="search-section">
    <div class="header">
      <div class="search-box">
        <input 
          v-model="searchStore.searchQuery" 
          type="text" 
          placeholder="搜索音乐..." 
          @keyup.enter="handleSearch"
        />
        <button @click="handleSearch">
          <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
        </button>
      </div>
    </div>

    <div v-if="searchStore.isLoadingSearch" class="loading">
      <div class="loading-spinner"></div>
      <p>搜索中...</p>
    </div>
    <div v-else-if="searchStore.isSearching && searchStore.searchResults.length === 0" class="loading">
      <p>未找到相关音乐</p>
    </div>
    <div v-else-if="searchStore.isSearching" class="card-grid">
      <div 
        v-for="music in searchStore.searchResults" 
        :key="music.bvid" 
        class="music-card" 
        @click="playMusic(music)"
      >
        <div class="card-cover">
          <img :src="music.cover" :alt="music.title" @error="$event.target.src='https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=400'">
          <div class="play-overlay">
            <button class="play-button" @click.stop="playMusic(music)">
              <svg viewBox="0 0 24 24" fill="white" width="24" height="24"><path d="M8 5v14l11-7z"/></svg>
            </button>
            <button class="download-button" @click.stop="downloadMusic(music)" title="下载">
              <svg viewBox="0 0 24 24" fill="white" width="18" height="18"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
            </button>
          </div>
        </div>
        <h4 class="card-title">{{ music.title }}</h4>
        <p class="card-artist">{{ music.author }}</p>
        <div class="music-card-meta">
          <span>{{ formatPlayCount(music.playCount) }} 播放</span>
          <span>{{ parseDuration(music.duration) }}</span>
        </div>
      </div>
    </div>
  </section>
</template>
