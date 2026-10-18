import { selectAudioUrl, selectAudioInfo } from './audio.js'
import { isLocalTrack } from './trackKey.js'
import logger from './logger.js'

const TTL_MS = 10 * 60 * 1000
const MAX_ENTRIES = 80

/**
 * 本地曲 → pinkmusic-local:// 协议地址。
 * 主进程 registerFileProtocol 会把它映射到磁盘文件；
 * 该协议声明为 secure + corsEnabled，因此 <audio crossOrigin> + WebAudio 可视化可用。
 */
export function toLocalUrl(filePath) {
  if (!filePath) return ''
  return `pinkmusic-local://audio/${encodeURIComponent(filePath)}`
}

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
        return { url: '', codecs: '', data: null }
      }

      const playUrlResult = await window.electronAPI.getMusicPlayUrl(music.bvid, cid)
      if (playUrlResult?.code === 0) {
        const url = selectAudioUrl(playUrlResult.data, q)
        const info = selectAudioInfo(playUrlResult.data, q)
        // 接口成功但没选出可用地址，按失败处理：不缓存空地址，避免 10 分钟内反复命中坏缓存
        if (!url && !info?.url) return { url: '', codecs: '', data: null }
        const payload = {
          url: url || info?.url,
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
    return { url: '', codecs: '', data: null }
  })()

  inflight.set(key, task)
  return task
}

/**
 * 解析可播放音频地址（带 cid / playurl 内存缓存）。
 * 同一 bvid+cid+quality 并发调用会合并为一次网络请求。
 */
export async function resolvePlayUrl(music, quality = 'auto') {
  if (isLocalTrack(music)) return toLocalUrl(music.filePath) || ''
  if (!music?.bvid) return ''
  const source = await fetchPlaySource(music, quality)
  return source.url || ''
}

/** 播放/下载共用：返回 { url, codecs, cid, data } */
export async function resolvePlaySource(music, quality = 'auto') {
  if (isLocalTrack(music)) {
    return { url: toLocalUrl(music.filePath) || '', codecs: '', cid: null, data: null, isLocal: true }
  }
  if (!music?.bvid) return { url: '', codecs: '', data: null }
  return fetchPlaySource(music, quality)
}

/** 静默预取下一首的播放地址，失败忽略 */
export function prefetchPlayUrl(music, quality = 'auto') {
  if (isLocalTrack(music)) return // 本地文件无需网络预取
  if (!music?.bvid) return
  resolvePlaySource(music, quality).catch(() => {})
}

export function clearPlayUrlCache() {
  playUrlCache.clear()
  cidCache.clear()
  inflight.clear()
}
