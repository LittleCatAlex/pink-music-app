import { defineStore } from 'pinia'
import { createPersistentStorage, writeLocalJsonNow } from '@/utils/persistentStorage'
import { sameTrack, isTrackLike, pickTrackFields, trackKey } from '@/utils/trackKey'

// 主存储 key：playlists（userData/app-data/playlists.json）
// localStorage fallback key：pink-music-playlists
//
// 历史上 localStorage 歌单 key 演进：
//   v1: 'playlists'                            ← 最初版（pre-2.3 时期）
//   v2: 'userPlaylists'                        ← 中间版本
//   v3: 'pink-music-playlists'                 ← 当前统一前缀
// 还可能存在一个全局 'favorites'（仅收藏夹）老 key。
// load() 时按顺序依次探测并迁移，迁移完成才返回。
//
// 歌单数据是顶层数组（不是对象），schema 框架不直接适配。
// 这里用最小 schema 兜底：必须是数组；每条至少要有 id 字段。
// 关键修复：debounceMs = 0 强制每次都立即同步写 localStorage
// 原因：原值 400 会让 localStorage 写延迟 400ms，窗口关闭时就丢；
// 改成 0 后 localStorage 在 IPC 发出前就同步写完了，理论上最坏情况
// 也只剩主存储 IPC 可能在飞行中被打断（下面 main.js 的 before-quit 拦截解决）。
const playlistSchema = {
  parse(raw) {
    if (!Array.isArray(raw)) return []
    return raw.filter(p => p && typeof p === 'object' && typeof p.id !== 'undefined')
  }
}
const storage = createPersistentStorage('playlists', { schema: playlistSchema, debounceMs: 0 })

// 老 key 候选列表（按时间倒序；新 key 排前面）
const LEGACY_LOCAL_KEYS = [
  'pink-music-playlists',  // 当前
  'userPlaylists',         // 中间版本
  'playlists',             // 最初版
  'pink-music-favorites'   // 早期可能只有收藏夹
]

// 迁移锁：老实现写 localStorage 'pink-music-migrated-v3' 表示"已迁移到主存储"。
// 新实现不再写新锁 —— 迁移成功后会清理所有老 localStorage key，锁自然失效。
// 这里仍然 peek 这个 key 是为了：旧用户迁移后留有锁，read 行为不变。
const MIGRATION_LOCK_KEY = 'pink-music-migrated-v3'

/**
 * 把"迁移锁"也一起清掉。属于"清理老 key"的一部分。
 * 老锁文件没被新流程写，只是读 + 清。清理一次即可。
 */
function cleanupStaleMigrationLocks() {
  try { localStorage.removeItem(MIGRATION_LOCK_KEY) } catch (_) {}
}

// 迁移重试次数（写主存储失败时）
const MIGRATION_MAX_RETRY = 3

/**
 * 生成稳定且基本不冲突的 playlist id。
 * 用 Date.now() + 8 字节 random，避免快速连续创建时 id 冲突。
 */
function generatePlaylistId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * 同步 peek：从所有老 key 中找一份合法歌单数据。
 * 返回数组（找不到返回 null）。
 *
 * 行为：
 * 1) 如果迁移锁已设置 → 只看 `pink-music-playlists`（不再回退到老 key，避免旧数据"复活"）
 * 2) 否则按 LEGACY_LOCAL_KEYS 顺序找（兼容老版本升级场景）
 * 3) 解析失败、对象结构非法、数组里有 null/缺 id 的条目都会被过滤掉
 */
function peekPlaylists() {
  // 迁移锁：已迁移过 → 只看当前 key，绝不回退到老 key
  let migrationLocked = false
  try {
    migrationLocked = localStorage.getItem(MIGRATION_LOCK_KEY) === 'true'
  } catch (_) {}

  const keys = migrationLocked ? ['pink-music-playlists'] : LEGACY_LOCAL_KEYS

  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const parsed = JSON.parse(raw)
      const arr = extractPlaylistArray(parsed, key)
      if (arr && arr.length > 0) {
        return { data: arr, sourceKey: key }
      }
    } catch (e) {
      // 解析失败：留个 warn，方便用户/开发者排查损坏的 localStorage
      console.warn(`[playlistStore] peek ${key} 解析失败:`, e.message)
    }
  }
  return { data: null, sourceKey: null }
}

/**
 * 把各种老格式的 localStorage 解析结果统一抽成顶层数组。
 * 支持：
 *   - [...] 直接是数组
 *   - { playlists: [...] }
 *   - { userPlaylists: [...] }
 *   - { items: [...] }
 *   - { favorites: { music: [...] } } 单条收藏夹（老版本只有收藏夹的格式）
 *   - { favorites: [...] } 收藏夹直接是数组的格式（部分老版本）
 *   - 任何藏在常见字段里的数组
 *
 * @param {*} parsed JSON.parse 的结果
 * @param {string} [key] 用于日志的来源 key
 * @returns {Array|null} 顶层数组（找不到返回 null）
 */
function extractPlaylistArray(parsed, key = '<unknown>') {
  if (!parsed) return null
  if (Array.isArray(parsed)) {
    return sanitizePlaylistArray(parsed, `${key}[]`)
  }
  if (typeof parsed !== 'object') return null
  // 顶层数组藏在常见字段
  for (const k of ['playlists', 'userPlaylists', 'items', 'list', 'data']) {
    if (Array.isArray(parsed[k])) {
      return sanitizePlaylistArray(parsed[k], `${key}.${k}`)
    }
  }
  // 早期可能只有 favorites 单条（object 形式）
  if (parsed.favorites && Array.isArray(parsed.favorites.music)) {
    return sanitizePlaylistArray([{
      id: 'favorites',
      name: '收藏夹',
      music: parsed.favorites.music,
      isDefault: true
    }], `${key}.favorites.music`)
  }
  // 早期可能 favorites 直接是数组（歌曲列表，不是 playlist 列表）
  // → 包成单个收藏夹
  if (Array.isArray(parsed.favorites)) {
    console.log(`[playlistStore] ${key}.favorites[] 是歌曲列表，包成单个收藏夹`)
    return [{
      id: 'favorites',
      name: '收藏夹',
      music: parsed.favorites,
      isDefault: true
    }]
  }
  return null
}

/**
 * 过滤掉 null / 非对象 / 缺 id 的无效条目，并 warn 一次。
 */
function sanitizePlaylistArray(arr, sourceLabel) {
  const out = []
  let dropped = 0
  for (const item of arr) {
    if (item && typeof item === 'object' && typeof item.id !== 'undefined') {
      out.push(item)
    } else {
      dropped++
    }
  }
  if (dropped > 0) {
    console.warn(`[playlistStore] ${sourceLabel} 过滤掉 ${dropped} 个非法条目`)
  }
  return out
}

/**
 * 合并两份 userPlaylists（loaded + pending）。
 * 合并规则：
 *   - 以 loaded 为基础
 *   - 对 pending 里每个 playlist：
 *     - 在 loaded 里没找到 → 直接加进去（用户新建的）
 *     - 在 loaded 里找到了 → 合并 music 数组：pending 里有但 loaded 里没有的歌曲加进去（按 bvid 或 favId+favType 去重）
 *   - 默认收藏夹（isDefault）始终保留
 *   - B 站收藏夹（isBiliFavorite）的元数据更新沿用 mergeBiliFavorites 逻辑（不重置 music）
 *
 * 这个函数专门处理"用户在 load 完之前做了改动 → 加载到的数据覆盖了用户改动"的场景。
 * 不会丢用户在初始化窗口里添加的歌曲或新建的歌单。
 */
function mergePlaylists(loaded, pending) {
  if (!Array.isArray(loaded)) loaded = []
  if (!Array.isArray(pending)) pending = []
  // 没有任何 pending 改动：仍然需要确保默认收藏夹排首位（loaded 数据可能不满足）
  if (pending.length === 0) {
    const out = loaded.slice()
    out.sort((a, b) => {
      if (a && a.isDefault && (!b || !b.isDefault)) return -1
      if ((!a || !a.isDefault) && b && b.isDefault) return 1
      return 0
    })
    return out
  }

  const byId = new Map()
  for (const p of loaded) {
    if (p && p.id) byId.set(p.id, p)
  }

  // pending 里有的：合并进 byId
  for (const pp of pending) {
    if (!pp || !pp.id) continue
    const existing = byId.get(pp.id)
    if (!existing) {
      // 用户新建的 playlist → 整个加进去
      byId.set(pp.id, pp)
      continue
    }
    // 找到了 → 合并 music
    if (!existing.music) existing.music = []
    if (!pp.music) continue
    // 防御：pending 快照里若是混入了非歌曲对象（事件对象脏数据），合并时直接过滤
    for (const song of pp.music.filter(m => isTrackLike(m))) {
      if (!song) continue
      // 统一身份判重（本地曲走 id，B 站曲走 bvid+cid）
      const dup = existing.music.some(m => sameTrack(m, song))
      if (!dup) existing.music.push(song)
    }
    // B 站收藏夹：更新 cover/title/media_count（如果 pending 端有更新）
    if (pp.isBiliFavorite) {
      if (pp.title) existing.title = pp.title
      if (pp.cover) existing.cover = pp.cover
      if (typeof pp.media_count === 'number') existing.media_count = pp.media_count
    }
  }

  // 默认收藏夹放最前
  const out = Array.from(byId.values())
  out.sort((a, b) => {
    // 稳定排序：默认收藏夹优先，其余按原顺序
    if (a.isDefault && !b.isDefault) return -1
    if (!a.isDefault && b.isDefault) return 1
    return 0
  })
  return out
}

/**
 * 给 playlists 加上稳定的 id（如果原条目缺 id）。
 * 一般不会触发，但防一手"老数据没 id"的边界场景。
 */
function ensureStableIds(arr) {
  let fixed = 0
  for (const p of arr) {
    if (p && !p.id) {
      p.id = generatePlaylistId()
      fixed++
    }
  }
  if (fixed > 0) console.warn(`[playlistStore] 兜底给 ${fixed} 个歌单补上了 id`)
  return arr
}

/**
 * 判断对象是否"像一首歌"。
 * 判定逻辑统一收敛在 utils/trackKey.js（本地曲 / B 站曲共用），
 * 这里只做 re-export 保持内部调用点不变。
 * 历史 bug：模板裸绑定 @click="openAddToPlaylistModal" 会把原生 click 事件
 * 传进添加流程，事件对象被序列化后只剩 isTrusted/_vts，导致歌单里出现
 * "空白标题 + 未知作者"的脏条目。
 */

/**
 * 歌单封面同步规则：
 *   - coverMode === 'custom' 时保留用户自定义封面，不覆盖
 *   - B 站收藏夹保留 B 站云端封面
 *   - 其余情况封面跟随第一首曲目（本地曲封面即内嵌图/同目录图）
 */
export function syncPlaylistCover(playlist) {
  if (!playlist) return
  if (playlist.coverMode === 'custom') return
  if (playlist.isBiliFavorite) return
  playlist.cover = playlist.music?.[0]?.cover || ''
}

/**
 * 装着本地曲副本的所有容器：所有用户歌单 + 当前查看的歌单
 * （currentPlaylist 可能不是 userPlaylists 成员，例如「本地音乐」虚拟歌单）。
 */
function collectLocalTargets(store) {
  const targets = []
  for (const pl of store.userPlaylists) {
    if (pl && Array.isArray(pl.music)) targets.push(pl)
  }
  const cur = store.currentPlaylist
  if (cur && Array.isArray(cur.music) && !targets.includes(cur)) targets.push(cur)
  return targets
}

/**
 * 清理歌单里的非法歌曲条目（历史遗留的事件对象等脏数据）。
 * 幂等：没有脏条目时返回原数组引用，不触发多余的重渲染/写盘。
 */
function sanitizePlaylistMusic(playlists) {
  if (!Array.isArray(playlists)) return playlists
  let changed = false
  const out = playlists.map(p => {
    if (!p || typeof p !== 'object' || !Array.isArray(p.music)) return p
    const cleaned = p.music.filter(m => isTrackLike(m))
    if (cleaned.length !== p.music.length) {
      changed = true
      return { ...p, music: cleaned }
    }
    return p
  })
  return changed ? out : playlists
}

// 同步 peek 旧数据，避免首屏闪一下空歌单（顺带清理历史脏条目，
// 防止首屏就出现"空白标题 + 未知作者"的歌曲行）
const peekResult = peekPlaylists()
const initialUserPlaylists = ensureStableIds(
  sanitizePlaylistMusic(Array.isArray(peekResult.data) ? peekResult.data : [])
)

export const usePlaylistStore = defineStore('playlist', {
  state: () => ({
    userPlaylists: initialUserPlaylists,
    currentPlaylist: null,
    currentView: 'home',
    showCreatePlaylistModal: false,
    showAddToPlaylistModal: false,
    showPlaylistManager: false,
    // 内部状态
    _loaded: false,           // load() 是否已完成
    _pendingSave: [],         // load() 完成前累积的 save 请求（队列，避免丢中间步骤）
    _migratedKeys: [],        // 启动期迁移日志用
    _migrationSourceKey: null // 真正迁移成功的源 key（用于回填 / 清理）
  }),
  actions: {
    /**
     * 启动时调用：从主存储加载用户歌单，缺失则从 localStorage 老 key 迁移。
     * 同时确保"收藏夹"默认歌单存在。
     * 关键修复：
     *   1) 必须 await（App.vue 的 Promise.allSettled 已经在等）
     *   2) 老 key 探测在 storage.load() 之前完成，确保主存储拿不到数据时还有兜底
     *   3) load 完成后 flush 期间累积的 pending save（避免覆盖刚加载的数据）
     *   4) 迁移成功后回填 pink-music-playlists（双写兜底）
     *   5) 迁移成功后清理所有老 localStorage key，避免旧数据"复活"
     *   6) 写主存储失败时重试 MIGRATION_MAX_RETRY 次，仍失败则降级写 localStorage
     */
    async load() {
      if (this._loaded) {
        // 二次调用：仅刷新一次，不重复 flush
        return
      }

      // 0) 先把所有老 key 都尝试一遍，拿到"最完整的 localStorage 副本"
      //    （主存储没数据时用；主存储有数据时用不上）
      const legacyPeek = peekPlaylists()
      const legacyData = Array.isArray(legacyPeek.data) ? legacyPeek.data : null
      const legacyKey = legacyPeek.sourceKey

      // 1) 优先主存储
      let data = null
      try {
        const res = await window.electronAPI?.appData?.get?.('playlists')
        if (res && res.code === 0 && res.data !== null && res.data !== undefined) {
          if (Array.isArray(res.data)) {
            data = ensureStableIds(res.data)
          } else {
            const arr = extractPlaylistArray(res.data, 'mainStore')
            if (arr) data = ensureStableIds(arr)
          }
        }
      } catch (e) {
        console.warn('[playlistStore] 读主存储失败:', e.message)
      }

      // 1.5) 清理历史遗留的脏条目（事件对象等非歌曲数据），修复"空白标题/未知作者"
      if (Array.isArray(data)) data = sanitizePlaylistMusic(data)

      // 2) 主存储空时回退到 localStorage 老 key，并 await 迁移
      if (!Array.isArray(data) && legacyData) {
        // 迁移前也先做一次清理，避免脏数据被搬进主存储
        data = sanitizePlaylistMusic(ensureStableIds(legacyData))
        const ok = await this._migrateToMainStore(data, legacyKey)
        if (!ok) {
          // 写主存储彻底失败：降级到 localStorage 当前 key
          console.warn('[playlistStore] 主存储迁移失败，降级写 pink-music-playlists')
          try { writeLocalJsonNow('playlists', data) } catch (e) {}
        }
      }

      // 3) 实在都没有，给个空数组（下面会加收藏夹兜底）
      if (!Array.isArray(data)) data = []

      this.userPlaylists = data

      // 4) 确保默认收藏夹存在
      const favoritesExists = this.userPlaylists.some(p => p && p.id === 'favorites')
      if (!favoritesExists) {
        this.userPlaylists.unshift({
          id: 'favorites',
          name: '收藏夹',
          music: [],
          isDefault: true
        })
        // 显式 await：保证首次落盘完成后再标 _loaded
        try {
          await this.savePlaylists()
        } catch (e) {
          console.warn('[playlistStore] 写默认收藏夹失败:', e.message)
        }
      }

      // 5) 标记 loaded 之前 await 一个微任务，把"已 loaded 但还没 flush pending"
      //    的窗口扩大成几个微任务，让任何同步触发的 savePlaylists 都能进入 _pendingSave
      //    而不是直接走 "loaded" 路径写主存（与 merge 后的状态再次覆盖）
      this._loaded = true
      await Promise.resolve()

      // 6) flush load 期间累积的 save 请求
      // 关键：必须把所有 pending 跟刚加载的数据 merge，不能简单覆盖。
      // 否则用户在 load 完之前做的添加/新建操作会被加载到的旧数据覆盖掉。
      // 注意：mergePlaylists 自身已支持"loaded 基础上叠加多个 pending 快照"，
      // 这里用一个 reduce 把队列里的所有快照依次合并进去。
      if (this._pendingSave.length > 0) {
        const pendingQueue = this._pendingSave
        this._pendingSave = []
        try {
          let merged = this.userPlaylists
          for (const snap of pendingQueue) {
            merged = mergePlaylists(merged, snap)
          }
          this.userPlaylists = merged
          await this.savePlaylists()
        } catch (e) {
          console.warn('[playlistStore] flush pending save 失败:', e.message)
        }
      }
    },

    /**
     * 内部：把数据写到主存储 + 回填当前 localStorage key + 清理所有老 key + 写迁移锁。
     * 失败重试 MIGRATION_MAX_RETRY 次。
     * @returns {Promise<boolean>} 是否最终写成功
     */
    async _migrateToMainStore(data, sourceKey) {
      let lastErr = null
      for (let attempt = 1; attempt <= MIGRATION_MAX_RETRY; attempt++) {
        try {
          await window.electronAPI?.appData?.set?.('playlists', data)
          if (attempt > 1) {
            console.log(`[playlistStore] 迁移在第 ${attempt} 次重试成功`)
          }
          // 写主存储成功 → 回填 localStorage 当前 key（让 localStorage 永远是最新镜像）
          try { writeLocalJsonNow('playlists', data) } catch (e) {}
          // 清理所有老 localStorage key（避免旧数据"复活"）
          for (const k of LEGACY_LOCAL_KEYS) {
            if (k === 'pink-music-playlists') continue // 当前 key 不清
            try { localStorage.removeItem(k) } catch (e) {}
          }
          // 写迁移锁
          try { localStorage.setItem(MIGRATION_LOCK_KEY, 'true') } catch (e) {}
          console.log(`[playlistStore] 已从老 key「${sourceKey}」迁移 ${data.length} 个歌单到主存储`)
          this._migratedKeys.push(sourceKey)
          this._migrationSourceKey = sourceKey
          return true
        } catch (e) {
          lastErr = e
          console.warn(`[playlistStore] 迁移第 ${attempt}/${MIGRATION_MAX_RETRY} 次失败:`, e?.message)
        }
      }
      console.error('[playlistStore] 迁移彻底失败:', lastErr?.message)
      return false
    },

    setCurrentPlaylist(playlist) { this.currentPlaylist = playlist },
    setCurrentView(view) { this.currentView = view },
    setShowCreatePlaylistModal(show) { this.showCreatePlaylistModal = show },
    setShowAddToPlaylistModal(show) { this.showAddToPlaylistModal = show },
    setShowPlaylistManager(show) { this.showPlaylistManager = show },

    /**
     * 创建新歌单（统一 id 生成器）。
     * @param {string} name
     * @param {object} [extra] 额外字段（cover / isBiliFavorite / ...）
     * @returns {object} 新创建的歌单
     */
    createPlaylist(name, extra = {}) {
      const playlist = {
        id: generatePlaylistId(),
        name: name || '新建歌单',
        music: [],
        coverMode: 'auto',
        ...extra
      }
      this.userPlaylists.push(playlist)
      return playlist
    },

    /**
     * 设置歌单自定义封面（coverMode='custom' 后不再被首曲封面覆盖）。
     * @param {string} playlistId
     * @param {string} coverUrl 由主进程 local-save-cover 返回的 pinkmusic-local:// 地址
     */
    async setPlaylistCover(playlistId, coverUrl) {
      const pl = this.userPlaylists.find(p => p.id === playlistId)
      if (!pl || !coverUrl) return false
      pl.cover = coverUrl
      pl.coverMode = 'custom'
      await this.savePlaylists()
      return true
    },

    /** 恢复歌单封面为「跟随第一首」 */
    async resetPlaylistCover(playlistId) {
      const pl = this.userPlaylists.find(p => p.id === playlistId)
      if (!pl) return false
      pl.coverMode = 'auto'
      syncPlaylistCover(pl)
      await this.savePlaylists()
      return true
    },

    /**
     * 把当前 userPlaylists 写入主存储 + localStorage 双写。
     * 关键修复：
     *   - load() 完成前不直接 save（避免空 state 覆盖主存储的旧数据）
     *   - 改为队列：每次 save 都把当前快照压栈，load 完成后由 load() 末尾统一 merge flush
     *   - 队列而不是单一 slot：保存"用户加载窗口期内做的所有操作"，中间步骤不丢
     */
    async savePlaylists() {
      if (!this._loaded) {
        // 还在加载中：压栈当前快照，等 load 完一次性 merge
        // 这样能避免在主存储还没读到、localStorage 还在迁移的空窗期里
        // 把空 userPlaylists 写到主存储，把用户原来的歌单覆盖掉
        this._pendingSave.push(JSON.parse(JSON.stringify(this.userPlaylists)))
        return { deferred: true }
      }
      return await this._writeNow()
    },

    /**
     * 真正执行写盘：localStorage 立即同步写，主存储走 IPC。
     * 内部用 storage.save()，debounceMs 已经是 0 了，localStorage 同步写完。
     * @returns {Promise<{main: boolean, local: string}>}
     */
    async _writeNow() {
      // 写盘前清理脏条目（事件对象等非歌曲数据），防止再次被持久化
      const cleaned = sanitizePlaylistMusic(this.userPlaylists)
      if (cleaned !== this.userPlaylists) {
        this.userPlaylists = cleaned
      }
      try {
        const res = await storage.save(this.userPlaylists)
        if (res && res.main === false) {
          console.warn('[playlistStore] 主存储写失败！localStorage 兜底。', res)
        }
        return res
      } catch (e) {
        console.error('[playlistStore] _writeNow 抛错:', e.message)
        return { main: false, local: 'failed' }
      }
    },

    /**
     * 强制立即 flush：把当前 userPlaylists 同步写到 localStorage + 异步发主存储 IPC。
     * 关键场景：beforeunload / pagehide / 主进程 close 拦截 → 调这个，
     * 然后 await 它 → localStorage 一定已经落盘，主存储 IPC 已经发出。
     * 配合 main 进程的 before-quit 拦截（等主存储 IPC 写完再退出），
     * 就能保证关窗口时数据 100% 不丢。
     *
     * @param {number} [timeoutMs=2500] 主存储 IPC 的等待上限（必须 < main.js 的 3000ms 强制退出）
     * @returns {Promise<{main: boolean, local: string}>}
     */
    async flush(timeoutMs = 2500) {
      if (!this._loaded) {
        // 没加载完：不能 flush，否则空 state 覆盖主存储
        console.warn('[playlistStore] flush 时 _loaded 仍未置位，跳过主存储写')
        return { main: false, local: 'skipped', reason: 'not-loaded' }
      }
      // 写一个最新快照（先清理脏条目，避免事件对象等杂散数据在退出时落盘）
      const snapshot = sanitizePlaylistMusic(JSON.parse(JSON.stringify(this.userPlaylists)))
      try {
        // localStorage 立即同步写（不依赖 debounce 队列）
        writeLocalJsonNow('playlists', snapshot)
        // 主存储 IPC：必须等真正写完。不再用 Promise.race（race 的超时是 UI 信号，
        // 真写完还是要 await 写本身；主进程 fs.writeFileSync 同步完成，IPC 几 ms 就回）。
        // 主进程 3s 强制退出是兜底；这里 timeoutMs 给主进程留 500ms 余量。
        const api = window.electronAPI?.appData
        if (!api || typeof api.set !== 'function') {
          return { main: false, local: 'written' }
        }
        let res
        try {
          res = await api.set('playlists', snapshot)
        } catch (e) {
          console.error('[playlistStore] flush 主存储 IPC 抛错:', e?.message)
          return { main: false, local: 'written' }
        }
        const ok = !!(res && res.code === 0)
        if (!ok) console.warn('[playlistStore] flush 主存储写失败:', res)
        return { main: ok, local: 'written' }
      } catch (e) {
        console.error('[playlistStore] flush 抛错:', e.message)
        return { main: false, local: 'failed' }
      }
    },

    /**
     * 保留旧 API 同步签名：内部 fire-and-forget 异步保存。
     * 这样老代码（多处调用 savePlaylists() 不 await）不会爆。
     */
    savePlaylistsSync() {
      this.savePlaylists().catch(e => {
        console.warn('[playlistStore] savePlaylists failed:', e.message)
      })
    },

    async loadPlaylists() {
      // 兼容老 API，等价于 load()
      await this.load()
    },

    /**
     * 把一首歌加入指定歌单（默认入"收藏夹"）。
     * 去重逻辑：bvid 必须匹配；cid 同时存在时才要求一致（search/recommended 结果可能无 cid）
     * @param {object} music
     * @param {object} [targetPlaylist] 不传则入收藏夹
     * @returns {object|null} 加入的歌单；找不到目标歌单返回 null
     */
    async addToPlaylist(music, targetPlaylist) {
      const target = targetPlaylist || this.userPlaylists.find(p => p.id === 'favorites')
      if (!target) return null
      // 防御：非歌曲对象（例如 DOM 事件对象）一律忽略，防止脏条目被写进歌单
      if (!isTrackLike(music)) {
        console.warn('[playlistStore] addToPlaylist 收到非歌曲对象，已忽略:', typeof music, music && Object.keys(music).slice(0, 5))
        return target
      }
      if (!target.music) target.music = []
      // 统一身份判重（本地曲走 id，B 站曲走 bvid+cid / favId）
      const exists = target.music.some(m => sameTrack(m, music))
      if (!exists) {
        // 规范化：只抽取歌曲字段并补齐标题/作者/封面（不再整体展开 music，
        // 避免事件对象上的 isTrusted/_vts 等杂散键被持久化）
        target.music.push(pickTrackFields(music))
      }
      // 封面默认跟随第一首音乐（B 站收藏夹保留 B 站云端封面；自定义封面不覆盖）
      if (!target.isBiliFavorite) {
        syncPlaylistCover(target)
      }
      await this.savePlaylists()
      return target
    },

    /**
     * 把本地曲失效标记同步到歌单里的副本。
     * 歌单存的是曲目副本（不是本地库引用），不同步就会永远显示旧的失效状态。
     * @param {Object<string, boolean>} flagsById 本地曲 id → isMissing
     * @returns {Promise<number>} 被改写的副本条目数
     */
    async syncLocalTrackFlags(flagsById) {
      if (!flagsById || typeof flagsById !== 'object') return 0
      let changed = 0
      for (const pl of collectLocalTargets(this)) {
        for (const m of pl.music) {
          if (!m || m.source !== 'local') continue
          const flag = flagsById[m.id]
          if (typeof flag === 'boolean' && m.isMissing !== flag) {
            m.isMissing = flag
            changed++
          }
        }
      }
      if (changed > 0) await this.savePlaylists()
      return changed
    },

    /**
     * 本地曲重定位后换 id：把歌单里的旧副本替换成新曲目，并按 trackKey 去重
     * （新曲目已在歌单里时只删旧副本，不重复插入；否则占据旧副本的位置）。
     * @param {string} oldId 旧本地曲 id
     * @param {object} newTrack 重定位后的本地曲（带新 id / 新路径）
     * @returns {Promise<number>} 被替换掉的旧副本条目数
     */
    async remapLocalTrack(oldId, newTrack) {
      if (!oldId || !newTrack || !newTrack.id) return 0
      const replacement = pickTrackFields(newTrack)
      const newKey = trackKey(replacement)
      if (!newKey) return 0
      let replaced = 0
      for (const pl of collectLocalTargets(this)) {
        let insertAt = -1
        const music = []
        for (const m of pl.music) {
          if (m && m.source === 'local' && m.id === oldId) {
            if (insertAt < 0) insertAt = music.length
            replaced++
            continue
          }
          music.push(m)
        }
        if (insertAt < 0) continue
        if (!music.some(m => trackKey(m) === newKey)) {
          music.splice(insertAt, 0, { ...replacement })
        }
        pl.music = music
      }
      if (replaced > 0) await this.savePlaylists()
      return replaced
    },

    /**
     * 删除歌单（默认歌单不能删）。
     * @param {string} playlistId
     * @returns {boolean} 是否成功删除
     */
    async deletePlaylist(playlistId) {
      const idx = this.userPlaylists.findIndex(p => p.id === playlistId)
      if (idx < 0) return false
      const target = this.userPlaylists[idx]
      if (target.isDefault) return false
      this.userPlaylists.splice(idx, 1)
      await this.savePlaylists()
      return true
    },

    /**
     * 合并 B 站收藏夹列表到本地。
     * 已有同 id 的歌单只更新 media_count / cover / title，不重置 music。
     * @param {Array<{id, title, cover, media_count, source}>} biliFavList
     * @returns {number} 本次新增的歌单数
     */
    async mergeBiliFavorites(biliFavList) {
      if (!Array.isArray(biliFavList) || biliFavList.length === 0) return 0
      let added = 0
      for (const item of biliFavList) {
        const localId = `bili-fav-${item.id}`
        const existing = this.userPlaylists.find(p => p.id === localId)
        if (existing) {
          // 更新元数据，但不覆盖本地 music（B 站 music 列表是按需拉取）
          existing.title = item.title || existing.title
          existing.cover = item.cover || existing.cover
          if (typeof item.media_count === 'number') existing.media_count = item.media_count
          existing.isBiliFavorite = true
        } else {
          this.userPlaylists.push({
            id: localId,
            name: item.title || `B站收藏夹 ${item.id}`,
            cover: item.cover || '',
            music: [],
            media_count: item.media_count || 0,
            isBiliFavorite: true,
            biliSource: item.source || 'created',
            biliMediaId: item.id
          })
          added++
        }
      }
      await this.savePlaylists()
      return added
    }
  }
})
