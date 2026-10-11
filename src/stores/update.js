import { defineStore } from 'pinia'

const REPO_RELEASES_URL = 'https://github.com/Rayson-Liu/pink-music-app/releases'

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 极简 Markdown 渲染（远端内容，先转义再处理，防注入）。
 * 仅支持发行说明常用的：标题 / 无序列表 / 粗体 / 行内代码。
 * 输入不合法时返回空串，不做任何 fallback。
 */
export function renderReleaseNotes(md) {
  if (!md || typeof md !== 'string') return ''
  const inline = (t) =>
    t
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+?)`/g, '<code>$1</code>')

  const lines = escapeHtml(md).split(/\r?\n/)
  let html = ''
  let inList = false
  const closeList = () => {
    if (inList) { html += '</ul>'; inList = false }
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) { closeList(); continue }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      closeList()
      const level = heading[1].length
      const tag = level <= 2 ? 'h4' : 'h5'
      html += `<${tag}>${inline(heading[2])}</${tag}>`
      continue
    }

    const bullet = /^[-*]\s+(.*)$/.exec(line)
    if (bullet) {
      if (!inList) { html += '<ul>'; inList = true }
      html += `<li>${inline(bullet[1])}</li>`
      continue
    }

    closeList()
    html += `<p>${inline(line)}</p>`
  }
  closeList()
  return html
}

export const useUpdateStore = defineStore('update', {
  state: () => ({
    currentVersion: '',
    latestVersion: '',
    latestName: '',
    notes: '',
    publishedAt: '',
    htmlUrl: '',
    hasUpdate: false,
    // idle | checking | latest | available | error
    status: 'idle',
    error: '',
    checkedAt: 0
  }),
  getters: {
    notesHtml: (state) => renderReleaseNotes(state.notes),
    statusText: (state) => {
      switch (state.status) {
        case 'checking': return '检查中…'
        case 'available': return `发现新版本 v${state.latestVersion}`
        case 'latest': return '已是最新版本'
        case 'error': return state.error || '检查更新失败，请稍后重试'
        default: return ''
      }
    }
  },
  actions: {
    /** 启动时拉一次本地版本（无需联网） */
    async loadVersion() {
      if (!window.electronAPI?.getAppVersion) return
      const v = await window.electronAPI.getAppVersion()
      if (v) this.currentVersion = v
    },

    /**
     * 检查更新。force=true 绕过主进程缓存（手动检查）。
     * 自动检查失败时静默（仅写 status），不打扰用户。
     */
    async check(force = false) {
      if (!window.electronAPI?.checkForUpdate) {
        // preload 未加载（例如改动后没重启 Electron），明确暴露原因而非静默失败
        console.warn('[update] window.electronAPI.checkForUpdate 不可用，请重启应用使 preload 生效')
        this.status = 'error'
        this.error = '更新检查不可用，请重启应用后重试'
        return { code: -1, error: 'no_bridge' }
      }
      if (this.status === 'checking') return null
      this.status = 'checking'
      this.error = ''
      try {
        const res = await window.electronAPI.checkForUpdate({ force })
        if (res?.currentVersion) this.currentVersion = res.currentVersion
        if (res?.code !== 0) {
          this.status = 'error'
          this.error = res?.error === 'rate_limited'
            ? '请求过于频繁，请稍后再试'
            : '检查更新失败，请稍后重试'
          return res
        }
        this.checkedAt = res.checkedAt || Date.now()
        if (res.latest) {
          this.latestVersion = res.latest.version
          this.latestName = res.latest.name
          this.notes = res.latest.notes
          this.publishedAt = res.latest.publishedAt
          this.htmlUrl = res.latest.htmlUrl
          this.hasUpdate = !!res.hasUpdate
          this.status = this.hasUpdate ? 'available' : 'latest'
        } else {
          this.hasUpdate = false
          this.status = 'latest'
        }
        return res
      } catch (_) {
        this.status = 'error'
        this.error = '检查更新失败，请稍后重试'
        return null
      }
    },

    /** 打开 release 页面（主进程会校验白名单） */
    async openReleases() {
      const url = this.htmlUrl || REPO_RELEASES_URL
      if (window.electronAPI?.openExternalUrl) await window.electronAPI.openExternalUrl(url)
    }
  }
})