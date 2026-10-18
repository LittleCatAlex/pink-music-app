/**
 * 统一曲目标识 + 歌曲条目字段规范化
 * ─────────────────────────────────────────
 * 历史上所有去重、上一首/下一首定位、播放历史都靠 `bvid` 比较。
 * 本地导入的音频没有 bvid，需要一套判别函数，避免与 B 站曲互相污染。
 *
 * 约定：
 *   - B 站曲：source 缺省，靠 bvid + cid 定位；收藏夹项回退 favId + favType
 *   - 本地曲：source === 'local'，靠稳定 id（= 文件路径哈希）定位
 */

/** 是否本地导入的曲目 */
export function isLocalTrack(track) {
  if (!track || typeof track !== 'object') return false
  return track.source === 'local' || (typeof track.filePath === 'string' && track.filePath.length > 0)
}

/** 稳定身份键（用于 Map / Set / :key） */
export function trackKey(track) {
  if (!track) return ''
  if (isLocalTrack(track)) return `L:${track.id || track.filePath || ''}`
  return `B:${track.bvid ?? ''}:${track.cid ?? ''}`
}

/**
 * 判定两首歌是否同一首。
 * - 一边是本地曲：两边都必须本地且 id 相同
 * - 都是 B 站曲：bvid 一致即判同（cid 两边都非空时要求一致；
 *   search/recommended 结果可能没有 cid）
 * - 都没有 bvid：回退用 favId + favType 判同（B 站收藏夹项）
 */
export function sameTrack(a, b) {
  if (!a || !b) return false
  const aLocal = isLocalTrack(a)
  const bLocal = isLocalTrack(b)
  if (aLocal || bLocal) {
    return aLocal && bLocal && trackKey(a) === trackKey(b)
  }
  const ab = a.bvid || ''
  const bb = b.bvid || ''
  if (ab && bb) {
    if (ab !== bb) return false
    const ac = a.cid ?? null
    const bc = b.cid ?? null
    return (ac !== null && bc !== null) ? ac === bc : true
  }
  // 无 bvid 的收藏项：用 favId + favType
  if (a.favId != null && b.favId != null) {
    return a.favId === b.favId && (a.favType ?? null) === (b.favType ?? null)
  }
  return false
}

/**
 * 判断对象是否"像一首歌"。
 * 真正的歌曲条目至少具备 bvid（B 站稿件号）、favId（B 站收藏项）、
 * 本地标记，或者有非空标题。DOM 事件对象（MouseEvent 等）没有这些字段——
 * 历史 bug：模板裸绑定 @click="openAddToPlaylistModal" 会把原生 click 事件
 * 传进添加流程，事件对象被序列化后只剩 isTrusted/_vts，导致歌单里出现
 * "空白标题 + 未知作者"的脏条目。
 */
export function isTrackLike(music) {
  if (!music || typeof music !== 'object') return false
  const hasBvid = typeof music.bvid === 'string' && music.bvid.length > 0
  const hasFavId = music.favId != null
  const hasMeta = typeof music.title === 'string' && music.title.length > 0
  return hasBvid || hasFavId || hasMeta || isLocalTrack(music)
}

/** 歌曲条目允许保留的业务字段白名单（写歌单时只拷贝这些键） */
export const TRACK_FIELDS = [
  // B 站曲字段
  'bvid', 'aid', 'cid', 'favId', 'favType', 'playCount', 'pubdate', 'description', 'videos', 'isBiliFavoriteResource',
  // 通用字段
  'title', 'author', 'cover', 'duration',
  // 本地曲字段（source === 'local'）
  'source', 'id', 'filePath', 'fileName', 'album', 'lyricPath', 'isMissing', 'isUnplayable'
]

/**
 * 从任意对象中抽出歌曲条目应有的字段，并补齐标题/作者/封面兜底。
 * 关键：不再整体展开源对象（旧实现的 `...music` 会把事件对象上的
 * isTrusted/_vts 等杂散键一并写进歌单）。
 */
export function pickTrackFields(music) {
  const out = {}
  if (!music || typeof music !== 'object') return out
  for (const k of TRACK_FIELDS) {
    if (music[k] !== undefined && music[k] !== null) out[k] = music[k]
  }
  out.title = out.title || '未知标题'
  out.author = out.author || '未知作者'
  out.cover = out.cover || ''
  out.duration = out.duration || 0
  // 本地曲不写 bvid（保持空，避免污染 B 站逻辑）
  if (isLocalTrack(music)) {
    out.source = 'local'
    out.bvid = ''
    out.cid = null
    return out
  }
  out.bvid = out.bvid || ''
  out.cid = out.cid ?? (music.cid ?? null)
  return out
}