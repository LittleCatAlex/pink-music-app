import { defineStore } from 'pinia'
import { createPersistentStorage } from '@/utils/persistentStorage'
import { s, defineSchema } from '@/utils/schema'

// 登录态 UI 标记：原本散在 localStorage 的 'bilibili-login-cookie'
// 现在主存到 userData/app-data/login.json（**用 safeStorage 加密**），localStorage 作 fallback
//
// Schema v1：登录 cookie 至少含 SESSDATA（其他字段如 bili_jct、vip_status 不强校验）
const loginSchema = defineSchema({
  version: 1,
  fields: {
    SESSDATA: s.string(''),
    bili_jct: s.string(''),
    DedeUserID: s.string(''),
    // 任何扩展字段都保留在 unknown 桶
  }
})

const loginStorage = createPersistentStorage('login', {
  encrypt: true,            // 走 safeStorage 加密通道
  debounceMs: 0,            // 登录态不能 debounce：扫码成功/退出登录必须立刻落盘
  schema: loginSchema
})

export const useUserStore = defineStore('user', {
  state: () => ({
    userInfo: null,
    isLoggedIn: false,
    qrcodeUrl: '',
    qrcodeKey: '',
    qrcodeStatus: 'idle',
    qrcodeMessage: '',
    isPolling: false,
    isSyncingFavorites: false,
    _pollTimer: null,
    _lastFavError: ''
  }),
  getters: {
    /** 是否存在 B 站登录 cookie（主存储优先，缺失回退 localStorage） */
    hasLoginCookie(state) {
      if (state.isLoggedIn) return true
      // 主存储 peek（同步走 localStorage 缓存层）
      const peeked = loginStorage.peek(null)
      if (peeked && peeked.SESSDATA) return true
      // localStorage 老 key 兜底
      try {
        const raw = localStorage.getItem('bilibili-login-cookie')
        if (raw) {
          const parsed = JSON.parse(raw)
          return !!(parsed && parsed.SESSDATA)
        }
      } catch (e) { /* ignore */ }
      return false
    }
  },
  actions: {
    /**
     * 启动时调用：从主存储恢复登录 cookie 标记。
     * 注意：真正的 SESSDATA 仍在主进程 bilibili-cookies.json 里，
     * 这里只缓存 UI 用得到的简化版（用于 hasLoginCookie getter）。
     */
    async load() {
      const data = await loginStorage.load(null)
      if (data && data.SESSDATA) {
        // 触发迁移：写到 localStorage 兜底（保持老代码兼容）
        try { localStorage.setItem('bilibili-login-cookie', JSON.stringify(data)) } catch (_) {}
      }
    },
    setQrcodeStatus(status, message = '') {
      this.qrcodeStatus = status
      this.qrcodeMessage = message
    },
    async generateQrCode() {
      if (!window.electronAPI) return
      // 已登录时不重新生成二维码，避免覆盖已登录 UI
      if (this.hasLoginCookie) {
        return
      }
      this.setQrcodeStatus('loading', '正在生成二维码...')
      this.userInfo = null
      this.isLoggedIn = false
      this.qrcodeUrl = ''
      this.qrcodeKey = ''
      this.stopPolling()
      try {
        const result = await window.electronAPI.generateQrcode()
        if (result?.code === 0 && result.data) {
          this.qrcodeUrl = result.data.url
          this.qrcodeKey = result.data.qrcode_key
          this.setQrcodeStatus('waiting', '请使用 B 站手机客户端扫码登录')
          this.startPolling()
        } else {
          this.setQrcodeStatus('error', result?.message || '生成二维码失败')
        }
      } catch (error) {
        this.setQrcodeStatus('error', error.message || '生成二维码失败')
      }
    },
    startPolling() {
      this.stopPolling()
      this.isPolling = true
      this._pollTimer = setInterval(() => {
        this.pollOnce().catch(() => {})
      }, 2000)
      this.pollOnce().catch(() => {})
    },
    stopPolling() {
      if (this._pollTimer) {
        clearInterval(this._pollTimer)
        this._pollTimer = null
      }
      this.isPolling = false
    },
    async pollOnce() {
      if (!this.qrcodeKey || !window.electronAPI) return
      try {
        const result = await window.electronAPI.pollQrcode(this.qrcodeKey)
        if (result?.code !== 0) {
          this.setQrcodeStatus('error', result?.message || '轮询失败')
          this.stopPolling()
          return
        }
        const data = result.data?.data
        if (!data) return
        const code = data.code
        if (code === 0) {
          this.stopPolling()
          this.setQrcodeStatus('success', '登录成功')
          await this.fetchUserInfo()
        } else if (code === 86090) {
          this.setQrcodeStatus('scanned', '已扫码，请在手机上确认登录')
        } else if (code === 86038) {
          this.setQrcodeStatus('expired', '二维码已失效，请刷新')
          this.stopPolling()
        } else if (code === 86101) {
          this.setQrcodeStatus('waiting', '请使用 B 站手机客户端扫码登录')
        } else {
          this.setQrcodeStatus('error', data.message || '登录失败')
        }
      } catch (error) {
        this.setQrcodeStatus('error', error.message || '轮询失败')
        this.stopPolling()
      }
    },
    async fetchUserInfo() {
      if (!window.electronAPI) return
      try {
        // 同步把主进程持久化 cookie 写进主存储（loginStorage.save 内部已含 localStorage 双写）
        try {
          const cookieRes = await window.electronAPI.getBilibiliCookies()
          if (cookieRes?.code === 0 && cookieRes.data) {
            await loginStorage.save(cookieRes.data)
          }
        } catch (e) { /* ignore */ }
        const result = await window.electronAPI.getUserInfo()
        // B 站 nav 接口返回 { code, message, ttl, data: { isLogin, mid, uname, ... } }
        // IPC handler 直接 return 该对象，渲染进程收到 result = { code, message, data: {...} }
        if (result?.code === 0 && result.data && result.data.mid) {
          this.userInfo = result.data
          this.isLoggedIn = !!this.userInfo.mid
          return this.userInfo
        } else {
          // 未登录或 cookie 失效：清空主存储（loginStorage.remove 内部已含 localStorage 清理）
          try { await loginStorage.remove() } catch (_) {}
          this.userInfo = null
          this.isLoggedIn = false
          return null
        }
      } catch (error) {
        console.error('获取用户信息失败:', error)
        return null
      }
    },
    // 启动时检查主进程是否持有 B 站登录 cookie
    async restoreFromCookies() {
      if (!window.electronAPI) return false
      try {
        const res = await window.electronAPI.getBilibiliCookies()
        if (res?.code === 0 && res.data && res.data.SESSDATA) {
          // 主存储 + localStorage 双写（loginStorage.save 内部已含）
          await loginStorage.save(res.data)
          // 同时尝试拉取用户信息
          const info = await this.fetchUserInfo()
          return !!info?.mid
        }
      } catch (error) {
        console.error('restoreFromCookies 失败:', error)
      }
      return false
    },
    // 启动时检查 session 中是否仍有登录 cookie，若有则恢复登录态
    async restoreSession() {
      if (!window.electronAPI) return false
      try {
        const info = await this.fetchUserInfo()
        return !!info?.mid
      } catch (error) {
        return false
      }
    },
    async syncFavorites(playlistStore) {
      if (!this.userInfo?.mid || !window.electronAPI) return 0
      this.isSyncingFavorites = true
      try {
        const [createdRes, collectedRes] = await Promise.all([
          window.electronAPI.getFavFolderCreatedList(this.userInfo.mid, 1, 50),
          window.electronAPI.getFavFolderCollectedList(this.userInfo.mid, 1, 50)
        ])
        const list = []
        if (createdRes?.code === 0 && createdRes.data?.list) {
          createdRes.data.list.forEach(item => {
            if (item.state === 0) {
              list.push({
                id: item.id,
                title: item.title,
                cover: item.cover,
                media_count: item.media_count,
                source: 'created'
              })
            }
          })
        }
        if (collectedRes?.code === 0 && collectedRes.data?.list) {
          collectedRes.data.list.forEach(item => {
            if (item.state === 0) {
              list.push({
                id: item.id,
                title: item.title,
                cover: item.cover,
                media_count: item.media_count,
                source: 'collected'
              })
            }
          })
        }
        if (playlistStore && typeof playlistStore.mergeBiliFavorites === 'function') {
          return playlistStore.mergeBiliFavorites(list)
        }
        return list.length
      } catch (error) {
        console.error('同步收藏夹失败:', error)
        return 0
      } finally {
        this.isSyncingFavorites = false
      }
    },
    async logout() {
      this.stopPolling()
      if (window.electronAPI) {
        try {
          await window.electronAPI.logoutBilibili()
        } catch (error) {
          console.error('退出登录失败:', error)
        }
      }
      // loginStorage.remove 内部已含 localStorage 清理
      try { await loginStorage.remove() } catch (_) {}
      this.userInfo = null
      this.isLoggedIn = false
      this.qrcodeUrl = ''
      this.qrcodeKey = ''
      this.qrcodeStatus = 'idle'
      this.qrcodeMessage = ''
    },
    /**
     * 把 B 站收藏夹的 media 项转换成本地 music 字段。
     * 已存在（bvid 或 favId+favType 命中）的会跳过；返回本次新增数。
     * - 过滤掉追更（type=21 视频合集）、电影（type=24）等非音乐/视频稿件项
     *   B 站媒体类型：2 视频稿件 / 12 音频 / 21 视频合集（追更） / 24 电影
     */
    _appendFavMedias(playlist, medias) {
      if (!playlist) return 0
      if (!playlist.music) playlist.music = []
      let added = 0
      let skipped = 0
      medias.forEach(item => {
        if (!item) return
        // attr=0 正常，attr=1/9 表示视频已失效
        if (item.attr && item.attr !== 0) return
        // 跳过追更（视频合集）和其他非音乐/视频稿件类型
        // 2=视频稿件 12=音频 21=视频合集（追更） 24=电影
        if (item.type === 21 || item.type === 24) {
          skipped++
          return
        }
        const bvid = item.bvid || item.bv_id
        const hasBvid = !!bvid
        if (!hasBvid && !item.id) return
        const exists = playlist.music.some(m => m && (
          (hasBvid && m.bvid === bvid) ||
          (!hasBvid && m.favId === item.id && m.favType === item.type)
        ))
        if (exists) return
        playlist.music.push({
          bvid: bvid || '',
          cid: item.cid,
          favId: item.id,
          favType: item.type,
          title: item.title,
          author: item.upper?.name || item.upper?.mid || '',
          cover: item.cover && (item.cover.startsWith('//') ? `https:${item.cover}` : item.cover),
          duration: item.duration,
          playCount: item.cnt_info?.play || 0,
          isBiliFavoriteResource: true
        })
        added++
      })
      if (skipped > 0) {
        console.log(`[pink-music] 跳过 ${skipped} 个非音乐项（追更/电影）`)
      }
      return added
    },

    /**
     * 拉取收藏夹全部内容（参考 biu-master 的 getAllFavMedia 策略：先 ids 一次性拿到全部 id，
     * 再用 infos 按 50 个一组批量查详情）。相比对 /x/v3/fav/resource/list 分页循环，
     * 这个方案只发 1 + N/50 次请求，更不容易被 B 站风控 -412 误伤。
     * - onProgress({ stage, current, total, loaded }) 用于 UI 实时显示
     *   stage: 'ids' | 'infos'
     * - 返回本次新增歌曲数
     */
    async loadAllFavoriteResources(playlist, playlistStore, { onProgress } = {}) {
      if (!playlist || !window.electronAPI) return 0
      const id = playlist.id
      if (!id || !id.startsWith('bili-fav-')) return 0
      const mediaId = Number(id.replace('bili-fav-', ''))
      if (!mediaId) return 0
      this._lastFavError = ''

      // 第一步：一次拿到所有 id
      const idsRes = await window.electronAPI.getFavResourceIds(mediaId)
      if (idsRes?.code !== 0) {
        this._lastFavError = idsRes?.message || `code=${idsRes?.code}`
        console.error('getFavResourceIds 失败:', this._lastFavError, 'mediaId=', mediaId)
        return 0
      }
      const allIds = Array.isArray(idsRes.data) ? idsRes.data : []
      if (allIds.length === 0) {
        return 0
      }
      // 只保留视频稿件 (2) 和音频 (12)，提前过滤掉追更/电影/合集（type=21/24 等）
      const validIds = allIds.filter(item => item && (item.type === 2 || item.type === 12))
      if (validIds.length === 0) {
        return 0
      }
      if (typeof onProgress === 'function') {
        try { onProgress({ stage: 'ids', current: 1, total: 1, loaded: validIds.length }) } catch (_) {}
      }

      // 第二步：按 50 一组批量查详情
      const CHUNK_SIZE = 50
      const chunks = []
      for (let i = 0; i < validIds.length; i += CHUNK_SIZE) {
        chunks.push(validIds.slice(i, i + CHUNK_SIZE))
      }
      const totalChunks = chunks.length
      let loaded = 0
      let added = 0
      for (let i = 0; i < totalChunks; i++) {
        const chunk = chunks[i]
        const resources = chunk.map(item => `${item.id}:${item.type}`).join(',')
        const infoRes = await window.electronAPI.getFavResourceInfos(resources)
        if (infoRes?.code !== 0) {
          // 单批失败：打日志但继续下一批，避免一颗老鼠屎坏了一锅汤
          console.warn(`第 ${i + 1}/${totalChunks} 批 infos 拉取失败:`, infoRes?.message)
          if (typeof onProgress === 'function') {
            try { onProgress({ stage: 'infos', current: i + 1, total: totalChunks, loaded }) } catch (_) {}
          }
          continue
        }
        const infos = Array.isArray(infoRes.data) ? infoRes.data : []
        loaded += infos.length
        added += this._appendFavMedias(playlist, infos)
        if (typeof onProgress === 'function') {
          try { onProgress({ stage: 'infos', current: i + 1, total: totalChunks, loaded }) } catch (_) {}
        }
      }

      if (added > 0 && playlistStore && typeof playlistStore.savePlaylists === 'function') {
        playlistStore.savePlaylists()
      }
      return added
    }
  }
})
