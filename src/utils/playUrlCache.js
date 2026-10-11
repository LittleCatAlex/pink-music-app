import { selectAudioUrl, selectAudioInfo } from './audio.js'
import logger from './logger.js'

const FALLBACK_SRC = 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3'
const TTL_MS = 10 * 60 * 1000
const MAX_ENTRIES = 80

const playUrlCache = new Map()
const cidCache = new Map()
const inflight = new Map()

function touch(map, key, value) {
  if (map.size >= MAX_ENTRIES) {
    const oldest = map.keys().next().value
    if (oldest !== undefined) map.delete(oldest)
  }
  map.set(key, { value, at: Date.now() })
}

function freshHit(map, key) {
  const hit = map.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > TTL_MS) {
    map.delete(key)
    return null
  }
  return hit.value
}

function cacheKey(music, quality) {
  return `${music.bvid}|${music.cid ?? ''}|${quality || 'auto'}`
}

async function resolveCid(music) {
  if (music?.cid != null) {
    touch(cidCache, music.bvid, music.cid)
    return music.cid
  }
  const cached = freshHit(cidCache, music.bvid)
  if (cached != null) return cached
  if (!window.electronAPI?.getMusicInfo) return null
  const info = await window.electronAPI.getMusicInfo(music.bvid)
  if (info?.code === 0 && info.data?.cid != null) {
    touch(cidCache, music.bvid, info.data.cid)
    return info.data.cid
  }
  return null
}

async function fetchPlaySource(music, quality) {
  const q = quality || 'auto'
  const key = cacheKey(music, q)
  const cached = freshHit(playUrlCache, key)
  if (cached) return cached

  if (inflight.has(key)) return inflight.get(key)

  const task = (async () => {
    try {
      const cid = await resolveCid(music)
      if (cid == null || !window.electronAPI?.getMusicPlayUrl) {
        return { url: FALLBACK_SRC, codecs: '', data: null }
      }

      const playUrlResult = await window.electronAPI.getMusicPlayUrl(music.bvid, cid)
      if (playUrlResult?.code === 0) {
        const url = selectAudioUrl(playUrlResult.data, q)
        const info = selectAudioInfo(playUrlResult.data, q)
        const payload = {
          url: url || info?.url || FALLBACK_SRC,
          codecs: info?.codecs || '',
          cid,
          data: playUrlResult.data
        }
        touch(playUrlCache, key, payload)
        return payload
      }
    } catch (error) {
      logger.warn('[playUrlCache] resolve failed:', error?.message)
    } finally {
      inflight.delete(key)
    }
    return { url: FALLBACK_SRC, codecs: '', data: null }
  })()

  inflight.set(key, task)
  return task
}

/**
 * 解析可播放音频地址（带 cid / playurl 内存缓存）。
 * 同一 bvid+cid+quality 并发调用会合并为一次网络请求。
 */
export async function resolvePlayUrl(music, quality = 'auto') {
  if (!music?.bvid) return FALLBACK_SRC
  const source = await fetchPlaySource(music, quality)
  return source.url || FALLBACK_SRC
}

/** 播放/下载共用：返回 { url, codecs, cid, data } */
export async function resolvePlaySource(music, quality = 'auto') {
  if (!music?.bvid) return { url: FALLBACK_SRC, codecs: '', data: null }
  return fetchPlaySource(music, quality)
}

/** 静默预取下一首的播放地址，失败忽略 */
export function prefetchPlayUrl(music, quality = 'auto') {
  if (!music?.bvid) return
  resolvePlaySource(music, quality).catch(() => {})
}

export function clearPlayUrlCache() {
  playUrlCache.clear()
  cidCache.clear()
  inflight.clear()
}
