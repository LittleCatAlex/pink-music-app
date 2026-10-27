/**
 * 持久化存储 — 渲染层封装（v2：schema 校验 + localStorage 节流）
 * ─────────────────────────────────────────────────────────────
 * 策略：
 * - 主存储：主进程 userData/app-data/<key>.json（原子写 + .bak 备份 + 损坏自愈）
 *   升级/重装软件时，userData 目录由 Electron 保留，数据天然不丢
 * - 兜底存储：localStorage（沿用旧 key 命名 'pink-music-*'）
 *   任何一次写入同时写主存储 + localStorage；读取时主存储优先，缺失才读 localStorage
 * - 自动迁移：第一次 load 时若主存储为空但 localStorage 有数据，
 *   自动把 localStorage 数据搬到主存储（用户无感知）
 * - v2 新增：
 *   - schema 校验：声明式定义数据结构 + 版本号，load() 时自动校验/兜底/迁移
 *   - localStorage 节流：快速重复 save() 时只最后一次实际写盘（默认 200ms）
 *   - 值未变则跳过：JSON 不变就不写，进一步减少序列化开销
 *   - beforeunload flush：页面卸载前强制 flush 所有 pending 写
 *
 * 用法（每个 store 用一个独立 key）：
 *   const storage = createPersistentStorage('settings', { schema: settingsSchema })
 *   await storage.load()   // 初始化（async，自动 schema 校验 + 迁移）
 *   await storage.save({ audioVisualizerEnabled: true })
 *   await storage.remove()
 *
 * 同步快捷（state 初始化用）：
 *   storage.peek(default)  // 仅读 localStorage（同步），用于 store state() 初值
 */

const LOCAL_PREFIX = 'pink-music-'

/**
 * 判断 localStorage 异常是否为配额满。
 * 跨浏览器：Chrome/Edge/Safari 都用 QuotaExceededError，但 name 命名有差异，
 * 同时检查 code === 22 / code === 1014 (旧 Firefox) 兜底。
 */
function isQuotaError(e) {
  if (!e) return false
  if (e.name === 'QuotaExceededError' ||
      e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      e.code === 22 ||
      e.code === 1014) return true
  // Safari 私密浏览模式也会抛 quota，但 message 不一定标准
  return /quota/i.test(e.message || '')
}

// 老 key 注册表：用于"清空所有缓存"和"重置应用"工具。
// 渲染层每一处绕过 createPersistentStorage 的 localStorage 写都登记在这里。
// 注意：这些是 *历史* / 兜底 key 名字；新写入走统一的 'pink-music-<storeKey>'。
export const LEGACY_LOCAL_KEYS = [
  'bilibili-login-cookie',
  'pink-music-color',
  'pink-music-audio-visualizer-enabled',
  'pink-music-audio-visualizer-intensity',
  'pink-music-audio-quality',
  'pink-music-window-controls-enabled',
  'pink-music-audio-eq-enabled',
  'pink-music-audio-eq-bands',
  'pink-music-audio-eq-preset',
  'pink-music-lyric-cache',
  'pink-music-lyric-offsets',
  'pink-music-lyric-sources',
  'pink-music-history',
  'playlists',
  'userPlaylists',
  'pink-music-favorites',
  'pink-music-migrated-v3'
]

// 每个 store 一个 debounce timer
const _pendingWrites = new Map() // storeKey -> { value, timer, latestSerialized }

function localKey(storeKey) {
  return LOCAL_PREFIX + storeKey
}

function readLocalJson(storeKey) {
  try {
    const raw = localStorage.getItem(localKey(storeKey))
    if (!raw) return null
    return JSON.parse(raw)
  } catch (e) {
    return null
  }
}

/**
 * 同步写 localStorage。仅在 JSON 真的变了的时候才写。
 * @returns {boolean} 是否真的写了
 */
function writeLocalJsonNow(storeKey, value) {
  try {
    const serialized = JSON.stringify(value)
    const existing = localStorage.getItem(localKey(storeKey))
    if (existing === serialized) {
      // 值没变，跳过（省去一次磁盘写）
      return false
    }
    localStorage.setItem(localKey(storeKey), serialized)
    return true
  } catch (e) {
    // QuotaExceededError：先清掉已知的老 legacy key 腾空间，再重试一次
    if (isQuotaError(e)) {
      console.warn(`[persistentStorage] localStorage quota 满，清理 LEGACY_LOCAL_KEYS 后重试 ${storeKey}`)
      for (const legacyKey of LEGACY_LOCAL_KEYS) {
        try { localStorage.removeItem(legacyKey) } catch (_) {}
      }
      try {
        localStorage.setItem(localKey(storeKey), JSON.stringify(value))
        return true
      } catch (e2) {
        console.warn(`[persistentStorage] 重试后仍失败 ${storeKey}:`, e2.message)
        return false
      }
    }
    // localStorage 可能 quota 满 —— 主存储才是主存，所以这里只 warn 不抛
    console.warn(`[persistentStorage] localStorage 写 ${storeKey} 失败:`, e.message)
    return false
  }
}

/**
 * debounce 写 localStorage。200ms 内的多次调用合并成一次写。
 * 注意：主存储不 debounce（必须每次都落盘保安全），debounce 的只是双写里 localStorage 这条腿。
 */
function writeLocalJsonDebounced(storeKey, value, debounceMs) {
  if (debounceMs <= 0) {
    return writeLocalJsonNow(storeKey, value)
  }
  const existing = _pendingWrites.get(storeKey)
  if (existing) {
    clearTimeout(existing.timer)
  }
  const timer = setTimeout(() => {
    const pending = _pendingWrites.get(storeKey)
    _pendingWrites.delete(storeKey)
    if (pending) writeLocalJsonNow(storeKey, pending.value)
  }, debounceMs)
  _pendingWrites.set(storeKey, { value, timer })
}

/**
 * 强制 flush 所有 pending 的 localStorage 写。beforeunload 时调用。
 */
export function flushPendingLocalWrites() {
  for (const [storeKey, pending] of _pendingWrites.entries()) {
    clearTimeout(pending.timer)
    writeLocalJsonNow(storeKey, pending.value)
    _pendingWrites.delete(storeKey)
  }
}

// 注册页面卸载时强制 flush（防止节流窗口内丢最后一次写）
let _flushHandlerInstalled = false
if (typeof window !== 'undefined') {
  if (!_flushHandlerInstalled) {
    _flushHandlerInstalled = true
    const handler = () => {
      try { flushPendingLocalWrites() } catch (_) {}
    }
    // 多个事件都覆盖到（beforeunload 是浏览器标准；pagehide 在 BFCache 场景更可靠）
    window.addEventListener('beforeunload', handler)
    window.addEventListener('pagehide', handler)
  }
}

/**
 * 创建某个 key 的持久化存储句柄
 * @param {string} storeKey 业务 key（如 'theme' / 'settings' / 'playlists' / 'lyrics' / 'login'）
 * @param {object} [options]
 * @param {object} [options.schema]   schema 校验定义（来自 defineSchema）
 * @param {boolean} [options.encrypt]  是否走加密通道（主进程 safeStorage 加密）
 * @param {number} [options.debounceMs=200] localStorage debounce 毫秒数；0 = 不 debounce
 */
export function createPersistentStorage(storeKey, options = {}) {
  if (!storeKey || typeof storeKey !== 'string') {
    throw new Error('[persistentStorage] storeKey 必须是非空字符串')
  }
  const { schema = null, encrypt = false, debounceMs = 200 } = options

  // 选择 IPC 通道：加密 vs 普通
  const api = (encrypt ? window.electronAPI?.appDataEncrypted : window.electronAPI?.appData) || null
  // 区分两种主存状态：
  //  - _apiAvailable = false：通道根本没暴露（preload.js 漏了 / 非 Electron 环境）
  //  - _apiAvailable = true 但 res.code !== 0：通道存在但主存 IPC 报错
  // 区分清楚后日志噪音可读、调试更快
  const _apiAvailable = !!api
  const _channelLabel = encrypt ? 'appDataEncrypted' : 'appData'
  if (!_apiAvailable) {
    console.warn(`[persistentStorage] ${storeKey}: ${_channelLabel} 通道不可用（preload 没暴露？非 Electron？），主存会静默跳过`)
  }

  /** 跑 schema 校验 + 迁移。如果没声明 schema，原样返回。 */
  function applySchema(raw) {
    if (!schema || !raw || typeof raw !== 'object') return raw
    // schema.parse 内部会处理 version + 字段兜底
    return schema.parse(raw)
  }

  return {
    /**
     * 同步 peek：返回 localStorage 镜像（双写策略保证 localStorage = 主存最新值）。
     * 注意：主存崩溃恢复场景下这里看到的是"已知最后成功值"，不会比主存更旧。
     * 用途：store state() 初值，避免首帧渲染时空 state → populate 引起的 UI 闪烁
     */
    peek(defaultValue = null) {
      const local = readLocalJson(storeKey)
      return local !== null ? applySchema(local) : defaultValue
    },

    /**
     * 异步加载。主存储优先，主存储为空时回退 localStorage 并触发迁移。
     * @param {*} defaultValue 主存储和 localStorage 都为空时的兜底值
     * @returns {Promise<*>}
     */
    async load(defaultValue = null) {
      // 1) 优先主存储
      if (_apiAvailable) {
        try {
          const res = await api.get(storeKey)
          if (res && res.code === 0 && res.data !== null && res.data !== undefined) {
            return applySchema(res.data)
          }
          if (res && res.code !== 0) {
            console.warn(`[persistentStorage] 主存储读 ${storeKey} 失败: code=${res.code} msg=${res.message}`)
          }
        } catch (e) {
          console.error(`[persistentStorage] 主存储读 ${storeKey} 抛错:`, e.message)
        }
      }
      // 2) 回退 localStorage
      const local = readLocalJson(storeKey)
      if (local !== null) {
        // 关键修复：迁移必须 await，不能 fire-and-forget！
        // 原因：fire-and-forget 模式下，load() 立刻返回了 localStorage 数据，
        // 后续 save() 也会同时往主存储写，两次并发写会互相覆盖，
        // 并且迁移的写可能在 save 之后到达，导致本地内存有的数据落盘后又被空数据覆盖。
        // await 后，迁移一定先完成，再返回，调用方就可以安全 save 了。
        if (_apiAvailable) {
          try {
            await api.set(storeKey, local)
          } catch (err) {
            console.warn(`[persistentStorage] 迁移 ${storeKey} 到主存储失败:`, err.message)
          }
        }
        return applySchema(local)
      }
      // 3) 都没有 → 默认值
      return defaultValue
    },

    /**
     * 异步保存。主存储每次都写；localStorage 走 debounce + 值未变跳过。
     * @param {*} value
     * @returns {Promise<{ main: boolean, local: 'pending'|'written'|'skipped'|'failed' }>}
     */
    async save(value) {
      const result = { main: false, local: 'skipped' }
      // 剥离 Pinia reactive Proxy：IPC 结构化克隆无法序列化 Proxy，
      // 否则主存储写入会抛 "An object could not be cloned."（settings/player 长期丢数据的根因）
      try { value = JSON.parse(JSON.stringify(value)) } catch (e) {
        console.warn(`[persistentStorage] save ${storeKey} 深拷贝失败:`, e.message)
      }
      if (schema && typeof schema.version === 'number' && typeof value === 'object' && value !== null) {
        if (!('_schemaVersion' in value)) {
          value._schemaVersion = schema.version
        }
      }
      // localStorage 走 debounce（200ms 内合并 + 值未变跳过）
      const localWritten = writeLocalJsonDebouncedOrNow(storeKey, value, debounceMs)
      if (localWritten === 'written') result.local = 'written'
      else if (localWritten === 'failed') result.local = 'failed'
      // 'debounced' 表示进了待写队列但还没真正落盘
      else if (localWritten === 'debounced') result.local = 'pending'
      else result.local = 'skipped'
      // 主存储（加密或普通）异步写
      if (_apiAvailable) {
        try {
          const res = await api.set(storeKey, value)
          result.main = !!(res && res.code === 0)
          if (!result.main) {
            console.warn(`[persistentStorage] 主存储写 ${storeKey} 失败: code=${res?.code} msg=${res?.message}`)
          }
        } catch (e) {
          console.error(`[persistentStorage] 主存储写 ${storeKey} 抛错:`, e.message)
        }
      }
      return result
    },

    /**
     * 显式删除（清空主存储 + localStorage）
     */
    async remove() {
      // 清掉 pending 队列
      const pending = _pendingWrites.get(storeKey)
      if (pending) {
        clearTimeout(pending.timer)
        _pendingWrites.delete(storeKey)
      }
      try { localStorage.removeItem(localKey(storeKey)) } catch (e) {}
      if (_apiAvailable) {
        try { await api.remove(storeKey) } catch (e) {} }
    },

    /** 调试用：是否在 pending 队列里 */
    hasPendingWrite() {
      return _pendingWrites.has(storeKey)
    }
  }
}

// 把 debounce 拆出来以便 test：返回 'written' | 'debounced' | 'skipped' | 'failed'
function writeLocalJsonDebouncedOrNow(storeKey, value, debounceMs) {
  if (debounceMs <= 0) {
    const ok = writeLocalJsonNow(storeKey, value)
    return ok ? 'written' : 'failed'
  }
  // 同步算一次序列化，看值是不是真的变了
  let serialized
  try { serialized = JSON.stringify(value) } catch (e) { return 'failed' }
  try {
    const existing = localStorage.getItem(localKey(storeKey))
    if (existing === serialized) return 'skipped'
  } catch (e) {
    // 读 localStorage 异常 → 走 debounce 兜底
  }
  // 值变了（或读不到 old value）→ 进 debounce 队列
  const pending = _pendingWrites.get(storeKey)
  if (pending) clearTimeout(pending.timer)
  const timer = setTimeout(() => {
    const p = _pendingWrites.get(storeKey)
    _pendingWrites.delete(storeKey)
    if (p) writeLocalJsonNow(storeKey, p.value)
  }, debounceMs)
  _pendingWrites.set(storeKey, { value, timer, serialized })
  return 'debounced'
}

// ============== 导出 ==============
// flushPendingLocalWrites 已经在上面以 function export 形式导出过了
// 这里只 re-export 之前是 internal 的 helper
export {
  readLocalJson,
  writeLocalJsonNow,
  localKey
}
