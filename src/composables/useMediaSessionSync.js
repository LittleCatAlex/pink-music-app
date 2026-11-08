import { updateMediaSession } from '../utils/audioEngine'

/**
 * Composable for syncing OS MediaSession controls and Discord RPC activity
 */
export function useMediaSessionSync({
  currentTrack,
  isPlaying,
  currentTime,
  duration,
  playerStore,
  getAudioEl,
  playAudio,
  pauseAudio,
  playPrevious,
  playNext,
  seekAudio
}) {
  function syncDiscordRpc() {
    if (!window.electronAPI?.discord) return
    const track = currentTrack.value
    if (!track) {
      try { window.electronAPI.discord.clearActivity() } catch (_) {}
      return
    }
    try {
      window.electronAPI.discord.updateActivity({
        title: track.title,
        artist: track.artist || track.author || '',
        duration: duration.value || track.duration || 0,
        currentTime: currentTime.value || 0,
        isPlaying: isPlaying.value,
        cover: track.cover || track.pic || ''
      })
    } catch (_) {}
  }

  function syncMediaSession() {
    updateMediaSession(currentTrack.value, isPlaying.value)
    syncDiscordRpc()
  }

  function setupMediaSessionHandlers() {
    if (!('mediaSession' in navigator)) return

    navigator.mediaSession.setActionHandler('play', () => {
      const el = getAudioEl()
      if (el && !el.paused) return
      Promise.resolve(playAudio()).then(() => {
        isPlaying.value = true
        playerStore.setIsPlaying(true)
        syncMediaSession()
      }).catch(() => {
        isPlaying.value = false
        playerStore.setIsPlaying(false)
        syncMediaSession()
      })
    })

    navigator.mediaSession.setActionHandler('pause', () => {
      const el = getAudioEl()
      if (el && el.paused) return
      pauseAudio()
      isPlaying.value = false
      playerStore.setIsPlaying(false)
      syncMediaSession()
    })

    navigator.mediaSession.setActionHandler('previoustrack', () => {
      playPrevious()
    })

    navigator.mediaSession.setActionHandler('nexttrack', () => {
      playNext()
    })

    try {
      navigator.mediaSession.setActionHandler('seekto', (e) => {
        if (e?.seekTime == null) return
        try {
          seekAudio(e.seekTime)
          currentTime.value = e.seekTime
          playerStore.setCurrentTime(e.seekTime)
        } catch (_) {}
      })
    } catch (_) {}
  }

  return {
    syncDiscordRpc,
    syncMediaSession,
    setupMediaSessionHandlers
  }
}
