<script setup>
import { ref, computed, nextTick } from 'vue'
import { useLocalStore, useSettingsStore, usePlaylistStore } from '@/stores'
import { syncPlaylistCover } from '@/stores/playlist'
import { parseDuration } from '@/utils/bilibili'

const emit = defineEmits(['play', 'play-all', 'add-to-playlist'])
const localStore = useLocalStore()
const settingsStore = useSettingsStore()
const playlistStore = usePlaylistStore()

const keyword = ref('')
const sortBy = ref('added') // added | title | author | duration
const isBatchMode = ref(false)
const selectedIds = ref(new Set())

/**
 * 加载失败的封面 URL 集合（按 URL 记录，不按曲目 id）。
 * 关键：这里必须走响应式状态，不能用 `@error="$event.target.style.visibility='hidden'"`
 * 那种命令式改 DOM 的写法 —— Vue 不知道这个内联样式，封面后来更新时无法复位，
 * 表现为「匹配完封面不刷新，切走再切回才显示」。
 * 按 URL 记录还能保证换了新封面地址后会自动重新尝试渲染。
 */
const failedCovers = ref(new Set())
function markCoverFailed(url) {
  if (!url) return
  const next = new Set(failedCovers.value)
  next.add(url)
  failedCovers.value = next
}

// 导入进度
const importProgress = ref({ active: false, stage: '', current: 0, total: 0 })

const filteredTracks = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  let list = localStore.tracks
  if (kw) {
    list = list.filter(t =>
      (t.title || '').toLowerCase().includes(kw) ||
      (t.author || '').toLowerCase().includes(kw) ||
      (t.album || '').toLowerCase().includes(kw)
    )
  }
  const arr = list.slice()
  switch (sortBy.value) {
    case 'title':
      arr.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'zh-Hans-CN'))
      break
    case 'author':
      arr.sort((a, b) => (a.author || '').localeCompare(b.author || '', 'zh-Hans-CN'))
      break
    case 'duration':
      arr.sort((a, b) => (b.duration || 0) - (a.duration || 0))
      break
    case 'added':
    default:
      arr.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))
      break
  }
  return arr
})

const selectedCount = computed(() => selectedIds.value.size)

function trackIdOf(t) { return t.id }

function isSelected(t) { return selectedIds.value.has(t.id) }

function toggleSelect(t) {
  const next = new Set(selectedIds.value)
  if (next.has(t.id)) next.delete(t.id)
  else next.add(t.id)
  selectedIds.value = next
}

function toggleSelectAll() {
  if (selectedIds.value.size === filteredTracks.value.length) {
    selectedIds.value = new Set()
  } else {
    selectedIds.value = new Set(filteredTracks.value.map(t => t.id))
  }
}

function enterBatchMode() {
  isBatchMode.value = true
  selectedIds.value = new Set()
}

function exitBatchMode() {
  isBatchMode.value = false
  selectedIds.value = new Set()
}

function onRowClick(t) {
  if (isBatchMode.value) {
    toggleSelect(t)
  } else {
    emit('play', t)
  }
}

// ───────── 导入 ─────────
function subscribeProgress() {
  if (!window.electronAPI?.local?.onParseProgress) return () => {}
  return window.electronAPI.local.onParseProgress((p) => {
    importProgress.value = {
      active: true,
      stage: 'parse',
      current: p.current || 0,
      total: p.total || 0
    }
  })
}

async function runImport(filePaths, { createPlaylistName = '' } = {}) {
  if (!filePaths || filePaths.length === 0) return
  const api = window.electronAPI?.local
  if (!api) {
    alert('本地导入功能仅在 Electron 环境中可用')
    return
  }

  localStore.isImporting = true
  importProgress.value = { active: true, stage: 'parse', current: 0, total: filePaths.length }
  const unsub = subscribeProgress()
  try {
    // 全部先解析标签，再按设置过滤「需转码」格式（是否可播要解析后才知道）
    const res = await api.parseMetadata(filePaths)
    if (res?.code === 0 && Array.isArray(res.data)) {
      let tracks = res.data
      if (!settingsStore.localIncludeUnplayable) {
        tracks = tracks.filter(t => !t.isUnplayable)
      }
      const { added, skipped } = await localStore.addTracks(tracks)
      if (createPlaylistName) {
        const pl = await importToNewPlaylist(createPlaylistName, tracks)
        if (pl) {
          // 导入完成后直接进入该歌单
          window.dispatchEvent(new CustomEvent('pink-music:open-playlist', { detail: { id: pl.id } }))
        }
      } else {
        alert(`导入完成：新增 ${added} 首${skipped ? `，已存在 ${skipped} 首` : ''}`)
      }
      // 导入后自动匹配缺失封面（后台执行，不阻塞）
      if (settingsStore.localAutoFetchCover) {
        localStore.batchMatchCovers().catch(() => {})
      }
    } else {
      alert(res?.message || '导入失败')
    }
  } catch (e) {
    alert('导入失败：' + (e?.message || e))
  } finally {
    if (typeof unsub === 'function') unsub()
    localStore.isImporting = false
    importProgress.value = { active: false, stage: '', current: 0, total: 0 }
  }
}

/** 把一组本地曲落成一个新歌单（封面自动跟随第一首） */
async function importToNewPlaylist(name, tracks) {
  const pl = playlistStore.createPlaylist(name || '本地音乐')
  pl.music = tracks.map(t => ({ ...t }))
  syncPlaylistCover(pl)
  await playlistStore.savePlaylists()
  return pl
}

async function importFiles() {
  const api = window.electronAPI?.local
  if (!api) return alert('本地导入功能仅在 Electron 环境中可用')
  const res = await api.importFiles()
  if (res?.code !== 0 || !res.data?.length) {
    if (res?.code !== 0) alert(res?.message || '选择文件失败')
    return
  }
  await runImport(res.data)
}

async function importFolder() {
  const api = window.electronAPI?.local
  if (!api) return alert('本地导入功能仅在 Electron 环境中可用')
  const res = await api.importFolder()
  if (res?.code !== 0) return alert(res?.message || '选择文件夹失败')
  const { files, folderName } = res.data || {}
  if (!files?.length) return alert('该文件夹内没有找到可导入的音频文件')
  const useAsPlaylist = window.confirm(`找到 ${files.length} 个音频文件。\n\n点击「确定」：创建以文件夹名「${folderName}」命名的新歌单\n点击「取消」：仅加入本地音乐库`)
  await runImport(files, { createPlaylistName: useAsPlaylist ? folderName : '' })
}

// ───────── 失效检测 ─────────
async function checkMissing() {
  const n = await localStore.checkMissing()
  alert(n > 0 ? `检测到 ${n} 首文件的本地文件已移动或删除（已标记，不会自动删除记录）` : '所有本地文件均正常')
}

// ───────── 单曲操作 ─────────
async function removeSelected() {
  if (selectedIds.value.size === 0) return
  const n = selectedIds.value.size
  if (!window.confirm(`确定从本地音乐库移除选中的 ${n} 首吗？\n（只移除库记录，不会删除磁盘上的文件）`)) return
  await localStore.removeTracks(Array.from(selectedIds.value))
  exitBatchMode()
}

async function removeOne(t) {
  if (!window.confirm(`从本地音乐库移除「${t.title}」？\n（不会删除磁盘上的文件）`)) return
  await localStore.removeTracks([t.id])
}

async function revealFile(t) {
  try { await window.electronAPI?.local?.revealFile(t.filePath) } catch (_) {}
}

async function relocate(t) {
  const api = window.electronAPI?.local
  if (!api) return
  const res = await api.relocateFile()
  const newPath = res?.data?.filePath
  if (!newPath) return
  const meta = await api.parseMetadata([newPath])
  const fresh = meta?.data?.[0]
  if (!fresh) return alert('解析文件失败')
  // 曲目 id 由文件路径派生：换成另一个文件就是另一条记录。
  // 此时若只 updateTrack，库内会多出一条指向旧路径的残留记录（重复入库），
  // 所以先把歌单引用改到新曲目，再移除旧记录、插入新记录。
  if (fresh.id && fresh.id !== t.id) {
    await playlistStore.remapLocalTrack(t.id, fresh)
    await localStore.removeTracks([t.id])
    await localStore.addTracks([fresh])
    return
  }
  // 同一文件（id 未变）：保留原 id，只更新路径与元数据
  await localStore.updateTrack(t.id, {
    filePath: fresh.filePath,
    fileName: fresh.fileName,
    title: fresh.title || t.title,
    author: fresh.author || t.author,
    duration: fresh.duration || t.duration,
    cover: fresh.cover || t.cover,
    lyricPath: fresh.lyricPath || '',
    isMissing: false,
    isUnplayable: fresh.isUnplayable
  })
}

function addToPlaylist(t) {
  emit('add-to-playlist', t)
}

/** 面板里「当前封面」预览：始终从 store 实时取，应用后立刻可见 */
const coverPreviewUrl = computed(() => {
  const id = coverTarget.value?.id
  if (!id) return ''
  return localStore.tracks.find(t => t.id === id)?.cover || ''
})

// ───────── 云端封面匹配（参考 HisAtri/LrcApi，交互对齐歌词搜索面板） ─────────
const showCoverPanel = ref(false)
const coverTarget = ref(null)
const coverKeyword = ref('')
const coverResults = ref([])
const isCoverSearching = ref(false)
const isCoverMatching = ref(false)
const coverError = ref('')
// 成功提示（应用封面后显示，面板保持打开，方便继续换）
const coverNotice = ref('')
const coverSelectedIndex = ref(0)
const applyingCoverId = ref(null)
const coverInputRef = ref(null)

function openCoverPanel(t) {
  if (!t) return
  coverTarget.value = t
  showCoverPanel.value = true
  coverError.value = ''
  coverNotice.value = ''
  coverResults.value = []
  coverSelectedIndex.value = 0
  // 与歌词搜索一致：默认回填当前曲名
  coverKeyword.value = t.title || ''
  // 关键：打开面板**不做任何自动应用**。
  // 之前这里会直接跑自动匹配并在成功后关掉面板，导致用户没机会搜索/手动纠错。
  // 自动匹配改为由用户显式点击「自动匹配」按钮触发，且成功后也不关闭面板。
  if (!t.title) {
    coverError.value = '该曲目没有歌名，请用关键词搜索后手动选择封面'
  }
  nextTick(() => {
    coverInputRef.value?.focus()
    coverInputRef.value?.select?.()
  })
}

function closeCoverPanel() {
  showCoverPanel.value = false
  coverTarget.value = null
  coverKeyword.value = ''
  coverResults.value = []
  coverError.value = ''
  coverNotice.value = ''
  coverSelectedIndex.value = 0
}

/** 自动匹配：走 LrcApi（按 歌名/歌手/专辑） */
async function autoMatchCover() {
  const t = coverTarget.value
  if (!t) return
  if (!t.title) {
    coverError.value = '该曲目没有歌名，请用关键词搜索后手动选择封面'
    return
  }
  isCoverMatching.value = true
  coverError.value = ''
  coverNotice.value = ''
  try {
    const url = await localStore.matchCoverFor(t)
    if (url) {
      // 不关闭面板：让用户看到结果，不满意可继续搜索更换
      coverNotice.value = '已应用自动匹配结果。下方搜索可手动更换'
    } else {
      coverError.value = t.author && t.author !== '未知作者'
        ? '未自动匹配到可靠的封面（歌手对不上），请用关键词搜索后手动选择'
        : '按歌名未搜到封面，请换个关键词手动搜索'
    }
  } finally {
    isCoverMatching.value = false
  }
}

/** 手动搜索候选（带缩略图） */
async function handleCoverSearch() {
  const kw = coverKeyword.value.trim()
  if (!kw) return
  isCoverSearching.value = true
  coverResults.value = []
  coverError.value = ''
  coverNotice.value = ''
  coverSelectedIndex.value = 0
  try {
    const res = await window.electronAPI?.local?.searchCover(kw)
    if (res?.code === 0 && Array.isArray(res.data)) {
      coverResults.value = res.data
      if (res.data.length === 0) coverError.value = '未找到相关封面'
    } else {
      coverError.value = res?.message || '搜索失败'
    }
  } catch (e) {
    coverError.value = e?.message || '搜索封面失败'
  } finally {
    isCoverSearching.value = false
  }
}

/** 应用选中的候选：下载 → 落盘 → 写入曲目与歌单 */
async function applyCover(candidate) {
  const t = coverTarget.value
  if (!candidate || !t) return
  const raw = candidate.coverRaw || candidate.cover
  if (!raw) return
  applyingCoverId.value = candidate.id
  coverError.value = ''
  coverNotice.value = ''
  try {
    const res = await window.electronAPI?.local?.applyCover({ url: raw, provider: candidate.provider })
    if (res?.code === 0 && res.data?.url) {
      await localStore.setTrackCover(t.id, res.data.url)
      // 不关闭面板：用户可继续挑选更合适的封面
      coverNotice.value = `已应用「${candidate.name || '所选封面'}」`
    } else {
      coverError.value = res?.message || '应用封面失败'
    }
  } catch (e) {
    coverError.value = e?.message || '应用封面失败'
  } finally {
    applyingCoverId.value = null
  }
}

function onCoverKeydown(e) {
  if (e.key === 'Escape') { e.preventDefault(); closeCoverPanel(); return }
  if (coverResults.value.length === 0) return
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    coverSelectedIndex.value = (coverSelectedIndex.value + 1) % coverResults.value.length
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    coverSelectedIndex.value = (coverSelectedIndex.value - 1 + coverResults.value.length) % coverResults.value.length
  } else if (e.key === 'Enter') {
    const item = coverResults.value[coverSelectedIndex.value]
    if (item) { e.preventDefault(); applyCover(item) }
  }
}

/** 批量匹配所有缺失封面 */
async function batchMatchCovers() {
  if (localStore.coverProgress.active) return
  const missing = localStore.tracks.filter(t => !t.cover).length
  if (missing === 0) return alert('所有本地音乐都已有封面')
  const matchable = localStore.tracks.filter(t => !t.cover && t.title).length
  if (matchable === 0) {
    return alert('缺少封面的曲目都没有歌名，无法自动匹配。请点击单曲的封面按钮手动搜索')
  }
  const extra = missing > matchable ? `\n（另有 ${missing - matchable} 首没有歌名，将跳过）` : ''
  if (!window.confirm(`将为 ${matchable} 首缺少封面的音乐匹配云端封面，过程可能需要一些时间。是否继续？${extra}`)) return
  const r = await localStore.batchMatchCovers()
  alert(r.canceled
    ? `已取消，成功匹配 ${r.ok} / ${r.total} 首`
    : `匹配完成：成功 ${r.ok} / ${r.total} 首`)
}
</script>

<template>
  <section class="local-view">
    <div class="local-header">
      <div>
        <span class="playlist-label">本地音乐</span>
        <h2 class="playlist-list-title">我的本地库</h2>
        <p class="playlist-list-subtitle">
          <template v-if="isBatchMode">已选 {{ selectedCount }} / {{ filteredTracks.length }} 首</template>
          <template v-else>
            共 {{ localStore.count }} 首
            <span v-if="localStore.missingCount > 0" class="local-warn">· {{ localStore.missingCount }} 首失效</span>
            <span v-if="localStore.unplayableCount > 0" class="local-warn">· {{ localStore.unplayableCount }} 首需转码</span>
          </template>
        </p>
      </div>

      <div class="playlist-list-actions">
        <template v-if="isBatchMode">
          <button class="playlist-action-btn" @click="toggleSelectAll">
            <span>{{ selectedIds.size === filteredTracks.length && filteredTracks.length > 0 ? '取消全选' : '全选' }}</span>
          </button>
          <button class="playlist-action-btn" @click="exitBatchMode"><span>取消</span></button>
          <button class="playlist-action-btn danger" :disabled="selectedCount === 0" @click="removeSelected">
            <span>从库中移除{{ selectedCount > 0 ? ` (${selectedCount})` : '' }}</span>
          </button>
        </template>
        <template v-else>
          <button class="playlist-action-btn primary" @click="importFiles">
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
            <span>导入文件</span>
          </button>
          <button class="playlist-action-btn" @click="importFolder">
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>
            <span>导入文件夹</span>
          </button>
          <button class="playlist-action-btn" @click="checkMissing" :disabled="localStore.isCheckingMissing" title="校验本地文件是否仍然存在">
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg>
            <span>{{ localStore.isCheckingMissing ? '检测中…' : '检测失效' }}</span>
          </button>
          <button
            v-if="localStore.coverProgress.active"
            class="playlist-action-btn danger"
            @click="localStore.cancelBatchCovers()"
            :title="'取消匹配'"
          >
            <span>取消匹配 ({{ localStore.coverProgress.current }}/{{ localStore.coverProgress.total }})</span>
          </button>
          <button
            v-else
            class="playlist-action-btn"
            @click="batchMatchCovers"
            title="为缺少封面的本地音乐匹配云端封面"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>
            <span>匹配封面</span>
          </button>
          <button v-if="filteredTracks.length > 0" class="playlist-action-btn" @click="emit('play-all', filteredTracks)" :title="keyword.trim() ? '播放当前筛选列表' : '播放整个本地库'">
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M8 5v14l11-7z"/></svg>
            <span>播放全部</span>
          </button>
          <button v-if="localStore.count > 1" class="playlist-action-btn" @click="enterBatchMode" title="批量管理">
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M3 5h2v2H3V5zm4 0h14v2H7V5zM3 11h2v2H3v-2zm4 0h14v2H7v-2zM3 17h2v2H3v-2zm4 0h14v2H7v-2z"/></svg>
            <span>批量管理</span>
          </button>
        </template>
      </div>
    </div>

    <!-- 导入进度 -->
    <div v-if="importProgress.active" class="local-progress">
      <div class="local-progress-bar">
        <div
          class="local-progress-fill"
          :style="{ width: (importProgress.total ? Math.round(importProgress.current / importProgress.total * 100) : 5) + '%' }"
        ></div>
      </div>
      <span>正在解析标签 {{ importProgress.current }} / {{ importProgress.total }}</span>
    </div>

    <!-- 云端封面批量匹配进度 -->
    <div v-if="localStore.coverProgress.active" class="local-progress">
      <div class="local-progress-bar">
        <div
          class="local-progress-fill"
          :style="{ width: (localStore.coverProgress.total ? Math.round(localStore.coverProgress.current / localStore.coverProgress.total * 100) : 5) + '%' }"
        ></div>
      </div>
      <span>正在匹配云端封面 {{ localStore.coverProgress.current }} / {{ localStore.coverProgress.total }}</span>
    </div>

    <!-- 过滤 / 排序 -->
    <div v-if="localStore.count > 0" class="local-toolbar">
      <input v-model="keyword" class="local-filter" type="text" placeholder="搜索标题 / 歌手 / 专辑" />
      <select v-model="sortBy" class="local-sort">
        <option value="added">按添加时间</option>
        <option value="title">按标题</option>
        <option value="author">按歌手</option>
        <option value="duration">按时长</option>
      </select>
    </div>

    <!-- 空状态 -->
    <div v-if="localStore.count === 0" class="playlist-empty">
      <div class="empty-icon">
        <svg viewBox="0 0 24 24" fill="currentColor" width="48" height="48"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
      </div>
      <p>还没有本地音乐，导入你自己的音频文件吧</p>
      <div class="empty-actions">
        <button class="load-fav-btn" @click="importFiles">导入文件</button>
        <button class="playlist-action-btn" @click="importFolder">导入文件夹</button>
      </div>
    </div>

    <div v-else-if="filteredTracks.length === 0" class="playlist-empty">
      <p>没有匹配「{{ keyword }}」的本地音乐</p>
    </div>

    <!-- 列表 -->
    <div v-else class="track-list">
      <div class="track-list-header" :class="{ 'is-batch-mode': isBatchMode }">
        <span class="col-index">#</span>
        <span class="col-title">标题</span>
        <span class="col-actions"></span>
        <span class="col-duration">时长</span>
      </div>
      <div
        v-for="(t, index) in filteredTracks"
        :key="t.id"
        class="track-row"
        :class="{
          'is-track-batch': isBatchMode,
          'is-track-selected': isBatchMode && isSelected(t),
          'is-local-missing': t.isMissing
        }"
        :style="{ '--track-index': index }"
        @click="onRowClick(t)"
      >
        <div class="col-index">
          <span class="track-index">{{ index + 1 }}</span>
          <svg class="track-play-icon" viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M8 5v14l11-7z"/></svg>
        </div>
        <div class="col-title">
          <img
            v-if="t.cover && !failedCovers.has(t.cover)"
            :src="t.cover"
            :alt="t.title"
            class="track-cover"
            loading="lazy"
            decoding="async"
            @error="markCoverFailed(t.cover)"
          />
          <!-- 无封面 / 加载失败：占位块（同尺寸同背景，避免布局跳动） -->
          <div v-else class="track-cover" aria-hidden="true"></div>
          <div class="track-text">
            <h4>
              {{ t.title || '未知标题' }}
              <span v-if="t.isMissing" class="local-badge danger">已失效</span>
              <span v-else-if="t.isUnplayable" class="local-badge warn">需转码</span>
              <span v-else-if="t.lyricPath" class="local-badge ok">LRC</span>
            </h4>
            <p>{{ t.author || '未知作者' }}<template v-if="t.album"> · {{ t.album }}</template></p>
          </div>
        </div>
        <div class="col-actions">
          <template v-if="!isBatchMode">
            <button v-if="t.isMissing" class="track-action-btn" @click.stop="relocate(t)" title="重新定位文件">
              <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
            </button>
            <button v-else class="track-action-btn" @click.stop="revealFile(t)" title="在文件夹中显示">
              <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>
            </button>
            <button class="track-action-btn" @click.stop="openCoverPanel(t)" :title="t.cover ? '重新匹配封面' : '匹配云端封面'">
              <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>
            </button>
            <button class="track-action-btn" @click.stop="addToPlaylist(t)" title="添加到歌单">
              <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
            </button>
            <button class="track-action-btn track-action-btn--delete" @click.stop="removeOne(t)" title="从本地库移除">
              <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
            </button>
          </template>
          <span
            v-else
            class="track-row-checkbox"
            :class="{ checked: isSelected(t) }"
            @click.stop="toggleSelect(t)"
          >
            <svg v-if="isSelected(t)" viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>
          </span>
        </div>
        <div class="col-duration">{{ parseDuration(t.duration) }}</div>
      </div>
    </div>

    <!-- 云端封面匹配面板（交互对齐歌词搜索面板） -->
    <div v-if="showCoverPanel" class="modal-overlay" @click.self="closeCoverPanel">
      <div class="modal cover-panel" @click.stop>
        <h2>匹配云端封面</h2>
        <p class="cover-panel-subtitle">
          当前曲目：{{ coverTarget?.title || '未知标题' }}<template v-if="coverTarget?.author && coverTarget.author !== '未知作者'"> · {{ coverTarget.author }}</template>
        </p>

        <!-- 当前封面预览：应用新封面后立即在这里反映 -->
        <div class="cover-current">
          <img v-if="coverPreviewUrl" :src="coverPreviewUrl" class="cover-current-img" alt="" />
          <div v-else class="cover-current-img cover-thumb--empty"></div>
          <div class="cover-current-text">
            <span class="cover-current-label">{{ coverPreviewUrl ? '当前封面' : '暂无封面' }}</span>
            <span class="cover-current-hint">选择下方任一结果即可替换</span>
          </div>
        </div>

        <div class="cover-panel-row">
          <input
            ref="coverInputRef"
            v-model="coverKeyword"
            type="text"
            class="cover-search-input"
            placeholder="输入歌名 / 歌手 搜索封面"
            @keydown="onCoverKeydown"
          />
          <button class="btn-secondary" :disabled="isCoverSearching" @click="handleCoverSearch">
            {{ isCoverSearching ? '搜索中…' : '搜索' }}
          </button>
          <button class="btn-primary" :disabled="isCoverMatching" @click="autoMatchCover">
            {{ isCoverMatching ? '匹配中…' : '自动匹配' }}
          </button>
        </div>

        <p v-if="coverNotice" class="cover-notice">{{ coverNotice }}</p>

        <div v-if="isCoverMatching" class="cover-panel-loading">
          <div class="loading-spinner"></div>
          <p>正在按歌名/歌手自动匹配…</p>
        </div>

        <div v-else class="cover-result-list">
          <div
            v-for="(song, i) in coverResults"
            :key="song.id"
            class="cover-result-item"
            :class="{ active: coverSelectedIndex === i }"
            @click="applyCover(song)"
            @mouseenter="coverSelectedIndex = i"
          >
            <img v-if="song.cover" :src="song.cover" class="cover-thumb" alt="" loading="lazy" decoding="async" />
            <div v-else class="cover-thumb cover-thumb--empty"></div>
            <div class="cover-result-text">
              <span class="cover-result-name">{{ song.name }}</span>
              <span class="cover-result-meta">{{ song.artist }}<template v-if="song.album"> · {{ song.album }}</template></span>
            </div>
            <span class="cover-result-apply">{{ applyingCoverId === song.id ? '应用中…' : '使用' }}</span>
          </div>
          <div v-if="!isCoverSearching && !coverError && coverResults.length === 0" class="cover-panel-empty">
            <p>输入关键词点「搜索」选封面；有歌手信息时也可直接点「自动匹配」</p>
          </div>
          <div v-if="coverError" class="cover-panel-empty">
            <p class="cover-error">{{ coverError }}</p>
          </div>
        </div>

        <div class="modal-buttons">
          <button class="modal-btn confirm" @click="closeCoverPanel">完成</button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.local-view {
  width: 100%;
}
.local-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--spacing-md, 16px);
  flex-wrap: wrap;
  margin-bottom: 18px;
}
.local-warn {
  color: var(--warning-color);
}
.local-progress {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
  font-size: 13px;
  color: var(--text-secondary);
}
.local-progress-bar {
  flex: 1;
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--bg-tertiary);
  overflow: hidden;
}
.local-progress-fill {
  height: 100%;
  background: var(--primary-gradient);
  transition: width var(--transition-fast);
}
.local-toolbar {
  display: flex;
  gap: 10px;
  margin-bottom: 14px;
}
.local-filter {
  flex: 1;
  min-width: 0;
  padding: 9px 14px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-color);
  background: var(--bg-surface);
  color: var(--text-primary);
  font-size: 13px;
  outline: none;
}
.local-filter:focus {
  border-color: var(--border-glow);
}
.local-sort {
  padding: 9px 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-color);
  background: var(--bg-surface);
  color: var(--text-secondary);
  font-size: 13px;
  outline: none;
  cursor: pointer;
}
.local-badge {
  display: inline-block;
  margin-left: 8px;
  padding: 1px 6px;
  border-radius: var(--radius-xs);
  font-size: 10px;
  font-weight: 600;
  vertical-align: 1px;
}
.local-badge.danger { background: rgba(239, 68, 68, 0.16); color: var(--error-color); }
.local-badge.warn { background: rgba(245, 158, 11, 0.16); color: var(--warning-color); }
.local-badge.ok { background: rgba(34, 197, 94, 0.16); color: var(--success-color); }
.track-row.is-local-missing {
  opacity: 0.55;
}
.empty-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
  margin-top: 12px;
}

/* ───── 云端封面匹配面板 ───── */
.cover-panel {
  max-width: 520px;
  width: min(92vw, 520px);
}
.cover-panel-subtitle {
  margin: -6px 0 14px;
  font-size: 13px;
  color: var(--text-muted);
  word-break: break-all;
}
.cover-panel-row {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
}

/* 当前封面预览 */
.cover-current {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px;
  margin-bottom: 14px;
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
}
.cover-current-img {
  width: 56px;
  height: 56px;
  border-radius: var(--radius-sm);
  object-fit: cover;
  flex-shrink: 0;
  background: var(--bg-tertiary);
}
.cover-current-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.cover-current-label {
  font-size: 13px;
  color: var(--text-primary);
}
.cover-current-hint {
  font-size: 12px;
  color: var(--text-muted);
}

/* 成功提示 */
.cover-notice {
  margin: -6px 0 12px;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  background: rgba(34, 197, 94, 0.12);
  color: var(--success-color);
  font-size: 12px;
}
.cover-search-input {
  flex: 1;
  min-width: 0;
  padding: 9px 14px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-color);
  background: var(--bg-surface);
  color: var(--text-primary);
  font-size: 13px;
  outline: none;
}
.cover-search-input:focus {
  border-color: var(--border-glow);
}
.cover-panel-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 26px 0;
  color: var(--text-secondary);
  font-size: 13px;
}
.cover-result-list {
  max-height: 46vh;
  overflow-y: auto;
  margin-bottom: 6px;
}
.cover-result-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition-fast);
}
.cover-result-item:hover,
.cover-result-item.active {
  background: var(--bg-card-hover);
}
.cover-thumb {
  width: 44px;
  height: 44px;
  border-radius: var(--radius-xs);
  object-fit: cover;
  flex-shrink: 0;
  background: var(--bg-tertiary);
}
.cover-thumb--empty {
  display: block;
}
.cover-result-text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1;
}
.cover-result-name {
  font-size: 13px;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cover-result-meta {
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cover-result-apply {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--primary-color);
}
.cover-panel-empty {
  padding: 20px 4px;
  text-align: center;
  font-size: 13px;
  color: var(--text-muted);
}
.cover-error {
  color: var(--error-color);
}
</style>