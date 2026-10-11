import { attachAudioAnalyser } from './audioAnalyser.js'
import { fixCoverUrl } from './bilibili.js'
import { resolvePlayUrl, resolvePlaySource, prefetchPlayUrl } from './playUrlCache.js'
import logger from './logger.js'

const FALLBACK_SRC = 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3'
const TIME_SYNC_MS = 200
const BUFFER_SYNC_EPS = 2

let audio = null
let eventsBound = false
let visualizerAttached = false
let lastTimeSyncAt = 0
let lastBufferedPct = -1

const runtime = {
  onTime: null,
  onLoadedMetadata: null,
  onCanPlay: null,
  onError: null,
  onEnded: null,
  playMusic: null,
  handleTrackEnd: null
}

export function bindPlaybackRuntime(partial) {
  Object.assign(runtime, partial || {})
  ensureAudioEvents()
}

export function getPlaybackRuntime() {
  return runtime
}

/** 全局唯一 Audio 实例：切歌只换 src，不重建元素/WebAudio 图 */
export function getAudioEl() {
  if (!audio) {
    audio = new Audio()
    audio.crossOrigin = 'anonymous'
    audio.preload = 'auto'
  }
  return audio
}

export function computeBufferedPercent(el) {
  if (!el || !el.buffered || el.buffered.length === 0) return 0
  try {
    const bufferedEnd = el.buffered.end(el.buffered.length - 1)
    const duration = el.duration || 1
    return Math.round((bufferedEnd / duration) * 100)
  } catch (_) {
    return 0
  }
}

function ensureAudioEvents() {
  const el = getAudioEl()
  if (eventsBound) return
  eventsBound = true

  el.addEventListener('loadedmetadata', () => {
    runtime.onLoadedMetadata?.(el)
  })

  el.addEventListener('timeupdate', () => {
    const now = Date.now()
    const t = el.currentTime
    const buf = computeBufferedPercent(el)
    // UI 本地进度可高频刷新；Pinia / 歌词等走节流回调
    const shouldSyncStore = now - lastTimeSyncAt >= TIME_SYNC_MS
    if (shouldSyncStore) lastTimeSyncAt = now
    const bufChanged = Math.abs(buf - lastBufferedPct) >= BUFFER_SYNC_EPS
    if (bufChanged) lastBufferedPct = buf
    runtime.onTime?.(t, buf, { syncStore: shouldSyncStore, bufChanged })
  })

  el.addEventListener('ended', () => {
    runtime.onEnded?.()
  })

  el.addEventListener('error', (e) => {
    runtime.onError?.(e)
  })

  el.addEventListener('canplaythrough', () => {
    runtime.onCanPlay?.()
  })
}

export function ensureVisualizer() {
  if (visualizerAttached) return true
  try {
    const analyser = attachAudioAnalyser(getAudioEl())
    visualizerAttached = !!analyser
    return visualizerAttached
  } catch (err) {
    logger.warn('[audioEngine] analyser attach failed:', err)
    return false
  }
}

export function updateMediaSession(music, isPlaying) {
  if (!('mediaSession' in navigator) || !music) return
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: music.title || '未知标题',
      artist: music.author || '未知作者',
      album: 'Pink Music',
      artwork: [
        {
          src: fixCoverUrl(music.cover, 256) || '',
          sizes: '256x256',
          type: 'image/jpeg'
        }
      ]
    })
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused'
  } catch (_) { /* MediaMetadata 可能不可用 */ }
}

export function setupMediaSessionHandlers({ onPlay, onPause, onNext, onPrev }) {
  if (!('mediaSession' in navigator)) return
  try {
    if (onPlay) navigator.mediaSession.setActionHandler('play', onPlay)
    if (onPause) navigator.mediaSession.setActionHandler('pause', onPause)
    if (onNext) navigator.mediaSession.setActionHandler('nexttrack', onNext)
    if (onPrev) navigator.mediaSession.setActionHandler('previoustrack', onPrev)
  } catch (_) {}
}

/**
 * 解析并播放。复用同一 Audio；src 未变时不再强制 reload。
 */
export async function playWithResolvedSrc(music, quality, { forceReload = false } = {}) {
  const el = getAudioEl()
  ensureAudioEvents()
  ensureVisualizer()

  const src = await resolvePlayUrl(music, quality)
  const nextSrc = src || FALLBACK_SRC

  try {
    if (!el.paused) el.pause()
  } catch (_) {}

  const currentAbs = el.src || ''
  const same = currentAbs && (currentAbs === nextSrc || currentAbs.endsWith(nextSrc) || nextSrc.endsWith(currentAbs.replace(/^file:\/\//, '')))
  // 仅当地址真正变化（或强制）时改 src，避免同曲重播整段 rebuffer
  if (forceReload || !same) {
    el.src = nextSrc
  }

  el.volume = 1.0
  await el.play()
  return { audio: el, src: nextSrc }
}

export function pauseAudio() {
  const el = getAudioEl()
  try { el.pause() } catch (_) {}
}

export function playAudio() {
  return getAudioEl().play()
}

export function seekAudio(time) {
  const el = getAudioEl()
  if (time == null || Number.isNaN(Number(time))) return
  el.currentTime = Number(time)
}

export function isAudioPaused() {
  return getAudioEl().paused
}

/** 主进程缓存命中时可用本地路径；否则预取网络 playurl */
export function prefetchTrack(music, quality) {
  prefetchPlayUrl(music, quality)
}

export { resolvePlayUrl, resolvePlaySource, FALLBACK_SRC }
