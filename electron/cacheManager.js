const fs = require('fs')
const path = require('path')

// 缓存落盘：优先 userData（跨升级保留、打包可写），Node 单测回退项目目录
function resolveCacheRoot() {
  try {
    const { app } = require('electron')
    if (app && typeof app.getPath === 'function') {
      return path.join(app.getPath('userData'), 'cache')
    }
  } catch (_) { /* not in electron */ }
  return path.join(__dirname, '..', 'cache')
}

const SAVE_DEBOUNCE_MS = 400

class CacheManager {
  constructor() {
    const root = resolveCacheRoot()
    this.cacheDir = path.join(root, 'audio')
    this.dbPath = path.join(root, 'cache.db.json')
    this.db = null
    this._saveTimer = null

    this.initCacheDir()
    this.initDatabaseSimple()
  }

  initCacheDir() {
    try {
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true })
      }
    } catch (error) {
      console.error('初始化缓存目录失败:', error)
    }
  }

  initDatabaseSimple() {
    try {
      const dbDir = path.dirname(this.dbPath)
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true })
      }

      if (fs.existsSync(this.dbPath)) {
        const data = fs.readFileSync(this.dbPath, 'utf8')
        this.db = JSON.parse(data)
        if (!this.db.cache) this.db.cache = {}
        if (!this.db.collection) this.db.collection = {}
      } else {
        this.db = { cache: {}, collection: {} }
        this.saveDatabase()
      }
    } catch (error) {
      console.error('初始化数据库失败:', error)
      this.db = { cache: {}, collection: {} }
    }
  }

  /** 紧凑 JSON 落盘（禁止 pretty-print，下载/播放热路径不能每次全量 indent） */
  saveDatabase() {
    try {
      const dir = path.dirname(this.dbPath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(this.dbPath, JSON.stringify(this.db))
    } catch (error) {
      console.error('保存数据库失败:', error)
    }
  }

  _scheduleSave() {
    if (this._saveTimer) return
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null
      this.saveDatabase()
    }, SAVE_DEBOUNCE_MS)
    if (typeof this._saveTimer.unref === 'function') this._saveTimer.unref()
  }

  /** 立即落盘并取消 pending debounce（退出/关键状态用） */
  flush() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer)
      this._saveTimer = null
    }
    this.saveDatabase()
  }

  getCacheFilePath(bvid, quality = 'mp3') {
    return path.join(this.cacheDir, `${bvid}_${quality}`)
  }

  hasCache(bvid, quality = 'mp3') {
    const filePath = this.getCacheFilePath(bvid, quality)
    return fs.existsSync(filePath)
  }

  /**
   * 更新缓存元数据。
   * @param {object} [options]
   * @param {boolean} [options.immediate] true 时立刻写盘（完成/删除等关键节点）
   */
  saveCacheInfo(bvid, quality, info, options = {}) {
    if (!this.db) return
    const key = `${bvid}_${quality}`
    this.db.cache[key] = {
      ...info,
      updatedAt: Date.now()
    }
    if (options.immediate) this.flush()
    else this._scheduleSave()
  }

  deleteCache(bvid, quality = 'mp3') {
    if (!this.db) return
    const filePath = this.getCacheFilePath(bvid, quality)
    const key = `${bvid}_${quality}`

    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath) } catch (e) { console.warn('删除缓存文件失败:', e.message) }
    }

    delete this.db.cache[key]
    this.flush()
  }

  cleanExpiredCache() {
    if (!this.db) return
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000

    for (const key in this.db.cache) {
      const cache = this.db.cache[key]
      if (cache.updatedAt < sevenDaysAgo) {
        const idx = key.lastIndexOf('_')
        const bvid = idx > 0 ? key.slice(0, idx) : key
        const quality = idx > 0 ? key.slice(idx + 1) : 'mp3'
        this.deleteCache(bvid, quality)
      }
    }
  }

  clearAllCache() {
    if (!this.db) return
    this.db.cache = {}
    this.flush()

    try {
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true })
        return
      }
      fs.readdirSync(this.cacheDir, { withFileTypes: true }).forEach((entry) => {
        if (entry.isFile()) {
          try { fs.unlinkSync(path.join(this.cacheDir, entry.name)) } catch (_) {}
        }
      })
    } catch (error) {
      console.error('清空缓存失败:', error)
    }
  }

  saveCollectionData(collectionId, data) {
    if (!this.db) return
    this.db.collection[collectionId] = {
      ...data,
      updatedAt: Date.now()
    }
    this._scheduleSave()
  }

  getCollectionData(collectionId) {
    if (!this.db) return null
    const data = this.db.collection[collectionId]
    if (!data) return null

    const thirtyMinutesAgo = Date.now() - 30 * 60 * 1000
    if (data.updatedAt < thirtyMinutesAgo) {
      delete this.db.collection[collectionId]
      this._scheduleSave()
      return null
    }

    return data
  }

  getCacheInfo(bvid, quality = 'mp3') {
    if (!this.db) return null
    return this.db.cache[`${bvid}_${quality}`]
  }

  getCacheDir() {
    return this.cacheDir
  }

  getDbPath() {
    return this.dbPath
  }
}

module.exports = new CacheManager()
