<script setup>
import { onMounted } from 'vue'
import { useSearchStore, useSettingsStore, useDownloadStore } from '@/stores'
import { useMusic } from '@/composables/useMusic'
import { useAudioPlayer } from '@/composables/useAudioPlayer'
import { parseDuration, formatPlayCount } from '@/utils/bilibili'
import { selectAudioInfo } from '@/utils/audio.js'

const searchStore = useSearchStore()
const settingsStore = useSettingsStore()
const downloadStore = useDownloadStore()
const { loadRecommendedMusic } = useMusic()
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

onMounted(() => {
  loadRecommendedMusic()
})
</script>

<template>
  <section class="home-section">
    <div class="hero-section">
      <h2 class="text-gradient">欢迎使用 Pink Music</h2>
      <p>从 B 站发现并播放你喜欢的音乐</p>
    </div>

    <div class="recommended-section">
      <h3>推荐音乐</h3>
      <div v-if="searchStore.isLoadingRecommended" class="loading">
        <div class="loading-spinner"></div>
        <p>加载中...</p>
      </div>
      <div v-else-if="searchStore.recommendedMusic.length === 0" class="loading">
        <p>暂无推荐音乐</p>
      </div>
      <div v-else class="card-grid">
        <div
          v-for="music in searchStore.recommendedMusic"
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
            <span v-if="music.rec_reason" class="rec-reason-badge">{{ music.rec_reason }}</span>
          </div>
          <h4 class="card-title">{{ music.title }}</h4>
          <p class="card-artist">{{ music.author }}</p>
          <div class="music-card-meta">
            <span>{{ formatPlayCount(music.playCount) }} 播放</span>
            <span>{{ parseDuration(music.duration) }}</span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
