import { defineStore } from 'pinia'
import { createPersistentStorage } from '@/utils/persistentStorage'
import { toLocalUrl } from '@/utils/playUrlCache'
import { usePlaylistStore, syncPlaylistCover } from './playlist'

// 本地音乐库
// ─────────────────────────────────────────
// 与 B 站内容解耦：本地曲的「库」是独立的一份列表（userData/app-data/local-library.json）。
// 歌单（playlists.json）里可以引用本地曲（source === 'local'），但库本身单独管理，
// 这样才有统一的导入 / 失效检测 / 批量管理入口。
//
// 主存储 key：local-library；localStorage fallback：pink-music-local-library
const storage = createPersistentStorage('local-library', { schema: null, debounceMs: 0 })

const initialTracks = (() => {
  const peeked = storage.peek(null)
  return Array.isArray(peeked) ? peeked : []
})()

// save 串行链：避免并发写导致后写覆盖先写
let _saveChain = Promise.resolve()

export const useLocalStore = defineStore('local', {
  state: () => ({
    tracks: initialTracks,
    isImporting: false,
    // { stage: 'scan'|'parse', current, total }
    importProgress: { stage: '', current: 0, total: 0 },
    isCheckingMissing: false,
    // 云端封面匹配：批量进行中的 UI 进度（{ active, current, total }）
    coverProgress: { active: false, current: 0, total: 0 },
    _coverCancel: false,
    // 时长补全：标签里没有时长的文件用本地解码器重新读取（{ active, current, total }）
    isFillingDurations: false,
    durationProgress: { active: false, current: 0, total: 0 },
    _loaded: false
  }),
  getters: {
    count() {
      return this.tracks.length
    },
    missingCount() {
      return this.tracks.filter(t => t.isMissing).length
    },
    unplayableCount() {
      return this.tracks.filter(t => t.isUnplayable).length
    },
    /**
     * 还缺时长的本地曲数量（库 + 歌单副本，按 id 去重）。
     * 用于决定「补全时长」入口是否出现：只统计解码器拿得到的曲目
     * （isUnplayable 的 wma/ape 等 Chromium 解不了，补了也是 0）。
     */
    zeroDurationCount() {
      const ids = new Set()
      for (const t of this.tracks) {
        if (t && !t.duration && !t.isUnplayable) ids.add(t.id)
      }
      try {
        for (const pl of usePlaylistStore().userPlaylists) {
          for (const m of pl.music || []) {
            if (m && m.source === 'local' && !m.duration && !m.isUnplayable) ids.add(m.id)
          }
        }
      } catch (_) {}
      return ids.size
    },
    /** 把本地库包装成"虚拟歌单"，供播放链路的 currentPlaylist 使用 */
    virtualPlaylist() {
      return {
        id: '__local_library__',
        name: '本地音乐',
        music: this.tracks,
        isLocal: true,
        coverMode: 'auto',
        cover: this.tracks[0]?.cover || ''
      }
    }
  },
  actions: {
    async load() {
      if (this._loaded) return
      const data = await storage.load(null)
      if (Array.isArray(data)) {
        // 兼容旧数据：确保 source/id 字段存在
        this.tracks = data.map(t => normalizeLocalTrack(t)).filter(Boolean)
      }
      this._loaded = true
    },

    /**
     * 批量加入本地库（按 id 去重）。
     * 已存在的曲目只刷新元数据，不重复插入。
     * @returns {{ added: number, skipped: number }}
     */
    async addTracks(tracks) {
      if (!Array.isArray(tracks) || tracks.length === 0) return { added: 0, skipped: 0 }
      const byId = new Map(this.tracks.map(t => [t.id, t]))
      let added = 0
      let skipped = 0
      for (const raw of tracks) {
        const t = normalizeLocalTrack(raw)
        if (!t || !t.id) continue
        if (byId.has(t.id)) {
          // 已存在：刷新可能变化的字段（时长/封面/歌词路径/失效标记）
          Object.assign(byId.get(t.id), {
            title: t.title || byId.get(t.id).title,
            author: t.author || byId.get(t.id).author,
            album: t.album || byId.get(t.id).album,
            duration: t.duration || byId.get(t.id).duration,
            cover: t.cover || byId.get(t.id).cover,
            lyricPath: t.lyricPath || byId.get(t.id).lyricPath,
            isMissing: false
          })
          skipped++
        } else {
          byId.set(t.id, t)
          added++
        }
      }
      this.tracks = Array.from(byId.values())
      await this.persist()
      this._syncVirtualPlaylist()
      return { added, skipped }
    },

    async removeTracks(ids) {
      const set = new Set(ids || [])
      if (set.size === 0) return 0
      const before = this.tracks.length
      this.tracks = this.tracks.filter(t => !set.has(t.id))
      await this.persist()
      this._syncVirtualPlaylist()
      return before - this.tracks.length
    },

    async clearAll() {
      this.tracks = []
      await this.persist()
      this._syncVirtualPlaylist()
    },

    /**
     * 本地库变化后刷新「本地音乐」虚拟歌单：
     * currentPlaylist 若正指向它，换用最新的 virtualPlaylist 引用，
     * 否则上一首/下一首拿到的还是旧的 music 数组（增删不生效）。
     */
    _syncVirtualPlaylist() {
      const playlistStore = usePlaylistStore()
      const cur = playlistStore.currentPlaylist
      if (cur && cur.id === '__local_library__') {
        playlistStore.setCurrentPlaylist(this.virtualPlaylist)
      }
    },

    /** 更新单首本地曲（重新定位后刷新路径/元数据用） */
    async updateTrack(id, patch) {
      const t = this.tracks.find(x => x.id === id)
      if (!t) return false
      Object.assign(t, patch)
      await this.persist()
      return true
    },

    /**
     * 校验所有本地曲的文件是否仍存在，标记 isMissing。
     * 只标记，绝不自动删除用户记录/文件。
     */
    async checkMissing() {
      if (!window.electronAPI?.local?.checkFiles) return 0
      if (this.tracks.length === 0) return 0
      this.isCheckingMissing = true
      try {
        const payload = this.tracks.map(t => ({ id: t.id, filePath: t.filePath }))
        const res = await window.electronAPI.local.checkFiles(payload)
        if (res?.code === 0 && Array.isArray(res.data)) {
          const flagsById = {}
          for (const r of res.data) flagsById[r.id] = !r.exists
          const missing = new Set(res.data.filter(r => !r.exists).map(r => r.id))
          let changed = 0
          for (const t of this.tracks) {
            const shouldMiss = missing.has(t.id)
            if (t.isMissing !== shouldMiss) {
              t.isMissing = shouldMiss
              changed++
            }
          }
          if (changed > 0) await this.persist()
          // 歌单里存的是本地曲副本，标记必须同步过去，否则歌单视图永远显示旧状态
          try {
            await usePlaylistStore().syncLocalTrackFlags(flagsById)
          } catch (e) {
            console.warn('[localStore] 同步歌单失效标记失败:', e?.message)
          }
          return missing.size
        }
      } catch (e) {
        console.warn('[localStore] 失效校验失败:', e?.message)
      } finally {
        this.isCheckingMissing = false
      }
      return 0
    },

    async persist() {
      _saveChain = _saveChain.then(() => storage.save(this.tracks)).catch(e => {
        console.warn('[localStore] persist failed:', e?.message)
      })
      return _saveChain
    },

    // ───────── 本地曲字段写回（封面 / 歌手 / 时长） ─────────

    /**
     * 统一写入口：把 patch 写进本地库曲目，并同步到歌单里的同名副本。
     * 歌单里存的是曲目副本（不是引用），所以必须两边一起改，否则歌单里还是旧值。
     * key 既可以是库内曲目 id，也可以只存在于歌单里的本地曲副本 id。
     * 空值（undefined / null / ''）一律不写 —— 匹配失败不能被当成"没数据"清空字段。
     * @returns {Promise<Object>} id → 本次实际写入的字段（没有变化时不出现该 id）
     */
    async applyTrackPatches(patches) {
      const resolved = {}
      for (const id of Object.keys(patches || {})) {
        const patch = {}
        for (const [k, v] of Object.entries(patches[id] || {})) {
          if (v === undefined || v === null || v === '') continue
          patch[k] = v
        }
        if (Object.keys(patch).length > 0) resolved[id] = patch
      }
      const ids = Object.keys(resolved)
      if (ids.length === 0) return {}

      let libraryChanged = 0
      for (const id of ids) {
        const t = this.tracks.find(x => x.id === id)
        if (!t) continue
        const diff = {}
        for (const [k, v] of Object.entries(resolved[id])) {
          if (t[k] !== v) diff[k] = v
        }
        if (Object.keys(diff).length === 0) continue
        Object.assign(t, diff)
        libraryChanged++
      }
      if (libraryChanged > 0) await this.persist()
      await this._syncTrackCopies(resolved)
      return resolved
    },

    /** 把字段值同步到所有歌单里的本地曲副本（封面变化时顺带重算歌单封面） */
    async _syncTrackCopies(patchById) {
      try {
        const playlistStore = usePlaylistStore()
        let touched = false
        for (const pl of playlistStore.userPlaylists) {
          if (!Array.isArray(pl.music)) continue
          let hit = false
          let coverChanged = false
          for (const m of pl.music) {
            if (!m || m.source !== 'local') continue
            const patch = patchById[m.id]
            if (!patch) continue
            for (const [k, v] of Object.entries(patch)) {
              if (m[k] === v) continue
              m[k] = v
              if (k === 'cover') coverChanged = true
              hit = true
            }
          }
          if (!hit) continue
          if (coverChanged) syncPlaylistCover(pl)
          touched = true
        }
        if (!touched) return
        await playlistStore.savePlaylists()
        // 刷新当前查看歌单的引用，触发视图更新
        const cur = playlistStore.currentPlaylist
        if (cur) {
          const fresh = playlistStore.userPlaylists.find(p => p.id === cur.id)
          if (fresh) playlistStore.setCurrentPlaylist(fresh)
        }
      } catch (e) {
        console.warn('[localStore] 同步歌单副本失败:', e?.message)
      }
    },

    /** 只改封面（兼容旧调用）：写入本地库 + 歌单副本 */
    async setTrackCover(id, coverUrl) {
      if (!id || !coverUrl) return false
      if (!this.tracks.some(t => t.id === id)) return false
      await this.applyTrackPatches({ [id]: { cover: coverUrl } })
      return true
    },

    /**
     * 改一组字段（封面 / 歌手 / 时长…），本地库与歌单副本一起写。
     * @returns {Promise<Object>} 本次实际写入的字段（{} 表示没有变化、未写盘）
     */
    async setTrackMeta(id, patch) {
      if (!id || !patch) return {}
      const applied = await this.applyTrackPatches({ [id]: patch })
      return applied[id] || {}
    },

    /**
     * 自动匹配单首：按 歌名/歌手/专辑 走 LrcApi，成功后落盘并应用。
     * 命中结果里的歌手名（matchedArtist）用它改写 author（用户诉求：
     * 云同步封面成功后，歌手的名字直接采用封面来源的那个歌手名）。
     * @returns {Promise<string>} 成功返回协议 URL，失败返回 ''
     */
    async matchCoverFor(track) {
      if (!track) return ''
      const api = window.electronAPI?.local
      if (!api?.matchCover) return ''
      // '未知作者' 是解析兜底占位，不能当真实歌手送出去（否则歌手校验必然失败）
      const artist = track.author && track.author !== '未知作者' ? track.author : ''
      try {
        const res = await api.matchCover({
          title: track.title || '',
          artist,
          album: track.album || ''
        })
        if (res?.code === 0 && res.data?.url) {
          const patch = { cover: res.data.url }
          // 封面来源的歌手名更可信时一并改写（'未知作者' 占位允许被覆盖）
          const matchedArtist = usableArtist(res.data.matchedArtist)
          if (matchedArtist) patch.author = matchedArtist
          await this.applyTrackPatches({ [track.id]: patch })
          return res.data.url
        }
      } catch (e) {
        console.warn('[localStore] 封面匹配失败:', e?.message)
      }
      return ''
    },

    /**
     * 批量匹配缺失封面。顺序执行（避免并发打爆封面源），可中途取消。
     * @param {{ includeMissingUnplayable?: boolean }} [opts]
     * @returns {Promise<{ ok: number, total: number, canceled: boolean }>}
     */
    async batchMatchCovers() {
      // 只要「有歌名」就参与匹配：
      //   - 有歌手 → 严格校验（可能失败，失败就留空）
      //   - 无歌手 → 按歌名搜索后取第一个封面
      // 通用占位名（track01/未命名 等）由主进程拒绝，这里不重复判断
      const targets = this.tracks.filter(t => !t.cover && t.title)
      const skipped = this.tracks.filter(t => !t.cover).length - targets.length
      if (targets.length === 0) return { ok: 0, total: 0, skipped, canceled: false }
      this._coverCancel = false
      this.coverProgress = { active: true, current: 0, total: targets.length }
      let ok = 0
      for (let i = 0; i < targets.length; i++) {
        if (this._coverCancel) {
          this.coverProgress = { active: false, current: 0, total: 0 }
          return { ok, total: targets.length, skipped, canceled: true }
        }
        const url = await this.matchCoverFor(targets[i])
        if (url) ok++
        this.coverProgress = { active: true, current: i + 1, total: targets.length }
      }
      this.coverProgress = { active: false, current: 0, total: 0 }
      return { ok, total: targets.length, skipped, canceled: false }
    },

    cancelBatchCovers() {
      this._coverCancel = true
    },

    // ───────── 时长补全（标签读不出时长的格式靠本地解码器兜底） ─────────

    /**
     * 补全缺失时长：分片 MP4（bilibili/yt-dlp 下载的 m4a、mp4 常见）和裸 ADTS AAC
     * 按容器规范根本没有时长字段，music-metadata 只能给出 0；播放器（<audio>）
     * 解码后才知道真实时长，所以这里用同一个解码器重新读一遍再写回。
     * 库内曲目与只存在于歌单里的副本都覆盖。
     * @param {{ ids?: string[] }} [opts] 只补这批 id（导入后即时补全用）
     * @returns {Promise<{ filled: number, total: number }>}
     */
    async fillMissingDurations({ ids } = {}) {
      const only = Array.isArray(ids) && ids.length > 0 ? new Set(ids) : null
      const targets = new Map()
      const consider = (m) => {
        if (!m || m.source !== 'local') return
        if (only && !only.has(m.id)) return
        if (!m.id || !m.filePath || m.duration || m.isUnplayable) return
        if (!targets.has(m.id)) targets.set(m.id, m)
      }
      for (const t of this.tracks) consider(t)
      try {
        const playlistStore = usePlaylistStore()
        for (const pl of playlistStore.userPlaylists) {
          for (const m of pl.music || []) consider(m)
        }
      } catch (_) {}

      const list = Array.from(targets.values())
      if (list.length === 0) return { filled: 0, total: 0 }

      this.isFillingDurations = true
      this.durationProgress = { active: true, current: 0, total: list.length }
      const patches = {}
      try {
        for (let i = 0; i < list.length; i++) {
          const seconds = await probeLocalDuration(list[i].filePath)
          if (seconds > 0) patches[list[i].id] = { duration: seconds }
          this.durationProgress = { active: true, current: i + 1, total: list.length }
        }
        if (Object.keys(patches).length > 0) await this.applyTrackPatches(patches)
      } finally {
        this.isFillingDurations = false
        this.durationProgress = { active: false, current: 0, total: 0 }
      }
      return { filled: Object.keys(patches).length, total: list.length }
    },

    async flush(timeoutMs = 2000) {
      try { await this.persist() } catch (_) {}
    }
  }
})

// 时长探测超时：分片 MP4 要读到文件尾部才知道时长，给足时间但必须能放弃
const DURATION_PROBE_TIMEOUT_MS = 15000

/**
 * 候选/匹配结果里的歌手名是否可用。
 * 空值或占位名一律当作"没有数据"，绝不拿它去覆盖本地已有的歌手。
 */
function usableArtist(value) {
  const name = String(value || '').trim()
  if (!name) return ''
  if (name === '未知作者' || name === '未知歌手' || name.toLowerCase() === 'unknown') return ''
  return name
}

/**
 * 用播放器同款解码器（<audio>）读真实时长，返回整秒数；读不出返回 0。
 * 只请求 metadata，拿到时长立刻断开，避免把大文件整个拉下来后继续占资源。
 */
function probeLocalDuration(filePath) {
  return new Promise((resolve) => {
    const url = toLocalUrl(filePath)
    if (!url || typeof Audio === 'undefined') return resolve(0)
    let el = null
    let timer = null
    let settled = false
    const finish = (seconds) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (el) {
        try { el.removeAttribute('src'); el.load() } catch (_) {}
      }
      resolve(seconds)
    }
    timer = setTimeout(() => finish(0), DURATION_PROBE_TIMEOUT_MS)
    try {
      el = new Audio()
      el.preload = 'metadata'
      el.addEventListener('loadedmetadata', () => {
        const d = el.duration
        finish(Number.isFinite(d) && d > 0 ? Math.round(d) : 0)
      })
      el.addEventListener('error', () => finish(0))
      el.src = url
    } catch (_) {
      finish(0)
    }
  })
}

/** 规范化一条本地曲目，保证 source/id/关键字段齐全 */
function normalizeLocalTrack(t) {
  if (!t || typeof t !== 'object') return null
  if (!t.filePath) return null
  return {
    source: 'local',
    id: t.id || '',
    filePath: t.filePath,
    fileName: t.fileName || '',
    title: t.title || t.fileName || '未知标题',
    author: t.author || '未知作者',
    album: t.album || '',
    duration: Number(t.duration) || 0,
    cover: t.cover || '',
    lyricPath: t.lyricPath || '',
    addedAt: Number(t.addedAt) || Date.now(),
    isMissing: !!t.isMissing,
    isUnplayable: !!t.isUnplayable
  }
}