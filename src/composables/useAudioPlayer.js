import { usePlayerStore, usePlaylistStore, useSearchStore, useSettingsStore } from '@/stores'
import {
  getAudioEl,
  getPlaybackRuntime,
  bindPlaybackRuntime,
  playWithResolvedSrc,
  pauseAudio,
  playAudio,
  seekAudio,
  updateMediaSession,
  setupMediaSessionHandlers,
  prefetchTrack,
  resolvePlayUrl
} from '@/utils/audioEngine'
import logger from '@/utils/logger'

/**
 * 统一播放控制入口。
 * App.vue 通过 registerHostPlayback 注册完整 playMusic / handleTrackEnd，
 * 播放栏与 Media Session 都操作同一个 Audio 实例。
 */
export function useAudioPlayer() {
  const playerStore = usePlayerStore()
  const playlistStore = usePlaylistStore()
  const searchStore = useSearchStore()
  const settingsStore = useSettingsStore()

  getAudioEl()

  function getRandomIndex(max) {
    return Math.floor(Math.random() * max)
  }

  function getActiveMusicList() {
    let musicList = playlistStore.currentView === 'search'
      ? searchStore.searchResults
      : searchStore.recommendedMusic
    if (playlistStore.currentPlaylist?.music) {
      musicList = playlistStore.currentPlaylist.music
    }
    return musicList
  }

  function getNextMusicIndex() {
    const musicList = getActiveMusicList()
    if (!musicList || musicList.length === 0) return -1
    const currentIndex = musicList.findIndex(m => m.bvid === playerStore.currentTrack?.bvid)

    switch (playerStore.playMode) {
      case 'single':
        return currentIndex >= 0 ? currentIndex : 0
      case 'shuffle': {
        let nextIndex
        do {
          nextIndex = getRandomIndex(musicList.length)
        } while (musicList.length > 1 && nextIndex === currentIndex)
        return nextIndex
      }
      case 'loop':
        return currentIndex >= 0 ? (currentIndex + 1) % musicList.length : 0
      case 'order':
      default:
        if (currentIndex >= 0 && currentIndex < musicList.length - 1) {
          return currentIndex + 1
        }
        return -1
    }
  }

  function prefetchNext() {
    const nextIndex = getNextMusicIndex()
    const musicList = getActiveMusicList()
    if (nextIndex >= 0 && musicList?.[nextIndex]) {
      prefetchTrack(musicList[nextIndex], settingsStore.audioQuality)
    }
  }

  async function playMusic(music) {
    const hostPlay = getPlaybackRuntime().playMusic
    if (typeof hostPlay === 'function') {
      return hostPlay(music)
    }

    try { pauseAudio() } catch (_) {}

    playerStore.setCurrentTrack(music)
    playerStore.setIsPlaying(false)
    playerStore.setIsAudioLoading(true)
    playerStore.setAudioError('')
    playerStore.setDuration(music.duration || 180)
    playerStore.setCurrentTime(0)
    playerStore.setBufferedProgress(0)

    try {
      await playWithResolvedSrc(music, settingsStore.audioQuality)
      playerStore.setIsPlaying(true)
      playerStore.setIsAudioLoading(false)
      updateMediaSession(music, true)
      prefetchNext()
    } catch (error) {
      logger.warn('[useAudioPlayer] play failed:', error?.message)
      playerStore.setIsAudioLoading(false)
    }
  }

  /** App.vue 启动时调用：绑定完整播放链路到共享引擎 */
  function registerHostPlayback({ playMusic: hostPlay, handleTrackEnd: hostEnd }) {
    bindPlaybackRuntime({
      playMusic: hostPlay,
      handleTrackEnd: hostEnd,
      onEnded: () => {
        playerStore.setIsPlaying(false)
        updateMediaSession(playerStore.currentTrack, false)
        if (typeof hostEnd === 'function') hostEnd()
      },
      onError: () => {
        playerStore.setAudioError('音频加载失败')
        playerStore.setIsAudioLoading(false)
        playerStore.setIsPlaying(false)
      },
      onLoadedMetadata: (el) => {
        const dur = el.duration || playerStore.currentTrack?.duration || 180
        playerStore.setDuration(dur)
        playerStore.setIsAudioLoading(false)
      },
      onCanPlay: () => {
        playerStore.setIsAudioLoading(false)
        playerStore.setBufferedProgress(100)
      },
      onTime: (time, buf, flags) => {
        if (flags?.syncStore) {
          playerStore.setCurrentTime(time)
        }
        if (flags?.bufChanged) {
          playerStore.setBufferedProgress(buf)
        }
      }
    })
  }

  function togglePlayPause() {
    const audio = getAudioEl()
    if (!audio.src && !playerStore.currentTrack) return
    if (playerStore.isPlaying) {
      pauseAudio()
      playerStore.setIsPlaying(false)
    } else {
      Promise.resolve(playAudio()).then(() => {
        playerStore.setIsPlaying(true)
      }).catch(() => {
        playerStore.setIsPlaying(false)
      })
    }
    updateMediaSession(playerStore.currentTrack, !playerStore.isPlaying)
  }

  function playPrevious() {
    const musicList = getActiveMusicList()
    if (!musicList.length) return
    const currentIndex = musicList.findIndex(m => m.bvid === playerStore.currentTrack?.bvid)
    let prevIndex
    if (playerStore.playMode === 'shuffle') {
      do {
        prevIndex = getRandomIndex(musicList.length)
      } while (musicList.length > 1 && prevIndex === currentIndex)
    } else {
      prevIndex = currentIndex > 0 ? currentIndex - 1 : musicList.length - 1
    }
    if (musicList[prevIndex]) playMusic(musicList[prevIndex])
  }

  function playNext() {
    const nextIndex = getNextMusicIndex()
    const musicList = getActiveMusicList()
    if (nextIndex >= 0 && musicList?.[nextIndex]) {
      playMusic(musicList[nextIndex])
    }
  }

  function onProgressInput(event) {
    const newTime = parseFloat(event.target.value)
    if (!Number.isNaN(newTime)) {
      seekAudio(newTime)
      playerStore.setCurrentTime(newTime)
    }
  }

  function onProgressChange(event) {
    const newTime = parseFloat(event.target.value)
    if (!Number.isNaN(newTime)) {
      seekAudio(newTime)
      playerStore.setCurrentTime(newTime)
    }
  }

  function ensureMediaSessionHandlers() {
    setupMediaSessionHandlers({
      onPlay: togglePlayPause,
      onPause: togglePlayPause,
      onNext: playNext,
      onPrev: playPrevious
    })
  }

  return {
    get audioInstance() { return getAudioEl() },
    playMusic,
    togglePlayPause,
    playPrevious,
    playNext,
    onProgressInput,
    onProgressChange,
    registerHostPlayback,
    ensureMediaSessionHandlers,
    prefetchNext,
    resolvePlayUrl
  }
}

export { bindPlaybackRuntime, getAudioEl, prefetchTrack, resolvePlayUrl }
