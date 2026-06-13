import { usePlayerStore, usePlaylistStore, useSearchStore } from '@/stores'

let audioInstance = null
let cleanupListenerMap = null

export function useAudioPlayer() {
  const playerStore = usePlayerStore()
  const playlistStore = usePlaylistStore()
  const searchStore = useSearchStore()

  if (!audioInstance) {
    audioInstance = new Audio()
    audioInstance.crossOrigin = 'anonymous'
  }

  function getRandomIndex(max) {
    return Math.floor(Math.random() * max)
  }

  function getNextMusicIndex() {
    let musicList = playlistStore.currentView === 'search' 
      ? searchStore.searchResults 
      : searchStore.recommendedMusic
    if (playlistStore.currentPlaylist?.music) {
      musicList = playlistStore.currentPlaylist.music
    }

    if (!musicList || musicList.length === 0) return -1

    const currentIndex = musicList.findIndex(m => m.bvid === playerStore.currentTrack?.bvid)

    switch (playerStore.playMode) {
      case 'single':
        return currentIndex >= 0 ? currentIndex : 0
      case 'shuffle':
        let nextIndex
        do {
          nextIndex = getRandomIndex(musicList.length)
        } while (musicList.length > 1 && nextIndex === currentIndex)
        return nextIndex
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

  function updateMediaSession(music, isPlaying) {
    if (!('mediaSession' in navigator) || !music) return
    navigator.mediaSession.metadata = new MediaMetadata({
      title: music.title || '未知标题',
      artist: music.author || '未知作者',
      album: 'Pink Music',
      artwork: [
        {
          src: music.cover?.startsWith('//') ? 'https:' + music.cover : (music.cover || ''),
          sizes: '256x256',
          type: 'image/jpeg'
        }
      ]
    })
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused'
  }

  async function playMusic(music) {
    try {
      if (!audioInstance.paused) {
        audioInstance.pause()
      }
    } catch (error) {}

    playerStore.setCurrentTrack(music)
    playerStore.setIsPlaying(false)
    playerStore.setIsAudioLoading(true)
    playerStore.setAudioError('')
    playerStore.setDuration(music.duration || 180)
    playerStore.setCurrentTime(0)
    playerStore.setBufferedProgress(0)
    playerStore.setShowPlayerPage(true)

    let audioSrc = null

    try {
      if (window.electronAPI) {
        const musicInfoResult = await window.electronAPI.getMusicInfo(music.bvid)
        if (musicInfoResult?.code === 0) {
          const playUrlResult = await window.electronAPI.getMusicPlayUrl(music.bvid, music.cid || musicInfoResult.data.cid)
          if (playUrlResult?.code === 0) {
            if (playUrlResult.data.dash?.audio?.length) {
              audioSrc = playUrlResult.data.dash.audio[0].baseUrl
            } else if (playUrlResult.data.durl?.length) {
              audioSrc = playUrlResult.data.durl[0].url
            }
          }
        }
      }
    } catch (error) {}

    if (!audioSrc) {
      audioSrc = 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3'
    }

    if (cleanupListenerMap) {
      Object.entries(cleanupListenerMap).forEach(([event, handler]) => {
        try {
          audioInstance.removeEventListener(event, handler)
        } catch (_) {}
      })
    }

    const listeners = {
      loadedmetadata: () => {
        playerStore.setDuration(audioInstance.duration || music.duration || 180)
        playerStore.setIsAudioLoading(false)
      },
      timeupdate: () => {
        if (audioInstance) {
          playerStore.setCurrentTime(audioInstance.currentTime)
          updateBufferedProgress()
        }
        updateMediaSession(music, !audioInstance.paused)
      },
      ended: () => {
        playerStore.setIsPlaying(false)
        handleTrackEnd()
      },
      error: (e) => {
        playerStore.setAudioError('音频加载失败')
        playerStore.setIsAudioLoading(false)
      },
      canplaythrough: () => {
        playerStore.setIsAudioLoading(false)
        playerStore.setBufferedProgress(100)
      }
    }

    Object.entries(listeners).forEach(([event, handler]) => {
      audioInstance.addEventListener(event, handler)
    })
    cleanupListenerMap = listeners

    audioInstance.src = audioSrc
    try {
      await audioInstance.play()
      playerStore.setIsPlaying(true)
      updateMediaSession(music, true)
    } catch (error) {
      playerStore.setIsAudioLoading(false)
    }
  }

  function updateBufferedProgress() {
    if (audioInstance.buffered.length > 0) {
      const bufferedEnd = audioInstance.buffered.end(audioInstance.buffered.length - 1)
      const duration = audioInstance.duration || 1
      playerStore.setBufferedProgress(Math.round((bufferedEnd / duration) * 100))
    }
  }

  function handleTrackEnd() {
    const nextIndex = getNextMusicIndex()
    let musicList = playlistStore.currentView === 'search' 
      ? searchStore.searchResults 
      : searchStore.recommendedMusic
    if (playlistStore.currentPlaylist?.music) {
      musicList = playlistStore.currentPlaylist.music
    }

    if (nextIndex >= 0 && musicList[nextIndex]) {
      playMusic(musicList[nextIndex])
    } else {
      playerStore.setIsPlaying(false)
    }
  }

  function togglePlayPause() {
    if (!audioInstance) return
    if (playerStore.isPlaying) {
      audioInstance.pause()
    } else {
      audioInstance.play()
    }
    playerStore.setIsPlaying(!playerStore.isPlaying)
    updateMediaSession(playerStore.currentTrack, !playerStore.isPlaying)
  }

  function playPrevious() {
    let musicList = playlistStore.currentView === 'search' 
      ? searchStore.searchResults 
      : searchStore.recommendedMusic
    if (playlistStore.currentPlaylist?.music) {
      musicList = playlistStore.currentPlaylist.music
    }

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

    if (musicList[prevIndex]) {
      playMusic(musicList[prevIndex])
    }
  }

  function playNext() {
    const nextIndex = getNextMusicIndex()
    let musicList = playlistStore.currentView === 'search' 
      ? searchStore.searchResults 
      : searchStore.recommendedMusic
    if (playlistStore.currentPlaylist?.music) {
      musicList = playlistStore.currentPlaylist.music
    }

    if (nextIndex >= 0 && musicList[nextIndex]) {
      playMusic(musicList[nextIndex])
    }
  }

  function onProgressInput(event) {
    const newTime = parseFloat(event.target.value)
    if (audioInstance && !isNaN(newTime)) {
      audioInstance.currentTime = newTime
      playerStore.setCurrentTime(newTime)
    }
  }

  function onProgressChange(event) {
    const newTime = parseFloat(event.target.value)
    if (audioInstance && !isNaN(newTime)) {
      audioInstance.currentTime = newTime
      playerStore.setCurrentTime(newTime)
    }
  }

  return {
    audioInstance,
    playMusic,
    togglePlayPause,
    playPrevious,
    playNext,
    onProgressInput,
    onProgressChange
  }
}
