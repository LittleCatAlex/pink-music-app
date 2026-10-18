import { defineStore } from 'pinia'
import { createPersistentStorage } from '@/utils/persistentStorage'
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

    // ───────── 云端封面匹配（参考 HisAtri/LrcApi） ─────────

    /**
     * 应用一张封面：写入本地库，并同步到所有引用该本地曲的歌单。
     * 歌单里存的是曲目副本，所以必须两边一起改，否则歌单里还是旧封面。
     */
    async setTrackCover(id, coverUrl) {
      if (!id || !coverUrl) return false
      const t = this.tracks.find(x => x.id === id)
      if (!t) return false
      t.cover = coverUrl
      await this.persist()

      // 同步到歌单里的同名副本
      try {
        const playlistStore = usePlaylistStore()
        let touched = false
        for (const pl of playlistStore.userPlaylists) {
          if (!Array.isArray(pl.music)) continue
          let hit = false
          for (const m of pl.music) {
            if (m && m.source === 'local' && m.id === id) {
              m.cover = coverUrl
              hit = true
            }
          }
          if (hit) {
            syncPlaylistCover(pl)
            touched = true
          }
        }
        if (touched) {
          await playlistStore.savePlaylists()
          // 刷新当前查看歌单的引用，触发视图更新
          const cur = playlistStore.currentPlaylist
          if (cur && touched) {
            const fresh = playlistStore.userPlaylists.find(p => p.id === cur.id)
            if (fresh) playlistStore.setCurrentPlaylist(fresh)
          }
        }
      } catch (e) {
        console.warn('[localStore] 同步歌单封面失败:', e?.message)
      }
      return true
    },

    /**
     * 自动匹配单首：按 歌名/歌手/专辑 走 LrcApi，成功后落盘并应用。
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
          await this.setTrackCover(track.id, res.data.url)
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

    async flush(timeoutMs = 2000) {
      try { await this.persist() } catch (_) {}
    }
  }
})

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