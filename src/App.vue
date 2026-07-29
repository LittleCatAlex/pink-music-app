<script setup>
import { ref, onMounted, onUnmounted, computed, watch, nextTick } from 'vue'
import { parseDuration, formatPlayCount, fixCoverUrl } from './utils/bilibili.js'
import { selectAudioUrl, selectAudioInfo } from './utils/audio.js'
import { attachAudioAnalyser } from './utils/audioAnalyser'
import WindowControls from './components/WindowControls.vue'
import AppDock from './components/AppDock.vue'
import MineView from './components/MineView.vue'
import LyricDisplay from './components/player/LyricDisplay.vue'
import AudioVisualizer from './components/AudioVisualizer.vue'
import AlbumRipple from './components/AlbumRipple.vue'
import { useLyricStore, usePlayerStore, useSettingsStore, useDownloadStore, useUserStore, usePlaylistStore, useThemeStore } from './stores'
import DownloadManager from './components/DownloadManager.vue'
import LoginPanel from './components/LoginPanel.vue'
import { applyLiquidGlass, destroyLiquidGlass } from './composables/useLiquidGlass'
import { appConfirm } from './utils/confirm'

// flush 协议相关：保存 IPC 监听器反注册函数，HMR 时清理旧监听器，避免重复注册
let unregisterFlushListener = null
// HMR 兜底：模块级标记，让 vite HMR 重新执行前先清理旧监听器
const HMR_FLUSH_KEY = '__pink_music_flush_listener_installed__'
if (typeof window !== 'undefined' && window[HMR_FLUSH_KEY]) {
  try { window[HMR_FLUSH_KEY]() } catch (_) {}
  window[HMR_FLUSH_KEY] = null
}

const topbarRef = ref(null)
const playerBarRef = ref(null)
const liquidGlassInstances = new Map()

const lyricStore = useLyricStore()
const playerStore = usePlayerStore()
const settingsStore = useSettingsStore()
const downloadStore = useDownloadStore()
const userStore = useUserStore()
const playlistStore = usePlaylistStore()
const themeStore = useThemeStore()

// Helper function to strip HTML tags
function stripHtmlTags(html) {
  return html.replace(/<[^>]*>/g, '');
}


// Media Session API for system media controls
function updateMediaSession() {
  if (!('mediaSession' in navigator)) return;
  
  const music = currentTrack.value;
  if (!music) return;
  
  navigator.mediaSession.metadata = new MediaMetadata({
    title: music.title || '未知标题',
    artist: music.author || '未知作者',
    album: 'Pink Music',
    artwork: [
      {
        src: fixCoverUrl(music.cover) || '',
        sizes: '256x256',
        type: 'image/jpeg'
      }
    ]
  });
  
  // Update playback state
  navigator.mediaSession.playbackState = isPlaying.value ? 'playing' : 'paused';
}

function setupMediaSessionHandlers() {
  if (!('mediaSession' in navigator)) return;
  
  navigator.mediaSession.setActionHandler('play', () => {
    togglePlayPause()
  });
  
  navigator.mediaSession.setActionHandler('pause', () => {
    togglePlayPause()
  });
  
  navigator.mediaSession.setActionHandler('previoustrack', () => {
    playPrevious()
  });
  
  navigator.mediaSession.setActionHandler('nexttrack', () => {
    playNext()
  });
}

// 主题由 themeStore 统一管理（MineView 设置 tab 提供切换入口），
// 启动时通过 themeStore.initTheme() 同步到 <html> 标签，详见 onMounted。

// 顶栏一键切换深色/浅色模式
function toggleThemeMode() {
  const next = themeStore.currentTheme === 'dark' ? 'light' : 'dark'
  themeStore.setTheme(next)
}
const currentView = computed({
  get: () => playlistStore.currentView,
  set: (val) => playlistStore.setCurrentView(val)
})
const searchQuery = ref('')
const isSearching = ref(false)
const searchResults = ref([])
const isLoadingSearch = ref(false)
const recommendedMusic = ref([])
const isLoadingRecommended = ref(false)
const currentPlaylist = computed({
  get: () => playlistStore.currentPlaylist,
  set: (val) => playlistStore.setCurrentPlaylist(val)
})
const isLoadingFavResources = ref(false)
// 收藏夹分页拉取进度：{ current, total, loaded }
const favSyncProgress = ref({ current: 0, total: 0, loaded: 0 })
const currentTrack = ref(null)
// 大屏播放页封面模糊背景 URL（所有主题通用）：当前歌曲封面，走 fixCoverUrl + fallback
// 在音频可视化关闭时作为全屏毛玻璃背景展示
const coverBgUrl = computed(() => {
  const raw = fixCoverUrl(currentTrack.value?.cover)
  return raw || 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=1200'
})
const isPlaying = ref(false)
const showPlayerPage = ref(false)
const audioElement = ref(null)
const currentTime = ref(0)
const duration = ref(0)
const isSeeking = ref(false)
function onSeekStart() { isSeeking.value = true }
function onSeekEnd() { isSeeking.value = false }
const isAudioLoading = ref(false)
const audioError = ref('')
const bufferedProgress = ref(0)
const showCreatePlaylistModal = ref(false)
const newPlaylistName = ref('')
const currentSeries = ref(null)
const showSeriesPanel = ref(false)
const downloadProgress = ref(0)
const isDownloading = ref(false)
let downloadMonitorInterval = null
const showPlaylistManager = ref(false)
const showAddToPlaylistModal = ref(false)

// 批量删除歌单：多选模式 + 已选 id 集合
const isBatchMode = ref(false)
const selectedPlaylistIds = ref(new Set())
const currentVideoEpisodes = ref([])
const isLoadingEpisodes = ref(false)
const currentEpisodeIndex = ref(0)
const albumArtRef = ref(null)
const showLyricPanel = ref(true)

// 批量管理歌单内歌曲：多选模式 + 已选 key 集合（key 同模板 :key）
const isTrackBatchMode = ref(false)
const selectedTrackKeys = ref(new Set())

// 设置功能状态 - 已迁移到 MineView，不再需要
const showLoginPanel = ref(false)

// 点击播放栏封面打开大屏播放
function openPlayerPageFromCover() {
  showPlayerPage.value = true
  playerStore.setShowPlayerPage(true)
}

function closePlayerPage() {
  showPlayerPage.value = false
  playerStore.setShowPlayerPage(false)
}

const playMode = ref('order')
// 播放模式图标：用内联 SVG 替代 emoji。
// 顺序播放：双向水平箭头（左右反向）
// 列表循环：环形箭头（refresh）
// 随机播放：交叉箭头（shuffle）
// 单曲循环：左侧小圆点 + 右侧三条横线（repeat one 风格）
const playModes = [
  {
    value: 'order',
    label: '顺序播放',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><polyline points="17 1 21 5 17 9"/><path d="M3 5h18"/><polyline points="7 23 3 19 7 15"/><path d="M21 19H3"/></svg>'
  },
  {
    value: 'loop',
    label: '列表循环',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>'
  },
  {
    value: 'shuffle',
    label: '随机播放',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>'
  },
  {
    value: 'single',
    label: '单曲循环',
    // 循环箭头中央放一个 "1"，表示"循环 1 次（单曲）"
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/><text x="12" y="15.5" text-anchor="middle" dominant-baseline="middle" fill="currentColor" stroke="none" font-size="8" font-weight="700" font-family="Arial, sans-serif">1</text></svg>'
  }
]

// 主题切换：旧 App.vue 里的 colorOptions / toggleTheme / setTheme / setColor
// 全部迁移到 MineView 设置 tab。这里只保留一个"跳到设置"的入口函数
// 用于顶栏按钮 / 全局快捷入口。
function openSettings() {
  // 1) 切到"我的"视图（MineView 在 currentView === 'mine' 时挂载）
  playlistStore.setCurrentView('mine')
  // 2) 派发全局事件，MineView 监听后把 activeTab 切到 'settings'
  window.dispatchEvent(new CustomEvent('pink-music:open-settings'))
}

function goToHome() {
  playlistStore.setCurrentView('home')
  loadRecommendedMusic()
}

function goToSearch() {
  playlistStore.setCurrentView('search')
}

async function loadFavResources() {
  if (!currentPlaylist.value || !userStore.isLoggedIn) return
  isLoadingFavResources.value = true
  favSyncProgress.value = { stage: '', current: 0, total: 0, loaded: 0 }
  try {
    // 参考 biu-master 的 getAllFavMedia：先 ids 一次拿全，再 infos 批量查
    // 总进度按 media_count 估算，1 个 ids + ceil(N/50) 个 infos
    const totalHint = Number(currentPlaylist.value.media_count) || 0
    const totalChunks = totalHint > 0 ? 1 + Math.ceil(totalHint / 50) : 1
    favSyncProgress.value = {
      stage: 'ids',
      current: 0,
      total: totalChunks,
      loaded: 0
    }
    const added = await userStore.loadAllFavoriteResources(
      currentPlaylist.value,
      playlistStore,
      {
        onProgress: ({ stage, current, total, loaded }) => {
          favSyncProgress.value = { stage, current, total, loaded }
        }
      }
    )
    // 兜底 save：loadAllFavoriteResources 内部应该已经 save，但这里再 save 一次
    // 防止它内部异常退出时已加载的 partial 数据没落盘
    try { await playlistStore.savePlaylists() } catch (_) {}
    if (added === 0) {
      const detail = userStore._lastFavError || '请稍后重试'
      alert(`未拉取到新视频（${detail}）。可尝试重新登录 B 站后再试。`)
    } else {
      // 同步刷新 currentPlaylist 引用，让视图立即看到新歌曲
      currentPlaylist.value = playlistStore.userPlaylists.find(p => p.id === currentPlaylist.value.id) || currentPlaylist.value
    }
  } catch (error) {
    console.error('加载收藏夹内容失败:', error)
    // 关键：异常退出时 partial 数据可能已在内存里；显式 save 一次兜底
    try { await playlistStore.savePlaylists() } catch (_) {}
    alert('加载失败：' + (error?.message || '未知错误'))
  } finally {
    isLoadingFavResources.value = false
    favSyncProgress.value = { stage: '', current: 0, total: 0, loaded: 0 }
  }
}

function goToPlaylist(playlist) {
  playlistStore.setCurrentPlaylist(playlist)
  playlistStore.setCurrentView('playlist')
}

function backToPlaylistList() {
  playlistStore.setCurrentPlaylist(null)
}

/**
 * 一键播放整个歌单：从第一首开始。
 * 1) 切到歌单视图，让 handleTrackEnd 能正确取到 currentPlaylist.music 作为下一首来源
 * 2) 调用 playMusic(第一首)
 * 3) 歌单为空（B 站收藏夹还没加载到本地）则提示用户去加载
 */
async function playPlaylistAll(playlist) {
  if (!playlist) return
  const list = playlist.music || []
  if (list.length === 0) {
    if (playlist.isBiliFavorite) {
      alert('该收藏夹尚未加载到本地歌单，请先点击"加载视频"')
    } else {
      alert('该歌单还没有音乐')
    }
    return
  }
  // 先把视图/歌单指到要播放的这个，避免 handleTrackEnd 取错 musicList
  if (currentPlaylist.value?.id !== playlist.id) {
    playlistStore.setCurrentPlaylist(playlist)
  }
  if (currentView.value !== 'playlist') {
    playlistStore.setCurrentView('playlist')
  }
  await playMusic(list[0])
}

async function confirmDeletePlaylist(playlist) {
  if (!playlist) return
  if (playlist.isDefault) return
  const songCount = playlist.music?.length || playlist.media_count || 0
  // B 站同步的收藏夹删的是本地副本，B 站云端不受影响——文案上明确告知
  const detail = playlist.isBiliFavorite
    ? `该歌单包含 ${songCount} 首音乐，此操作不可恢复。\n（仅删除本地副本，不会影响 B 站云端）`
    : `该歌单包含 ${songCount} 首音乐，此操作不可恢复。`
  const ok = await appConfirm({
    title: '删除歌单',
    message: `确定要删除歌单「${playlist.name}」吗？`,
    detail,
    confirmText: '删除',
    cancelText: '取消'
  })
  if (!ok) return
  deletePlaylist(playlist)
}

// ============= 批量删除歌单 =============
function enterBatchMode() {
  isBatchMode.value = true
}

function exitBatchMode() {
  isBatchMode.value = false
  selectedPlaylistIds.value = new Set()
}

function togglePlaylistSelection(playlist) {
  if (!playlist || playlist.isDefault) return // 默认收藏夹不可选
  const next = new Set(selectedPlaylistIds.value)
  if (next.has(playlist.id)) {
    next.delete(playlist.id)
  } else {
    next.add(playlist.id)
  }
  selectedPlaylistIds.value = next
}

// 取得所有"可被批量选中的"歌单 id（默认收藏夹不算）
function getDeletablePlaylistIds() {
  return playlistStore.userPlaylists
    .filter(p => !p.isDefault)
    .map(p => p.id)
}

// 是否已经处于"全部可删除歌单都选中"的状态——用于决定全选按钮的图标 / 文案
const isAllDeletablePlaylistsSelected = computed(() => {
  const ids = getDeletablePlaylistIds()
  if (ids.length === 0) return false
  return ids.every(id => selectedPlaylistIds.value.has(id))
})

// "全选"按钮的真正逻辑：已全选 → 取消全选；否则全选可删除的歌单
// 这样用户不用退出批量模式就能反向操作
function toggleSelectAllPlaylists() {
  if (isAllDeletablePlaylistsSelected.value) {
    selectedPlaylistIds.value = new Set()
  } else {
    selectedPlaylistIds.value = new Set(getDeletablePlaylistIds())
  }
}

function isPlaylistSelected(playlist) {
  return !!playlist && selectedPlaylistIds.value.has(playlist.id)
}

// 当 store 里的歌单列表变化（单删、外部同步等）时，把已选集合中已不存在的 id 清掉，
// 防止"已选 N 个"和实际可操作数对不上
watch(
  () => playlistStore.userPlaylists.map(p => p.id),
  (currentIds) => {
    if (selectedPlaylistIds.value.size === 0) return
    const idSet = new Set(currentIds)
    const filtered = Array.from(selectedPlaylistIds.value).filter(id => idSet.has(id))
    if (filtered.length !== selectedPlaylistIds.value.size) {
      selectedPlaylistIds.value = new Set(filtered)
    }
  }
)

async function confirmBatchDeletePlaylists() {
  console.log('[BatchDelete] called, selected size =', selectedPlaylistIds.value.size)
  if (selectedPlaylistIds.value.size === 0) {
    console.log('[BatchDelete] selection empty, abort')
    return
  }
  const ids = Array.from(selectedPlaylistIds.value)
  console.log('[BatchDelete] selected ids =', ids)
  // 预先统计：哪些会被真删，哪些会被跳过
  const targets = playlistStore.userPlaylists.filter(p => ids.includes(p.id))
  console.log('[BatchDelete] matched playlists =', targets.map(t => ({ id: t.id, name: t.name, isDefault: t.isDefault })))
  const deletable = targets.filter(p => !p.isDefault)
  const skipped = targets.filter(p => p.isDefault)
  console.log('[BatchDelete] deletable =', deletable.length, 'skipped =', skipped.length)
  if (deletable.length === 0) {
    await appConfirm({
      title: '无法删除',
      message: '所选歌单均为默认收藏夹，不可删除。',
      detail: '默认收藏夹为系统内置歌单，需要保留以便日常使用。',
      confirmText: '我知道了',
      cancelText: '关闭'
    })
    return
  }
  const totalSongs = deletable.reduce(
    (sum, p) => sum + (p.music?.length || p.media_count || 0),
    0
  )
  const hasBili = deletable.some(p => p.isBiliFavorite)
  const detail =
    (hasBili
      ? `共 ${deletable.length} 个歌单、约 ${totalSongs} 首音乐将被删除。\n（其中 B 站收藏夹仅删除本地副本，不影响 B 站云端）`
      : `共 ${deletable.length} 个歌单、约 ${totalSongs} 首音乐将被删除，此操作不可恢复。`) +
    (skipped.length > 0 ? `\n另有 ${skipped.length} 个默认收藏夹将被自动跳过。` : '')
  const ok = await appConfirm({
    title: '批量删除歌单',
    message: `确定要删除已选中的 ${deletable.length} 个歌单吗？`,
    detail,
    confirmText: '批量删除',
    cancelText: '取消'
  })
  console.log('[BatchDelete] user confirmed =', ok)
  if (!ok) return
  try {
    // 直接在 App.vue 里操作 store state，避开 Pinia action HMR 不热更的问题
    // 逻辑与 store.batchDeletePlaylists 一致：默认歌单跳过，其余删除
    const idSet = new Set(ids)
    const deletedIds = []
    let skipped = 0
    playlistStore.userPlaylists = playlistStore.userPlaylists.filter(p => {
      if (!idSet.has(p.id)) return true
      if (p.isDefault) { skipped++; return true }
      deletedIds.push(p.id)
      return false
    })
    if (deletedIds.length > 0) playlistStore.savePlaylists()
    const result = { deleted: deletedIds.length, skipped, deletedIds }
    console.log('[BatchDelete] result =', result, 'userPlaylists now =', playlistStore.userPlaylists.map(p => p.id))
    // 如果当前正在查看的歌单被删了，跳回列表
    if (
      currentPlaylist.value &&
      result.deletedIds.includes(currentPlaylist.value.id)
    ) {
      playlistStore.setCurrentPlaylist(null)
    }
    // 退出批量模式
    exitBatchMode()
    if (result.deleted === 0 && result.skipped > 0) {
      alert('所选歌单均为默认收藏夹，已跳过。')
    } else if (result.deleted > 0) {
      console.log(`[BatchDelete] ✅ 成功删除 ${result.deleted} 个歌单`)
    }
  } catch (err) {
    console.error('[BatchDelete] ❌ 删除出错:', err)
    alert('批量删除失败：' + (err?.message || err))
  }
}

function loadFavResourcesFor(playlist) {
  playlistStore.setCurrentPlaylist(playlist)
  playlistStore.setCurrentView('playlist')
  loadFavResources()
}

// ============= 歌单内歌曲：单首删除 / 批量删除 =============

/**
 * 与模板里的 :key 保持一致：bvid:favId:favType。
 * **永远在末尾追加 index** 作为唯一性兜底——这是修复 BUG 的关键：
 * 当多条音乐恰好有相同的 bvid + favId + favType（例如同 bvid 重复条目、
 * 收藏夹内多 P 但 id 缺失等情况），如果只用前三个字段拼 key，所有歌会
 * 生成同一个 key，导致：
 *   1. 点击一首时，集合里只有 1 个 key，但所有歌的 key 都命中 → 视觉"全选"
 *   2. 点"全选"时，set 已有该 key，set 大小仍为 1 → 计数器显示 1/n
 * 把 index 拼到 key 末尾能确保每个位置都有独立 key，彻底规避这种碰撞。
 */
function getTrackKey(music, index) {
  if (!music) return ''
  return (music.bvid || '') + ':' + (music.favId ?? index) + ':' + (music.favType ?? '') + ':' + index
}

function enterTrackBatchMode() {
  isTrackBatchMode.value = true
}

function exitTrackBatchMode() {
  isTrackBatchMode.value = false
  selectedTrackKeys.value = new Set()
}

function toggleTrackSelection(music, index) {
  if (!music) return
  const key = getTrackKey(music, index)
  if (!key) return
  const next = new Set(selectedTrackKeys.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  selectedTrackKeys.value = next
}

function isTrackSelected(music, index) {
  if (!music) return false
  return selectedTrackKeys.value.has(getTrackKey(music, index))
}

function selectAllTracks() {
  const list = currentPlaylist.value?.music || []
  const next = new Set()
  list.forEach((m, i) => {
    const k = getTrackKey(m, i)
    if (k) next.add(k)
  })
  selectedTrackKeys.value = next
}

function isAllTracksSelected() {
  const list = currentPlaylist.value?.music || []
  if (list.length === 0) return false
  return list.every((m, i) => selectedTrackKeys.value.has(getTrackKey(m, i)))
}

/**
 * 单首删除：从当前歌单里删除一首歌。
 * - B 站收藏夹：只删本地副本，云端不受影响
 * - 默认收藏夹（"收藏夹"）：允许删除单首
 */
async function confirmDeleteTrack(music) {
  if (!music || !currentPlaylist.value) return
  const pl = currentPlaylist.value
  const ok = await appConfirm({
    title: '删除歌曲',
    message: `确定要从歌单「${pl.name}」中删除「${music.title || '该歌曲'}」吗？`,
    detail: pl.isBiliFavorite
      ? '仅删除本地副本，不会影响 B 站云端。'
      : '此操作不可恢复。',
    confirmText: '删除',
    cancelText: '取消'
  })
  if (!ok) return
  const list = pl.music || []
  const idx = list.findIndex(m =>
    (m.bvid || '') === (music.bvid || '') &&
    (m.favId ?? null) === (music.favId ?? null) &&
    (m.favType ?? null) === (music.favType ?? null)
  )
  if (idx < 0) return
  list.splice(idx, 1)
  const pIdx = playlistStore.userPlaylists.findIndex(p => p.id === pl.id)
  if (pIdx >= 0) {
    playlistStore.userPlaylists[pIdx] = {
      ...playlistStore.userPlaylists[pIdx],
      music: [...list]
    }
    playlistStore.savePlaylists()
    // 刷新 currentPlaylist 引用，触发视图更新
    playlistStore.setCurrentPlaylist(playlistStore.userPlaylists[pIdx])
  }
}

/**
 * 批量删除歌曲：
 * - 逻辑直接在 UI 组件里执行，避开 Pinia store action HMR 不热更的坑
 * - 删除前弹窗确认，B 站收藏夹附文案说明
 * - 删除后自动退出批量模式
 */
async function confirmBatchDeleteTracks() {
  console.log('[BatchDeleteTrack] called, selected size =', selectedTrackKeys.value.size)
  if (selectedTrackKeys.value.size === 0) return
  const pl = currentPlaylist.value
  if (!pl || !pl.music || pl.music.length === 0) return
  const keys = new Set(selectedTrackKeys.value)
  const matched = pl.music.filter((m, i) => keys.has(getTrackKey(m, i)))
  console.log('[BatchDeleteTrack] matched =', matched.length)
  if (matched.length === 0) {
    await appConfirm({
      title: '无匹配歌曲',
      message: '所选歌曲均已不在歌单中',
      detail: '歌曲可能已被其他操作删除',
      confirmText: '我知道了',
      cancelText: '关闭'
    })
    exitTrackBatchMode()
    return
  }
  const detail = pl.isBiliFavorite
    ? `共 ${matched.length} 首音乐将被删除。\n（仅删除本地副本，不会影响 B 站云端）`
    : `共 ${matched.length} 首音乐将被删除，此操作不可恢复。`
  const ok = await appConfirm({
    title: '批量删除歌曲',
    message: `确定要从歌单「${pl.name}」中删除已选中的 ${matched.length} 首歌曲吗？`,
    detail,
    confirmText: '批量删除',
    cancelText: '取消'
  })
  if (!ok) return
  try {
    const newList = pl.music.filter((m, i) => !keys.has(getTrackKey(m, i)))
    const deletedCount = pl.music.length - newList.length
    const pIdx = playlistStore.userPlaylists.findIndex(p => p.id === pl.id)
    if (pIdx >= 0) {
      playlistStore.userPlaylists[pIdx] = {
        ...playlistStore.userPlaylists[pIdx],
        music: newList
      }
      playlistStore.savePlaylists()
      // 刷新 currentPlaylist 引用
      playlistStore.setCurrentPlaylist(playlistStore.userPlaylists[pIdx])
    }
    console.log(`[BatchDeleteTrack] ✅ 删除 ${deletedCount} 首，剩余 ${newList.length} 首`)
    exitTrackBatchMode()
  } catch (err) {
    console.error('[BatchDeleteTrack] ❌', err)
    alert('批量删除失败：' + (err?.message || err))
  }
}

// 切歌单时自动清理批量模式
watch(currentPlaylist, () => {
  if (isTrackBatchMode.value) {
    exitTrackBatchMode()
  }
})

async function loadRecommendedMusic() {
  isLoadingRecommended.value = true
  
  try {
    // 使用随机关键词搜索作为推荐
    const randomKeywords = ['热门音乐', '流行歌曲', '经典老歌', '电音', '摇滚', '民谣', '说唱', '古风', '轻音乐', '影视原声']
    const randomKeyword = randomKeywords[Math.floor(Math.random() * randomKeywords.length)]
    
    // 完全通过 electronAPI 调用主进程
    let searchResult
    if (window.electronAPI) {
      console.log('开始搜索:', randomKeyword)
      searchResult = await window.electronAPI.searchMusic(randomKeyword, 1, 20)
      console.log('搜索结果:', searchResult)
    } else {
      // 为了 Web 环境的降级方案（如果有）
      searchResult = { code: -1, message: 'Not available in web mode' }
    }
    
    // 解析搜索结果
    if (searchResult.code === 0 && searchResult.data?.result) {
      // 找到 video 类型的结果
      const videoResult = searchResult.data.result.find(item => item.result_type === 'video');
      if (videoResult && videoResult.data?.length > 0) {
        // 转换搜索结果为音乐格式
        const musicList = videoResult.data.map((item, index) => ({
          bvid: item.bvid,
          aid: item.aid,
          title: stripHtmlTags(item.title),
          author: stripHtmlTags(item.author),
          cover: fixCoverUrl(item.pic),
          duration: typeof item.duration === 'string' ? parseDuration(item.duration) : item.duration || 180,
          playCount: item.play || 0,
          pubdate: item.pubdate
        }))
        
        // 过滤掉标题包含敏感词的歌曲
        const filteredMusic = musicList.filter(music => !music.title.includes('吻'))
        
        // 随机打乱结果
        const shuffledMusic = [...filteredMusic].sort(() => 0.5 - Math.random())
        recommendedMusic.value = shuffledMusic
      } else {
        recommendedMusic.value = []
      }
    } else {
      recommendedMusic.value = []
    }
  } catch (error) {
    console.error('加载推荐音乐失败:', error)
    recommendedMusic.value = []
  } finally {
    isLoadingRecommended.value = false
  }
}

async function handleSearch() {
  if (!searchQuery.value.trim()) return
  isSearching.value = true
  isLoadingSearch.value = true
  currentView.value = 'search'
  try {
    // 完全通过 electronAPI 调用
    let searchResult
    if (window.electronAPI) {
      console.log('开始搜索:', searchQuery.value)
      searchResult = await window.electronAPI.searchMusic(searchQuery.value, 1, 30)
      console.log('搜索结果:', searchResult)
    } else {
      searchResult = { code: -1, message: 'Not available' }
    }
    
    // 解析搜索结果
    if (searchResult.code === 0 && searchResult.data?.result) {
      // 找到 video 类型的结果
      const videoResult = searchResult.data.result.find(item => item.result_type === 'video');
      if (videoResult && videoResult.data?.length > 0) {
        // 转换搜索结果为音乐格式
        searchResults.value = videoResult.data.map((item, index) => ({
          bvid: item.bvid,
          aid: item.aid,
          title: stripHtmlTags(item.title),
          author: stripHtmlTags(item.author),
          cover: fixCoverUrl(item.pic),
          duration: typeof item.duration === 'string' ? parseDuration(item.duration) : item.duration || 180,
          playCount: item.play || 0,
          pubdate: item.pubdate
        }))
      } else {
        searchResults.value = []
      }
    } else {
      searchResults.value = []
    }
  } catch (error) {
    console.error('搜索音乐失败:', error)
    searchResults.value = []
  } finally {
    isLoadingSearch.value = false
  }
}

function getRandomIndex(max) {
  return Math.floor(Math.random() * max)
}

function getNextMusicIndex() {
  let musicList = currentView.value === 'search' ? searchResults.value : recommendedMusic.value
  if (currentPlaylist.value?.music) {
    musicList = currentPlaylist.value.music
  }

  if (!musicList || musicList.length === 0) return -1

  const currentIndex = musicList.findIndex(m => m.bvid === currentTrack.value?.bvid)

  switch (playMode.value) {
    case 'single':
      return currentIndex >= 0 ? currentIndex : 0
    case 'shuffle':
      let nextIndex
      do {
        nextIndex = getRandomIndex(musicList.length)
      } while (musicList.length > 1 && nextIndex === currentIndex)
      return nextIndex
    case 'loop':
      return currentIndex >= 0 ? (currentIndex + 1) % musicList.length : 0
    case 'order':
    default:
      if (currentIndex >= 0 && currentIndex < musicList.length - 1) {
        return currentIndex + 1
      }
      return -1
  }
}

async function playMusic(music) {
  console.log('开始播放:', music.title)
  // 没有 bvid 且无 favId 的内容（如纯音频）暂时不支持直接播放
  if (!music.bvid && !music.favId) {
    audioError.value = '该收藏内容暂不支持播放'
    playerStore.setAudioError(audioError.value)
    isAudioLoading.value = false
    playerStore.setIsAudioLoading(false)
    return
  }
  currentTrack.value = music
  // 同步到 playerStore，LyricDisplay 监听的是 playerStore.currentTrack
  playerStore.setCurrentTrack(music)
  playerStore.setIsPlaying(false)
  playerStore.setIsAudioLoading(true)
  playerStore.setAudioError('')
  playerStore.setDuration(music.duration || 180)
  playerStore.setCurrentTime(0)
  playerStore.setBufferedProgress(0)
  isPlaying.value = false
  isAudioLoading.value = true
  audioError.value = ''
  duration.value = music.duration || 180
  currentTime.value = 0
  bufferedProgress.value = 0
  // 切歌时清空分 P 列表，避免上一次的"多 P 合集"被 handleTrackEnd 误用
  // 导致歌单内普通歌曲不进入"下一首"分支
  currentVideoEpisodes.value = []
  currentEpisodeIndex.value = 0

  // 尝试加载视频合集（如果当前曲是多 P 合集，loadVideoSeries 里会再次填充分 P 列表，
  // 让 handleTrackEnd 自动在分 P 内循环；普通单曲则保持空，走歌单下一首）
  loadVideoSeries(music.bvid)

  // 更新系统媒体控制
  updateMediaSession()

  if (audioElement.value) {
    try {
      // 只有在音频正在播放时才调用pause()
      if (!audioElement.value.paused) {
        audioElement.value.pause()
      }
    } catch (error) {
      console.error('暂停音频失败:', error)
    }
    audioElement.value.src = ''
    audioElement.value = null
  }

  audioElement.value = new Audio()
  audioElement.value.crossOrigin = 'anonymous'

  // 接入 Web Audio Analyser，用于大屏播放页频谱可视化。
  // 每次 playMusic 都会创建新 Audio 元素，所以必须重新 attach。
  // 失败不影响正常播放。
  try {
    attachAudioAnalyser(audioElement.value)
  } catch (err) {
    console.warn('[AudioVisualizer] analyser 初始化失败:', err)
  }

  let audioSrc = null

  try {
    // 通过 electronAPI 获取视频详细信息
    let musicInfoResult
    if (window.electronAPI) {
      musicInfoResult = await window.electronAPI.getMusicInfo(music.bvid)
    }

    if (musicInfoResult?.code === 0) {
      const musicInfo = musicInfoResult.data

      // 通过 electronAPI 获取视频播放地址
      let playUrlResult
      if (window.electronAPI) {
        playUrlResult = await window.electronAPI.getMusicPlayUrl(music.bvid, music.cid || musicInfo.cid)
      }

      if (playUrlResult?.code === 0) {
        console.log('获取到播放地址')
        
        // 根据设置选择音频流
        audioSrc = selectAudioUrl(playUrlResult.data, settingsStore.audioQuality)
        
        console.log('使用音频地址:', audioSrc)
      }
    }
  } catch (error) {
    console.error('获取B站音频失败:', error)
  }

  if (!audioSrc) {
    audioSrc = 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3'
    console.log('使用备用音频源')
  }

  audioElement.value.src = audioSrc

  // 开始监控下载进度
  startDownloadProgressMonitor(music.bvid)

  audioElement.value.addEventListener('loadedmetadata', () => {
    console.log('音频加载完成，时长:', audioElement.value.duration)
    duration.value = audioElement.value.duration || music.duration || 180
    playerStore.setDuration(duration.value)
    isAudioLoading.value = false
    playerStore.setIsAudioLoading(false)
  })

  audioElement.value.addEventListener('timeupdate', () => {
    if (audioElement.value) {
      currentTime.value = audioElement.value.currentTime
      playerStore.setCurrentTime(currentTime.value)
      // 更新缓冲进度
      updateBufferedProgress()
    }
  })

  audioElement.value.addEventListener('ended', () => {
    console.log('音频播放结束')
    isPlaying.value = false
    playerStore.setIsPlaying(false)
    updateMediaSession()
    handleTrackEnd()
  })

  audioElement.value.addEventListener('error', (e) => {
    console.error('音频加载错误:', e)
    audioError.value = '音频加载失败'
    playerStore.setAudioError('音频加载失败')
    isAudioLoading.value = false
    playerStore.setIsAudioLoading(false)
  })

  audioElement.value.addEventListener('canplaythrough', () => {
    console.log('音频可以播放')
    isAudioLoading.value = false
    playerStore.setIsAudioLoading(false)
    bufferedProgress.value = 100
    playerStore.setBufferedProgress(100)
  })

  audioElement.value.volume = 1.0

  try {
    await audioElement.value.play()
    isPlaying.value = true
    playerStore.setIsPlaying(true)
    updateMediaSession()
    console.log('音乐播放成功')
  } catch (error) {
    console.error('播放失败:', error)
    isAudioLoading.value = false
    playerStore.setIsAudioLoading(false)
  }

  // 之前这里会强制 showPlayerPage=true 自动跳到大屏播放页，
  // 改成"不自动跳"：点击播放只让底部播放栏出现 + 播放当前曲目。
  // 用户需要大屏视图时手动点播放栏封面即可（见 openPlayerPageFromCover）。
}

function updateBufferedProgress() {
  if (audioElement.value && audioElement.value.buffered.length > 0) {
    const bufferedEnd = audioElement.value.buffered.end(audioElement.value.buffered.length - 1)
    const duration = audioElement.value.duration || 1
    bufferedProgress.value = Math.round((bufferedEnd / duration) * 100)
  }
}

async function loadVideoSeries(bvid) {
  try {
    // 获取视频详细信息，包含合集信息
    const result = await getWebInterfaceView({ bvid: bvid })
    if (result.code === 0 && result.data.pages && result.data.pages.length > 1) {
      const episodes = result.data.pages.map((page, index) => ({
        bvid: bvid,
        cid: page.cid,
        title: page.part,
        duration: page.duration,
        cover: fixCoverUrl(page.first_frame)
      }))
      // 构建合集信息
      currentSeries.value = {
        id: bvid,
        title: result.data.title,
        cover: fixCoverUrl(result.data.pic),
        episodes
      }
      // 同步填充分 P 列表，让 handleTrackEnd 能直接在分 P 内循环，
      // 不再依赖用户先打开一次"分P列表"面板
      currentVideoEpisodes.value = episodes.map(e => ({
        bvid: e.bvid,
        cid: e.cid,
        part: e.title,
        duration: e.duration
      }))
      // 定位当前 cid 在分 P 中的位置
      const currentCid = currentTrack.value?.cid
      const idx = currentCid
        ? currentVideoEpisodes.value.findIndex(e => e.cid === currentCid)
        : 0
      currentEpisodeIndex.value = idx >= 0 ? idx : 0
      showSeriesPanel.value = true
      console.log('加载视频合集成功:', result.data.title, '共', result.data.pages.length, '集')
    } else {
      currentSeries.value = null
      currentVideoEpisodes.value = []
      currentEpisodeIndex.value = 0
      showSeriesPanel.value = false
    }
  } catch (error) {
    console.error('加载视频合集失败:', error)
    currentSeries.value = null
    currentVideoEpisodes.value = []
    currentEpisodeIndex.value = 0
    showSeriesPanel.value = false
  }
}

function playFromSeries(episode) {
  playMusic({
    bvid: episode.bvid,
    title: episode.title,
    author: episode.author || currentTrack.value?.author || '未知作者',
    cover: episode.cover || currentTrack.value?.cover,
    duration: episode.duration || 180
  })
}

function toggleSeriesPanel() {
  showSeriesPanel.value = !showSeriesPanel.value
}

async function togglePlaylistManager() {
  if (!currentTrack.value) {
    showPlaylistManager.value = false
    return
  }
  
  showPlaylistManager.value = !showPlaylistManager.value
  
  // If opening, load episodes for current track
  if (showPlaylistManager.value) {
    isLoadingEpisodes.value = true
    try {
      const response = await window.electronAPI.getVideoEpisodes(currentTrack.value.bvid)
      if (response.code === 0 && response.data) {
        currentVideoEpisodes.value = response.data
        // Find current episode index
        if (currentTrack.value.cid) {
          const currentIndex = currentVideoEpisodes.value.findIndex(episode => episode.cid === currentTrack.value.cid)
          currentEpisodeIndex.value = currentIndex >= 0 ? currentIndex : 0
        } else {
          currentEpisodeIndex.value = 0
        }
      } else {
        currentVideoEpisodes.value = []
        currentEpisodeIndex.value = 0
      }
    } catch (error) {
      console.error('获取分P列表失败:', error)
      currentVideoEpisodes.value = []
      currentEpisodeIndex.value = 0
    } finally {
      isLoadingEpisodes.value = false
    }
  }
}

async function playEpisode(episode) {
  if (!currentTrack.value) return
  
  try {
    // Find the episode index
    const episodeIndex = currentVideoEpisodes.value.findIndex(e => e.cid === episode.cid)
    if (episodeIndex >= 0) {
      currentEpisodeIndex.value = episodeIndex
    }
    
    // Create a new track object with the episode's cid
    const episodeTrack = {
      ...currentTrack.value,
      cid: episode.cid,
      title: episode.part || currentTrack.value.title,
      duration: episode.duration || currentTrack.value.duration
    }
    
    // Update current track
    currentTrack.value = episodeTrack
    playerStore.setCurrentTrack(episodeTrack)

    // Load and play the episode
    await playMusic(episodeTrack)
    
    // Close the playlist manager
    showPlaylistManager.value = false
  } catch (error) {
    console.error('播放分P失败:', error)
  }
}

function startDownloadProgressMonitor(bvid) {
  // 清除之前的监控
  if (downloadMonitorInterval) {
    clearInterval(downloadMonitorInterval)
  }

  isDownloading.value = false
  downloadProgress.value = 0

  // 新的API系统暂时不支持下载进度监控
  console.log('下载进度监控已禁用')
}

function stopDownloadProgressMonitor() {
  if (downloadMonitorInterval) {
    clearInterval(downloadMonitorInterval)
    downloadMonitorInterval = null
  }
  isDownloading.value = false
  downloadProgress.value = 0
}

function handleTrackEnd() {
  // Check if current track has episodes
  if (currentTrack.value && currentVideoEpisodes.value.length > 0) {
    let nextEpisodeIndex
    
    if (playMode.value === 'shuffle') {
      // Random episode
      do {
        nextEpisodeIndex = getRandomIndex(currentVideoEpisodes.value.length)
      } while (currentVideoEpisodes.value.length > 1 && nextEpisodeIndex === currentEpisodeIndex.value)
    } else {
      // Next episode, wrap around
      nextEpisodeIndex = (currentEpisodeIndex.value + 1) % currentVideoEpisodes.value.length
    }
    
    const nextEpisode = currentVideoEpisodes.value[nextEpisodeIndex]
    if (nextEpisode) {
      playEpisode(nextEpisode)
    } else {
      isPlaying.value = false
      playerStore.setIsPlaying(false)
    }
  } else {
    // Normal song navigation
    const nextIndex = getNextMusicIndex()
    let musicList = currentView.value === 'search' ? searchResults.value : recommendedMusic.value
    if (currentPlaylist.value?.music) {
      musicList = currentPlaylist.value.music
    }

    if (nextIndex >= 0 && musicList && musicList[nextIndex]) {
      playMusic(musicList[nextIndex])
    } else {
      isPlaying.value = false
      playerStore.setIsPlaying(false)
    }
  }
}

function togglePlayMode() {
  const modes = ['order', 'loop', 'single', 'shuffle']
  const currentIndex = modes.indexOf(playMode.value)
  playMode.value = modes[(currentIndex + 1) % modes.length]
}
function getPlayModeIcon() {
  const mode = playModes.find(m => m.value === playMode.value)
  return mode ? mode.icon : playModes[0].icon
}

function getPlayModeLabel() {
  const mode = playModes.find(m => m.value === playMode.value)
  return mode ? mode.label : '顺序播放'
}

function togglePlayPause() {
  if (!audioElement.value) return

  if (isPlaying.value) {
    audioElement.value.pause()
  } else {
    audioElement.value.play()
  }
  isPlaying.value = !isPlaying.value
  playerStore.setIsPlaying(isPlaying.value)
  updateMediaSession()
}

function playPrevious() {
  // Check if current track has episodes
  if (currentTrack.value && currentVideoEpisodes.value.length > 0) {
    let prevEpisodeIndex
    
    if (playMode.value === 'shuffle') {
      // Random episode
      do {
        prevEpisodeIndex = getRandomIndex(currentVideoEpisodes.value.length)
      } while (currentVideoEpisodes.value.length > 1 && prevEpisodeIndex === currentEpisodeIndex.value)
    } else {
      // Previous episode, wrap around
      prevEpisodeIndex = currentEpisodeIndex.value > 0 ? currentEpisodeIndex.value - 1 : currentVideoEpisodes.value.length - 1
    }
    
    const prevEpisode = currentVideoEpisodes.value[prevEpisodeIndex]
    if (prevEpisode) {
      playEpisode(prevEpisode)
    }
  } else {
    // Normal song navigation
    let musicList = currentView.value === 'search' ? searchResults.value : recommendedMusic.value
    if (currentPlaylist.value?.music) {
      musicList = currentPlaylist.value.music
    }

    if (!musicList || musicList.length === 0) return

    const currentIndex = musicList.findIndex(m => m.bvid === currentTrack.value?.bvid)
    let prevIndex

    if (playMode.value === 'shuffle') {
      do {
        prevIndex = getRandomIndex(musicList.length)
      } while (musicList.length > 1 && prevIndex === currentIndex)
    } else {
      prevIndex = currentIndex > 0 ? currentIndex - 1 : musicList.length - 1
    }

    if (musicList[prevIndex]) {
      playMusic(musicList[prevIndex])
    }
  }
}

function playNext() {
  // Check if current track has episodes
  if (currentTrack.value && currentVideoEpisodes.value.length > 0) {
    let nextEpisodeIndex
    
    if (playMode.value === 'shuffle') {
      // Random episode
      do {
        nextEpisodeIndex = getRandomIndex(currentVideoEpisodes.value.length)
      } while (currentVideoEpisodes.value.length > 1 && nextEpisodeIndex === currentEpisodeIndex.value)
    } else {
      // Next episode, wrap around
      nextEpisodeIndex = (currentEpisodeIndex.value + 1) % currentVideoEpisodes.value.length
    }
    
    const nextEpisode = currentVideoEpisodes.value[nextEpisodeIndex]
    if (nextEpisode) {
      playEpisode(nextEpisode)
    }
  } else {
    // Normal song navigation
    const nextIndex = getNextMusicIndex()
    let musicList = currentView.value === 'search' ? searchResults.value : recommendedMusic.value
    if (currentPlaylist.value?.music) {
      musicList = currentPlaylist.value.music
    }

    if (nextIndex >= 0 && musicList && musicList[nextIndex]) {
      playMusic(musicList[nextIndex])
    }
  }
}

function onProgressInput(event) {
  const newTime = parseFloat(event.target.value)
  if (audioElement.value && !isNaN(newTime)) {
    audioElement.value.currentTime = newTime
    currentTime.value = newTime
    playerStore.setCurrentTime(newTime)
  }
}

function onProgressChange(event) {
  const newTime = parseFloat(event.target.value)
  if (audioElement.value && !isNaN(newTime)) {
    audioElement.value.currentTime = newTime
    currentTime.value = newTime
    playerStore.setCurrentTime(newTime)
  }
}

function handleLyricSeek(targetTime) {
  if (audioElement.value && !isNaN(targetTime)) {
    audioElement.value.currentTime = targetTime
    currentTime.value = targetTime
    playerStore.setCurrentTime(targetTime)
  }
}

function toggleLyricPanel() {
  showLyricPanel.value = !showLyricPanel.value
  lyricStore.setShowLyricPanel(showLyricPanel.value)
}

function createPlaylist() {
  showCreatePlaylistModal.value = true
  newPlaylistName.value = ''
}

function confirmCreatePlaylist() {
  const name = newPlaylistName.value.trim()
  if (!name) return
  // 用 store 的统一 createPlaylist，id 走稳定生成器（Date.now+random），避免快速连点冲突
  const pl = playlistStore.createPlaylist(name)
  playlistStore.savePlaylists()
  showCreatePlaylistModal.value = false
}

function cancelCreatePlaylist() {
  showCreatePlaylistModal.value = false
  newPlaylistName.value = ''
}

function openAddToPlaylistModal() {
  if (!currentTrack.value) return
  showAddToPlaylistModal.value = true
}

function addToPlaylist(playlist) {
  if (!currentTrack.value || !playlist) return
  const music = { ...currentTrack.value }
  if (!playlist.music) {
    playlist.music = []
  }
  const exists = playlist.music.some(m => m.bvid === music.bvid && m.cid === music.cid)
  if (!exists) {
    playlist.music.push(music)
    playlistStore.savePlaylists()
  }
  showAddToPlaylistModal.value = false
}

async function downloadMusic(music) {
  try {
    isAudioLoading.value = true

    let musicInfoResult
    if (!music.cid) {
      musicInfoResult = await window.electronAPI.getMusicInfo(music.bvid)
      if (musicInfoResult.code !== 0) {
        throw new Error('获取音乐信息失败')
      }
    }
    const cid = music.cid || musicInfoResult?.data?.cid

    const playUrlResult = await window.electronAPI.getMusicPlayUrl(music.bvid, cid)
    if (playUrlResult.code !== 0) {
      throw new Error('获取播放地址失败')
    }

    const audioInfo = selectAudioInfo(playUrlResult.data, settingsStore.audioQuality)
    if (!audioInfo?.url) {
      throw new Error('未找到音频地址')
    }
    const audioUrl = audioInfo.url
    const audioCodecs = audioInfo.codecs

    downloadStore.setShowDownloadManager(true)
    await downloadStore.addTask({
      audioUrl,
      fileName: `${music.title} - ${music.author}`,
      bvid: music.bvid,
      cid,
      title: music.title,
      author: music.author,
      quality: settingsStore.audioQuality,
      audioCodecs
    })
  } catch (error) {
    console.error('下载音乐失败:', error)
    alert('下载失败：' + error.message)
  } finally {
    isAudioLoading.value = false
  }
}

async function openDownloadFolder() {
  try {
    const result = await window.electronAPI.openDownloadFolder()
    if (result.code === 0) {
      console.log('成功打开下载目录')
    } else {
      throw new Error(result.message || '打开下载目录失败')
    }
  } catch (error) {
    console.error('打开下载目录失败:', error)
    alert('打开下载目录失败：' + error.message)
  }
}

function loadPlaylists() {
  playlistStore.loadPlaylists()
}

function deletePlaylist(playlist) {
  if (!playlist || playlist.isDefault) return
  const ok = playlistStore.deletePlaylist(playlist.id)
  if (!ok) return
  // 如果删的就是当前正在查看的歌单，需要清理 + 跳回列表
  if (currentPlaylist.value && currentPlaylist.value.id === playlist.id) {
    playlistStore.setCurrentPlaylist(null)
    backToPlaylistList()
  }
}

function exportPlaylist(playlist) {
  if (!playlist) return
  const dataStr = JSON.stringify(playlist, null, 2)
  const blob = new Blob([dataStr], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${playlist.name || '歌单'}.json`
  a.click()
  URL.revokeObjectURL(url)
}

function openLoginPanel() {
  showLoginPanel.value = true
}

function closeLoginPanel() {
  showLoginPanel.value = false
}

async function handleLoginSuccess() {
  // 登录成功后只拉取一次用户信息
  // （按用户要求：不再静默同步 B 站收藏夹，避免每次启动/登录都触发远端请求）
  if (!userStore.userInfo) {
    await userStore.fetchUserInfo()
  }
}

async function handleSyncFavorites() {
  if (!userStore.isLoggedIn || !userStore.userInfo?.mid) {
    alert('请先登录 B 站账号')
    return
  }
  const added = await userStore.syncFavorites(playlistStore)
  if (added === 0) {
    alert('收藏夹已为最新或没有可同步的项')
  } else {
    alert(`已同步 ${added} 个收藏夹到我的歌单`)
  }
}

function importPlaylist() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json'
  input.onchange = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target.result)
        if (imported.name && Array.isArray(imported.music)) {
          // 用统一 createPlaylist，id 走稳定生成器
          const pl = playlistStore.createPlaylist(imported.name, {
            cover: imported.cover || '',
            music: imported.music
          })
          playlistStore.savePlaylists()
        }
      } catch (error) {
        console.error('导入歌单失败:', error)
      }
    }
    reader.readAsText(file)
  }
  input.click()
}

watch(showPlayerPage, (newVal) => {
  // CSS 动画现在由 .player-page.active 类自动控制
})

// 实时同步播放器栏显隐状态到 document 属性，让 dock / main-content 立即响应
function syncPlayerState(track) {
  if (track) {
    document.documentElement.setAttribute('data-has-player', '')
  } else {
    document.documentElement.removeAttribute('data-has-player')
  }
}

watch(
  () => playerStore.currentTrack,
  (track) => syncPlayerState(track),
  { immediate: true, deep: true }
)

// 监听 MineView 等子组件派发的事件
function handlePinkMusicEvent(event) {
  const type = event.type
  if (type === 'pink-music:play-track') {
    playMusic(event.detail)
  } else if (type === 'pink-music:open-download') {
    downloadStore.setShowDownloadManager(true)
  } else if (type === 'pink-music:open-login') {
    showLoginPanel.value = true
  } else if (type === 'pink-music:playlist-deleted') {
    // 侧边栏/AppDock 等不在父组件作用域的删除入口派发的事件
    // 如果删的就是当前正在查看的歌单，需要清理 + 跳回列表
    const deletedId = event.detail?.id
    if (deletedId && currentPlaylist.value && currentPlaylist.value.id === deletedId) {
      playlistStore.setCurrentPlaylist(null)
      backToPlaylistList()
    }
  }
}

// Liquid Glass：应用 SVG feDisplacementMap 实现的液体玻璃效果
function setupLiquidGlass() {
  if (topbarRef.value && !liquidGlassInstances.has('topbar')) {
    const inst = applyLiquidGlass(topbarRef.value, {
      depth: 0.06,
      edgeSoftness: 0.4,
      backdrop: 'blur(1.5px) contrast(1.2) brightness(1.05) saturate(1.3)'
    })
    if (inst) liquidGlassInstances.set('topbar', inst)
  }
  if (playerBarRef.value && !liquidGlassInstances.has('playerBar')) {
    const inst = applyLiquidGlass(playerBarRef.value, {
      depth: 0.08,
      edgeSoftness: 0.35,
      backdrop: 'blur(2px) contrast(1.25) brightness(1.05) saturate(1.4)'
    })
    if (inst) liquidGlassInstances.set('playerBar', inst)
  }
}

// macOS 原生菜单命令处理
let unregisterMenuCommand = null
function handleMenuCommand(command) {
  if (!command || !command.action) return
  switch (command.action) {
    case 'toggle-play-pause':
      togglePlayPause()
      break
    case 'play-next':
      playNext()
      break
    case 'play-previous':
      playPrevious()
      break
    case 'set-play-mode':
      if (command.payload) playMode.value = command.payload
      break
    case 'go-home':
      goToHome()
      break
    case 'go-search':
      goToSearch()
      break
    case 'toggle-theme':
      toggleThemeMode()
      break
    case 'toggle-visualizer':
      settingsStore.audioVisualizerEnabled = !settingsStore.audioVisualizerEnabled
      break
    case 'toggle-lyric':
      toggleLyricPanel()
      break
    case 'open-settings':
      openSettings()
      break
    default:
      console.warn('[MenuCommand] 未知菜单命令:', command.action)
  }
}

onMounted(async () => {
  // 注册 macOS 原生菜单命令监听
  if (window.electronPlayer && window.electronPlayer.onMenuCommand) {
    unregisterMenuCommand = window.electronPlayer.onMenuCommand(handleMenuCommand)
  }
  // 主题应用：统一交给 themeStore（兼容旧版 localStorage 键名）
  themeStore.initTheme()
  // 关键修复：歌单加载必须 await，不能 fire-and-forget！
  // 否则会出现以下竞态：
  //   1) peek 拿不到 localStorage（空）→ 初始 state = []
  //   2) 用户立刻添加歌单/歌曲 → savePlaylists() 写空 state 到主存储
  //   3) async load() 才完成 → 主存储原数据已被覆盖
  // 改为 await：等 load() 完成、_loaded 置位、迁移完成后再继续，
  // 期间任何 savePlaylists() 会被 store 内部排队，load 完才 flush。
  await playlistStore.load()
  loadRecommendedMusic()
  setupMediaSessionHandlers()
  downloadStore.loadTasks()
  downloadStore.registerProgressListener()
  window.addEventListener('pink-music:play-track', handlePinkMusicEvent)
  window.addEventListener('pink-music:open-download', handlePinkMusicEvent)
  window.addEventListener('pink-music:open-login', handlePinkMusicEvent)
  window.addEventListener('pink-music:playlist-deleted', handlePinkMusicEvent)

  // ───────── 持久化存储启动加载 ─────────
  // 各 store 的 load() 都会从主存储 userData/app-data/<key>.json 拉最新数据；
  // 主存储为空时自动从 localStorage 老 key 迁移到主存储。
  // 并行执行，减少启动延迟。
  // 关键修复：把 playlistStore.load() 也加进来。
  // 虽然上面已经 await 过一次（保证首屏前就绪），这里再放一次是为了
  // 兼容"组件 onMounted 之前已经触发 load 但还没完成"的边界场景（如
  // 别的组件 import 了 store 立刻调用 load()），统一让 _loaded 流程
  // 在主流程里被正确识别。
  await Promise.allSettled([
    themeStore.load(),
    settingsStore.load(),
    playerStore.load(),
    lyricStore.load(),
    userStore.load(),
    playlistStore.load()
  ])

  // 启动时尝试恢复登录态：先检查主进程是否持有 B 站 cookie，再拉取用户信息
  try {
    const restored = await userStore.restoreFromCookies()
    if (!restored) {
      await userStore.fetchUserInfo()
    }
  } catch (error) {
    console.error('恢复登录态失败:', error)
  }
  // 等 DOM 稳定后初始化 liquid glass，并监听播放器栏显隐
  await nextTick()
  setupLiquidGlass()
  watch(playerBarRef, (val) => {
    if (val) setupLiquidGlass()
  })

  // 关窗口前 flush 协议：主进程 before-quit 时通知
  if (window.electronAPI?.onFlushRequired) {
    const flushHandler = async () => {
      try {
        console.log('[App] 收到 flush 请求，开始同步所有 store')
        // 歌单最重要，先 flush
        await playlistStore.flush(2500)
        // 其他 store 也强制 flush：先同步写 localStorage（writeLocalJsonNow 走
        // 同步写，不依赖 debounce 队列），再发主存储 IPC。
        // 这样能在关窗口的 3s 死线前确保 localStorage 一定落盘，主存储 IPC 已经发出。
        const flushTasks = []
        try { flushTasks.push(themeStore.persist?.() ?? themeStore.save?.()) } catch (_) {}
        try { flushTasks.push(settingsStore.persist?.() ?? settingsStore.save?.()) } catch (_) {}
        try { flushTasks.push(playerStore.saveHistory?.()) } catch (_) {}
        try { flushTasks.push(lyricStore.persist?.() ?? lyricStore.save?.()) } catch (_) {}
        try { flushTasks.push(userStore.persist?.() ?? userStore.save?.()) } catch (_) {}
        await Promise.allSettled(flushTasks)
        console.log('[App] flush 完毕，通知主进程')
      } catch (e) {
        console.error('[App] flush 异常:', e.message)
      } finally {
        // 无论成功失败都告诉主进程可以退出了（3s 超时保护）
        try { window.electronAPI?.notifyFlushDone?.() } catch (_) {}
      }
    }
    unregisterFlushListener = window.electronAPI.onFlushRequired(flushHandler)
    // 暴露给 HMR 用：让下次模块热更时能调用反注册
    window[HMR_FLUSH_KEY] = unregisterFlushListener
  }

  // 兜底：浏览器原生 beforeunload 事件（双保险，覆盖 webview 之类场景）
  const beforeUnloadFlush = () => {
    try { playlistStore.flush?.(500) } catch (_) {}
  }
  window.addEventListener('beforeunload', beforeUnloadFlush)
  window.addEventListener('pagehide', beforeUnloadFlush)
})

onUnmounted(() => {
  // 注销 macOS 原生菜单命令监听
  if (unregisterMenuCommand) {
    unregisterMenuCommand()
    unregisterMenuCommand = null
  }
  // 注销 flush 监听器（HMR / 组件卸载时清理，避免重复注册）
  if (unregisterFlushListener) {
    try { unregisterFlushListener() } catch (_) {}
    unregisterFlushListener = null
  }
  if (window[HMR_FLUSH_KEY]) {
    window[HMR_FLUSH_KEY] = null
  }
  window.removeEventListener('pink-music:play-track', handlePinkMusicEvent)
  window.removeEventListener('pink-music:open-download', handlePinkMusicEvent)
  window.removeEventListener('pink-music:open-login', handlePinkMusicEvent)
  liquidGlassInstances.forEach((inst) => destroyLiquidGlass(inst.id))
  liquidGlassInstances.clear()
})
</script>

<template>
  <div class="app-container">
    <div class="drag-bar"></div>
    <WindowControls />
    <header ref="topbarRef" class="topbar">
      <div class="topbar-left">
        <h1 class="brand">Pink Music</h1>
      </div>

      <div class="topbar-right">
        <!-- 一键切换深色/浅色模式 -->
        <button
          class="topbar-btn theme-quick-toggle"
          :title="themeStore.currentTheme === 'dark' ? '切换到浅色模式' : '切换到深色模式'"
          @click="toggleThemeMode"
        >
          <svg v-if="themeStore.currentTheme === 'dark'" viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
            <path d="M6.76 4.84l-1.8-1.79-1.41 1.41 1.79 1.79 1.42-1.41zM4 10.5H1v2h3v-2zm9-9.95h-2V3.5h2V.55zm7.45 3.91l-1.41-1.41-1.79 1.79 1.41 1.41 1.79-1.79zm-3.21 13.7l1.79 1.8 1.41-1.41-1.8-1.79-1.4 1.4zM20 10.5v2h3v-2h-3zm-8-5c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm-1 16.95h2V19.5h-2v2.95zm-7.45-3.91l1.41 1.41 1.79-1.8-1.41-1.41-1.79 1.8z"/>
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
            <path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-.46-.04-.92-.1-1.36-.98 1.37-2.58 2.26-4.4 2.26-2.98 0-5.4-2.42-5.4-5.4 0-1.81.89-3.42 2.26-4.4-.44-.06-.9-.1-1.36-.1z"/>
          </svg>
        </button>
        <button
          v-if="userStore.hasLoginCookie"
          class="topbar-btn topbar-user"
          @click="openLoginPanel"
          :class="{ active: showLoginPanel }"
          title="已登录 B 站账号"
        >
          <img
            :src="userStore.userInfo?.face"
            class="topbar-avatar"
            alt=""
            @error="$event.target.style.display='none'"
          />
          <span>{{ userStore.userInfo?.uname || '已登录' }}</span>
        </button>
        <button v-else class="topbar-btn topbar-login" @click="openLoginPanel" title="登录 B 站">
          <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
            <path d="M11 7L9.6 8.4l2.6 2.6H2v2h10.2l-2.6 2.6L11 17l5-5-5-5zm9 12h-8v2h8c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-8v2h8v14z"/>
          </svg>
          <span>登录 B 站</span>
        </button>
      </div>
    </header>

    <main class="main-content">
      <Transition name="page" mode="out-in">
        <section v-if="currentView === 'home'" key="home" class="home-section">
        <div class="hero-section">
          <h2 class="text-gradient">欢迎使用 Pink Music</h2>
          <p>从 B 站发现并播放你喜欢的音乐</p>
        </div>

        <div class="recommended-section">
          <div class="section-header">
            <h3>推荐音乐</h3>
            <button
              class="refresh-btn"
              @click="loadRecommendedMusic"
              :disabled="isLoadingRecommended"
              title="刷新推荐"
            >
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                width="18"
                height="18"
                :class="{ spinning: isLoadingRecommended }"
              >
                <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
              </svg>
            </button>
          </div>
          <div v-if="isLoadingRecommended" class="loading">
            <div class="loading-spinner"></div>
            <p>加载中...</p>
          </div>
          <div v-else-if="recommendedMusic.length === 0" class="loading">
            <p>暂无推荐音乐</p>
          </div>
          <div v-else class="card-grid">
            <div
              v-for="(music, index) in recommendedMusic"
              :key="music.bvid"
              class="music-card"
              :style="{ '--card-index': index }"
              @click="playMusic(music)"
            >
              <div class="card-cover">
                <img :src="music.cover" :alt="music.title" @error="$event.target.src='https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=400'">
                <div class="play-overlay">
                  <button class="play-button" @click.stop="playMusic(music)">
                    <svg viewBox="0 0 24 24" fill="white" width="24" height="24"><path d="M8 5v14l11-7z"/></svg>
                  </button>
                  <button class="download-button" @click.stop="downloadMusic(music)" title="下载">
                    <svg viewBox="0 0 24 24" fill="white" width="18" height="18"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
                  </button>
                </div>
              </div>
              <h4 class="card-title">{{ music.title }}</h4>
              <p class="card-artist">{{ music.author }}</p>
              <div class="music-card-meta">
                <span>{{ formatPlayCount(music.playCount) }} 播放</span>
                <span>{{ parseDuration(music.duration) }}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section v-else-if="currentView === 'search'" key="search" class="search-section">
        <div class="header">
          <div class="search-box">
            <input 
              type="text"
              v-model="searchQuery"
              placeholder="搜索音乐..." 
              @keyup.enter="handleSearch"
            >
            <button @click="handleSearch">
              <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
            </button>
          </div>
        </div>

        <!-- 搜索结果（仅在搜索时显示在中间） -->
        <div v-if="isLoadingSearch" class="loading">
          <div class="loading-spinner"></div>
          <p>搜索中...</p>
        </div>
        <div v-else-if="isSearching && searchResults.length === 0" class="loading">
          <p>未找到相关音乐</p>
        </div>
        <div v-else-if="isSearching" class="card-grid">
          <div
            v-for="(music, index) in searchResults"
            :key="music.bvid"
            class="music-card"
            :style="{ '--card-index': index }"
            @click="playMusic(music)"
          >
            <div class="card-cover">
              <img :src="music.cover" :alt="music.title" @error="$event.target.src='https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=400'">
              <div class="play-overlay">
                <button class="play-button" @click.stop="playMusic(music)">
                  <svg viewBox="0 0 24 24" fill="white" width="24" height="24"><path d="M8 5v14l11-7z"/></svg>
                </button>
                <button class="download-button" @click.stop="downloadMusic(music)" title="下载">
                  <svg viewBox="0 0 24 24" fill="white" width="18" height="18"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
                </button>
              </div>
            </div>
            <h4 class="card-title">{{ music.title }}</h4>
            <p class="card-artist">{{ music.author }}</p>
            <div class="music-card-meta">
              <span>{{ formatPlayCount(music.playCount) }} 播放</span>
              <span>{{ parseDuration(music.duration) }}</span>
            </div>
          </div>
        </div>
      </section>

      <section v-else-if="currentView === 'playlist'" key="playlist" class="playlist-page">
        <!-- 歌单列表 -->
        <div v-if="!currentPlaylist" class="playlist-list-view">
          <div class="playlist-list-header">
            <div>
              <span class="playlist-label">我的歌单</span>
              <h2 class="playlist-list-title">全部歌单</h2>
              <p class="playlist-list-subtitle">
                <template v-if="isBatchMode">
                  已选 {{ selectedPlaylistIds.size }} / {{ playlistStore.userPlaylists.length }} 个
                </template>
                <template v-else>
                  共 {{ playlistStore.userPlaylists.length }} 个歌单
                </template>
              </p>
            </div>
            <div class="playlist-list-actions">
              <!-- 批量模式下的工具栏 -->
              <template v-if="isBatchMode">
                <button
                  v-if="getDeletablePlaylistIds().length > 0"
                  @click="toggleSelectAllPlaylists"
                  class="playlist-action-btn"
                  :title="isAllDeletablePlaylistsSelected ? '取消全选' : '选中所有可删除的歌单（默认收藏夹除外）'"
                >
                  <svg v-if="isAllDeletablePlaylistsSelected" viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                  <svg v-else viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>
                  <span>{{ isAllDeletablePlaylistsSelected ? '取消全选' : '全选' }}</span>
                </button>
                <button
                  @click="exitBatchMode"
                  class="playlist-action-btn"
                  title="退出批量模式"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                  <span>取消</span>
                </button>
                <button
                  @click="confirmBatchDeletePlaylists"
                  class="playlist-action-btn danger"
                  :disabled="selectedPlaylistIds.size === 0"
                  :title="selectedPlaylistIds.size === 0 ? '请先选择要删除的歌单' : '批量删除所选歌单'"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1-1H5v2h14V4z"/></svg>
                  <span>批量删除{{ selectedPlaylistIds.size > 0 ? ` (${selectedPlaylistIds.size})` : '' }}</span>
                </button>
              </template>
              <!-- 正常模式下的工具栏 -->
              <template v-else>
                <button @click="createPlaylist" class="playlist-action-btn primary" title="新建歌单">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
                  <span>新建歌单</span>
                </button>
                <button @click="importPlaylist" class="playlist-action-btn" title="导入歌单">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z"/></svg>
                  <span>导入歌单</span>
                </button>
                <button @click="handleSyncFavorites" class="playlist-action-btn" title="从 B 站收藏夹同步">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg>
                  <span>同步收藏夹</span>
                </button>
                <button
                  v-if="playlistStore.userPlaylists.length > 1"
                  @click="enterBatchMode"
                  class="playlist-action-btn"
                  title="批量管理歌单"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M3 5h2v2H3V5zm4 0h14v2H7V5zM3 11h2v2H3v-2zm4 0h14v2H7v-2zM3 17h2v2H3v-2zm4 0h14v2H7v-2z"/></svg>
                  <span>批量管理</span>
                </button>
              </template>
            </div>
          </div>

          <div v-if="playlistStore.userPlaylists.length === 0" class="playlist-empty">
            <div class="empty-icon">
              <svg viewBox="0 0 24 24" fill="currentColor" width="48" height="48">
                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
              </svg>
            </div>
            <p>还没有歌单</p>
            <div class="empty-actions">
              <button @click="createPlaylist" class="load-fav-btn">新建一个歌单</button>
              <button @click="importPlaylist" class="playlist-action-btn">从 JSON 导入</button>
            </div>
          </div>

          <div v-else class="playlist-cards-grid">
            <div
              v-for="(playlist, index) in playlistStore.userPlaylists"
              :key="playlist.id"
              class="playlist-card-item"
              :class="{
                'is-bili-fav': playlist.isBiliFavorite,
                'is-default': playlist.isDefault,
                'is-batch-mode': isBatchMode,
                'is-selected': isBatchMode && isPlaylistSelected(playlist),
                'is-disabled': isBatchMode && playlist.isDefault
              }"
              :style="{ '--card-index': index }"
              @click="isBatchMode ? togglePlaylistSelection(playlist) : goToPlaylist(playlist)"
            >
              <div
                v-if="isBatchMode"
                class="playlist-card-checkbox"
                :class="{ checked: isPlaylistSelected(playlist) }"
                @click.stop="togglePlaylistSelection(playlist)"
              >
                <svg v-if="isPlaylistSelected(playlist)" viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>
                <span v-else-if="playlist.isDefault" class="lock-hint" title="默认收藏夹不可删除">🔒</span>
              </div>
              <div class="playlist-card-cover">
              <img
                :src="fixCoverUrl(playlist.cover, 300) || 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=300'"
                :alt="playlist.name"
                loading="lazy"
                decoding="async"
                @error="$event.target.src='https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=300'"
              />
              <div
                v-if="!isBatchMode"
                class="playlist-card-overlay"
                :class="{ 'is-clickable': playlist.music && playlist.music.length > 0 }"
                :title="playlist.music && playlist.music.length > 0 ? '一键播放该歌单' : '该歌单暂无歌曲'"
                @click.stop="playPlaylistAll(playlist)"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" width="32" height="32">
                  <path d="M8 5v14l11-7z"/>
                </svg>
              </div>
              <div
                v-else
                class="playlist-card-overlay playlist-card-overlay--batch"
                :class="{ 'is-checked': isPlaylistSelected(playlist) }"
                @click.stop="togglePlaylistSelection(playlist)"
              >
                <svg v-if="isPlaylistSelected(playlist)" viewBox="0 0 24 24" fill="currentColor" width="36" height="36"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>
              </div>
              <span v-if="playlist.isBiliFavorite" class="bili-fav-badge">B站</span>
              <span v-if="playlist.isDefault" class="default-badge">默认</span>
            </div>
              <div class="playlist-card-body">
                <h4 class="playlist-card-name">{{ playlist.name }}</h4>
                <p class="playlist-card-count">{{ playlist.music?.length || playlist.media_count || 0 }} 首</p>
              </div>
              <!-- 批量模式下隐藏工具栏：里面的单条删除/导出/加载按钮与批量管理语义冲突，会让用户误以为点了能影响"已选"集合 -->
              <div v-if="!isBatchMode" class="playlist-card-toolbar">
                <button
                  v-if="!playlist.isDefault"
                  class="card-tool-btn"
                  @click.stop="exportPlaylist(playlist)"
                  title="导出"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
                </button>
                <button
                  v-if="playlist.isBiliFavorite"
                  class="card-tool-btn"
                  @click.stop="loadFavResourcesFor(playlist)"
                  :disabled="isLoadingFavResources"
                  title="加载收藏夹内容"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M19 8l-4 4h3c0 3.31-2.69 6-6 6-1.01 0-1.97-.25-2.8-.7l-1.46 1.46C8.97 19.54 10.43 20 12 20c4.42 0 8-3.58 8-8h3l-4-4zM6 12c0-3.31 2.69-6 6-6 1.01 0 1.97.25 2.8.7l1.46-1.46C15.03 4.46 13.57 4 12 4c-4.42 0-8 3.58-8 8H1l4 4 4-4H6z"/></svg>
                </button>
                <button
                  v-if="!playlist.isDefault"
                  class="card-tool-btn danger"
                  @click.stop="confirmDeletePlaylist(playlist)"
                  title="删除"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1-1H5v2h14V4z"/></svg>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- 歌单详情 -->
        <div v-else>
          <button @click="backToPlaylistList" class="back-link">
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
            <span>返回歌单列表</span>
          </button>
        <div class="playlist-header">
          <div
            class="playlist-cover"
            :class="{ 'is-clickable': currentPlaylist?.music && currentPlaylist.music.length > 0 }"
            :title="currentPlaylist?.music && currentPlaylist.music.length > 0 ? '点击一键播放整个歌单' : ''"
            @click="playPlaylistAll(currentPlaylist)"
          >
            <img
              :src="currentPlaylist?.cover || 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=400'"
              :alt="currentPlaylist?.name"
              @error="$event.target.src='https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=400'"
            />
            <div class="playlist-cover-overlay">
              <svg viewBox="0 0 24 24" fill="currentColor" width="32" height="32">
                <path d="M8 5v14l11-7z"/>
              </svg>
            </div>
          </div>
          <div class="playlist-meta">
            <span class="playlist-label">歌单</span>
            <h2 class="playlist-name">{{ currentPlaylist?.name }}</h2>
            <div class="playlist-stats">
              <span>{{ currentPlaylist?.music?.length || currentPlaylist?.media_count || 0 }} 首音乐</span>
              <span v-if="currentPlaylist?.isBiliFavorite" class="playlist-tag">B 站收藏夹</span>
            </div>
            <div class="playlist-actions" v-if="!currentPlaylist?.id || currentPlaylist?.music">
              <!-- 批量管理模式工具栏 -->
              <template v-if="isTrackBatchMode">
                <span class="batch-mode-hint">
                  已选 {{ selectedTrackKeys.size }} / {{ currentPlaylist?.music?.length || 0 }} 首
                </span>
                <button
                  @click="isAllTracksSelected() ? (selectedTrackKeys = new Set()) : selectAllTracks()"
                  class="playlist-action-btn"
                  :title="isAllTracksSelected() ? '取消全选' : '全选所有歌曲'"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>
                  <span>{{ isAllTracksSelected() ? '取消全选' : '全选' }}</span>
                </button>
                <button @click="exitTrackBatchMode" class="playlist-action-btn" title="退出批量模式">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                  <span>取消</span>
                </button>
                <button
                  @click="confirmBatchDeleteTracks"
                  class="playlist-action-btn danger"
                  :disabled="selectedTrackKeys.size === 0"
                  :title="selectedTrackKeys.size === 0 ? '请先选择要删除的歌曲' : '批量删除所选歌曲'"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1-1H5v2h14V4z"/></svg>
                  <span>批量删除{{ selectedTrackKeys.size > 0 ? ` (${selectedTrackKeys.size})` : '' }}</span>
                </button>
              </template>
              <!-- 正常模式工具栏 -->
              <template v-else>
                <button
                  v-if="currentPlaylist?.music && currentPlaylist.music.length > 0"
                  @click="playPlaylistAll(currentPlaylist)"
                  class="playlist-action-btn primary"
                  title="一键播放整个歌单"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M8 5v14l11-7z"/></svg>
                  <span>播放</span>
                </button>
                <button @click="exportPlaylist(currentPlaylist)" class="playlist-action-btn" title="导出歌单">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
                  <span>导出</span>
                </button>
                <button
                  v-if="currentPlaylist?.isBiliFavorite"
                  @click="loadFavResources"
                  class="playlist-action-btn"
                  :disabled="isLoadingFavResources"
                  title="加载收藏夹内的视频"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M19 8l-4 4h3c0 3.31-2.69 6-6 6-1.01 0-1.97-.25-2.8-.7l-1.46 1.46C8.97 19.54 10.43 20 12 20c4.42 0 8-3.58 8-8h3l-4-4zM6 12c0-3.31 2.69-6 6-6 1.01 0 1.97.25 2.8.7l1.46-1.46C15.03 4.46 13.57 4 12 4c-4.42 0-8 3.58-8 8H1l4 4 4-4H6z"/></svg>
                  <span v-if="isLoadingFavResources">
                    {{ favSyncProgress.stage === 'ids' ? '正在拉取清单' : `加载中 ${favSyncProgress.loaded}/${currentPlaylist?.media_count || favSyncProgress.loaded}` }}
                  </span>
                  <span v-else>加载视频</span>
                </button>
                <button
                  v-if="currentPlaylist?.music && currentPlaylist.music.length > 0"
                  @click="enterTrackBatchMode"
                  class="playlist-action-btn"
                  title="批量管理歌曲"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M3 5h2v2H3V5zm4 0h14v2H7V5zM3 11h2v2H3v-2zm4 0h14v2H7v-2zM3 17h2v2H3v-2zm4 0h14v2H7v-2z"/></svg>
                  <span>批量管理</span>
                </button>
                <button
                  v-if="!currentPlaylist?.isDefault"
                  @click="confirmDeletePlaylist(currentPlaylist)"
                  class="playlist-action-btn danger"
                  title="删除歌单（仅本地）"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1-1H5v2h14V4z"/></svg>
                  <span>删除</span>
                </button>
              </template>
            </div>
          </div>
        </div>

        <div class="track-list" v-if="currentPlaylist?.music && currentPlaylist.music.length > 0">
          <div class="track-list-header" :class="{ 'is-batch-mode': isTrackBatchMode }">
            <span class="col-index">#</span>
            <span class="col-title">标题</span>
            <span class="col-actions"></span>
            <span class="col-duration">时长</span>
          </div>
          <div
            v-for="(music, index) in currentPlaylist?.music"
            :key="getTrackKey(music, index)"
            class="track-row"
            :class="{
              'is-track-batch': isTrackBatchMode,
              'is-track-selected': isTrackBatchMode && isTrackSelected(music, index)
            }"
            :style="{ '--track-index': index }"
            @click="isTrackBatchMode ? toggleTrackSelection(music, index) : playMusic(music)"
          >
            <div class="col-index">
              <span class="track-index">{{ index + 1 }}</span>
              <svg class="track-play-icon" viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                <path d="M8 5v14l11-7z"/>
              </svg>
            </div>
            <div class="col-title">
              <img
                :src="music.cover"
                :alt="music.title"
                class="track-cover"
                @error="$event.target.src='https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=100'"
              />
              <div class="track-text">
                <h4>{{ music.title }}</h4>
                <p>{{ music.author }}</p>
              </div>
            </div>
            <div class="col-actions">
              <button
                v-if="!isTrackBatchMode"
                class="track-action-btn"
                @click.stop="downloadMusic(music)"
                title="下载"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
              </button>
              <button
                v-if="!isTrackBatchMode"
                class="track-action-btn track-action-btn--delete"
                @click.stop="confirmDeleteTrack(music)"
                title="从歌单中删除"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1-1H5v2h14V4z"/></svg>
              </button>
              <span
                v-if="isTrackBatchMode"
                class="track-row-checkbox"
                :class="{ checked: isTrackSelected(music, index) }"
                @click.stop="toggleTrackSelection(music, index)"
              >
                <svg v-if="isTrackSelected(music, index)" viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>
              </span>
            </div>
            <div class="col-duration">{{ parseDuration(music.duration) }}</div>
          </div>
        </div>

        <div v-else-if="currentPlaylist?.isBiliFavorite" class="playlist-empty">
          <div class="empty-icon">
            <svg viewBox="0 0 24 24" fill="currentColor" width="48" height="48">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
            </svg>
          </div>
          <p>该收藏夹内的视频尚未加载到本地歌单</p>
          <button class="load-fav-btn" :disabled="isLoadingFavResources" @click="loadFavResources">
            <template v-if="isLoadingFavResources">
              {{ favSyncProgress.stage === 'ids' ? '正在拉取清单' : `加载中 ${favSyncProgress.loaded}/${currentPlaylist?.media_count || favSyncProgress.loaded}` }}
            </template>
            <template v-else>加载该收藏夹内的视频</template>
          </button>
        </div>

        <div v-else class="playlist-empty">
          <div class="empty-icon">
            <svg viewBox="0 0 24 24" fill="currentColor" width="48" height="48">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
            </svg>
          </div>
          <p>该歌单还没有音乐</p>
        </div>
        </div>
      </section>

      <MineView v-else-if="currentView === 'mine'" key="mine" />
      </Transition>
    </main>

    <div v-if="currentTrack" class="player-bar">
      <div class="current-track">
        <button class="current-cover-btn" @click="openPlayerPageFromCover">
          <img :src="currentTrack.cover" :alt="currentTrack.title" class="current-cover" @error="$event.target.src='https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=400'">
          <div class="cover-overlay">
            <svg viewBox="0 0 24 24" fill="white" width="24" height="24"><path d="M8 5v14l11-7z"/></svg>
          </div>
        </button>
        <div class="current-info">
          <h4>{{ currentTrack.title }}</h4>
          <p>{{ currentTrack.author }}</p>
        </div>
      </div>

      <div class="player-controls">
        <div class="control-buttons">
          <button @click="togglePlayMode" class="control-btn mode-btn" :class="{ active: playMode !== 'order' }" :title="getPlayModeLabel()">
            <span class="mode-icon" v-html="getPlayModeIcon()"></span>
          </button>
          <button @click="playPrevious" class="control-btn">
            <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
          </button>
          <button @click="togglePlayPause" class="control-btn play">
            <svg v-if="isPlaying" viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
            <svg v-else viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M8 5v14l11-7z"/></svg>
          </button>
          <button @click="playNext" class="control-btn">
            <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
          </button>
        </div>

        <div class="progress-container">
          <span class="progress-time">{{ parseDuration(currentTime) }}</span>
          <div class="progress-bar-wrapper">
            <input
              type="range"
              min="0"
              :max="duration || 100"
              :value="currentTime"
              @input="onProgressInput"
              @change="onProgressChange"
              class="progress-slider"
            >
            <div class="progress-bar">
              <div class="progress-fill" :style="{ width: (duration > 0 ? (currentTime / duration) * 100 : 0) + '%' }"></div>
            </div>
          </div>
          <span class="progress-time">{{ parseDuration(duration) }}</span>
        </div>
      </div>

      <div class="player-actions">
        <button @click="openAddToPlaylistModal" class="action-btn" title="添加到歌单">
          <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
        </button>
        <button @click="togglePlaylistManager" class="action-btn" title="歌单管理">
          <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M2 15.5v2h20v-2H2zm0-5v2h20v-2H2zm0-5v2h20V5H2z"/></svg>
        </button>
      </div>
    </div>

    <!-- Playlist Manager -->
    <div v-if="showPlaylistManager" class="playlist-manager" @click="showPlaylistManager = false">
      <div class="playlist-manager-content" @click.stop>
        <div class="playlist-manager-header">
          <h3>视频分P</h3>
          <button class="close-btn" @click="showPlaylistManager = false">
            <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
        </div>

        <div v-if="isLoadingEpisodes" class="loading-episodes">
          <p>加载分P列表中...</p>
        </div>

        <div v-else class="playlist-manager-list">
          <div v-if="currentVideoEpisodes.length === 0" class="empty-list">
            <p>当前视频没有分P</p>
          </div>
          <div
            v-for="(episode, index) in currentVideoEpisodes"
            :key="episode.cid"
            class="manager-item"
            @click="playEpisode(episode)"
          >
            <div class="item-info">
              <span class="item-index">{{ index + 1 }}</span>
              <div class="item-details">
                <h4>{{ episode.part }}</h4>
              </div>
              <span class="item-duration">{{ parseDuration(episode.duration) }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <Transition name="player-zoom">
      <div
        v-if="showPlayerPage && currentTrack"
        class="player-page"
        :class="{ active: showPlayerPage, 'no-visualizer': !settingsStore.audioVisualizerEnabled }"
        @click="closePlayerPage"
      >
      <!-- 音频可视化关闭时用当前歌曲封面作全屏模糊背景（所有主题通用） -->
      <div v-if="!settingsStore.audioVisualizerEnabled" class="player-page-cover-bg" aria-hidden="true">
        <img
          class="player-page-cover-bg__img"
          :src="coverBgUrl"
          :key="coverBgUrl"
          @error="$event.target.src='https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=1200'"
        >
      </div>

      <!-- 左上角：返回 -->
      <button class="back-btn" @click.stop="closePlayerPage">
        <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
        <span>返回</span>
      </button>

      <!-- 音频频谱可视化：开关关闭时不渲染，避免空 canvas 占位 -->
      <AudioVisualizer
        v-if="settingsStore.audioVisualizerEnabled"
        :enabled="settingsStore.audioVisualizerEnabled"
      />

      <div class="player-page-content" @click.stop>
        <button v-if="currentSeries" class="series-toggle-btn" @click="toggleSeriesPanel">
          <span>📋 合集</span>
          <span class="series-count">{{ currentSeries.episodes.length }}</span>
        </button>

        <div
          class="player-page-layout"
          :class="{ 'player-page-layout--solo': !lyricStore.showLyricPanel }"
        >
          <!-- 左侧：封面 + 标题 + 进度 + 控制 -->
          <div class="player-page-left">
            <div class="album-art-zone">
              <div ref="albumArtRef" class="album-art">
                <img :src="fixCoverUrl(currentTrack.cover)" :alt="currentTrack.title" @error="$event.target.src='https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=400'">
              </div>
              <!-- 音频波纹：随低音能量从封面中心向外扩散，开关关闭时不渲染 -->
              <AlbumRipple
                v-if="settingsStore.audioVisualizerEnabled"
                :intensity="settingsStore.audioVisualizerIntensity"
              />
            </div>

            <div class="track-info">
              <h2>{{ currentTrack.title }}</h2>
              <h3>{{ currentTrack.author }}</h3>
            </div>

            <div class="big-progress">
              <div class="progress-container">
                <span class="progress-time">{{ parseDuration(currentTime) }}</span>
                <div class="progress-bar-wrapper" :class="{ seeking: isSeeking }">
                  <input
                    type="range"
                    min="0"
                    :max="duration || 100"
                    :value="currentTime"
                    @input="onProgressInput"
                    @change="onProgressChange"
                    @pointerdown="onSeekStart"
                    @pointerup="onSeekEnd"
                    @pointercancel="onSeekEnd"
                    class="progress-slider"
                  >
                  <div class="progress-bar">
                    <div class="progress-fill" :style="{ width: (duration > 0 ? (currentTime / duration) * 100 : 0) + '%' }"></div>
                    <div class="buffered-fill" :style="{ width: bufferedProgress + '%' }"></div>
                  </div>
                </div>
                <span class="progress-time">{{ parseDuration(duration) }}</span>
              </div>

              <!-- 下载缓存进度 -->
              <div v-if="isDownloading" class="download-progress">
                <div class="download-progress-bar">
                  <div class="download-progress-fill" :style="{ width: downloadProgress + '%' }"></div>
                </div>
                <span class="download-progress-text">缓存中 {{ downloadProgress }}%</span>
              </div>
            </div>

            <div class="big-control-buttons">
              <div class="big-control-row">
                <div class="big-control-side big-control-side--left">
                  <button @click="togglePlayMode" class="big-control-btn" :class="{ active: playMode !== 'order' }" :title="getPlayModeLabel()">
                    <span class="mode-icon" v-html="getPlayModeIcon()"></span>
                  </button>
                  <button @click="playPrevious" class="big-control-btn">
                    <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
                  </button>
                </div>
                <button @click="togglePlayPause" class="big-control-btn play">
                  <svg v-if="isPlaying" viewBox="0 0 24 24" fill="currentColor" width="32" height="32"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                  <svg v-else viewBox="0 0 24 24" fill="currentColor" width="32" height="32"><path d="M8 5v14l11-7z"/></svg>
                </button>
                <div class="big-control-side big-control-side--right">
                  <button @click="playNext" class="big-control-btn">
                    <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
                  </button>
                  <!-- 显示/隐藏歌词：放在控制按钮行最右侧 -->
                  <button
                    class="big-control-btn lyric-toggle-btn-inline"
                    :class="{ active: lyricStore.showLyricPanel }"
                    :title="lyricStore.showLyricPanel ? '隐藏歌词' : '显示歌词'"
                    :aria-label="lyricStore.showLyricPanel ? '隐藏歌词' : '显示歌词'"
                    :aria-pressed="lyricStore.showLyricPanel"
                    @click="toggleLyricPanel"
                  >
                    <span class="lyric-toggle-char" aria-hidden="true">词</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- 右侧：歌词 -->
          <div v-if="lyricStore.showLyricPanel" class="player-page-right">
            <LyricDisplay
              :currentTime="currentTime"
              :onSeek="handleLyricSeek"
              :large="true"
            />
          </div>
        </div>

        <div v-if="showSeriesPanel && currentSeries" class="series-panel">
          <div class="series-header">
            <h3>{{ currentSeries.title }}</h3>
            <button class="close-series-btn" @click="toggleSeriesPanel">×</button>
          </div>
          <div class="series-list">
            <div
              v-for="(episode, index) in currentSeries.episodes"
              :key="episode.bvid"
              class="series-item"
              :class="{ active: episode.bvid === currentTrack?.bvid }"
              @click="playFromSeries(episode)"
            >
              <span class="series-index">{{ index + 1 }}</span>
              <span class="series-title">{{ episode.title || '第' + (index + 1) + '集' }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
    </Transition>

    <!-- 旧版 showThemePanel 主题面板已迁移到 MineView 设置 tab -->

    <div v-if="showCreatePlaylistModal" class="modal-overlay" @click="cancelCreatePlaylist">
      <div class="modal" @click.stop>
        <h2>创建歌单</h2>
        <div class="form-group">
          <label for="playlist-name">歌单名称</label>
          <input
            type="text"
            id="playlist-name"
            v-model="newPlaylistName"
            placeholder="请输入歌单名称"
            @keyup.enter="confirmCreatePlaylist"
          >
        </div>
        <div class="modal-buttons">
          <button class="modal-btn cancel" @click="cancelCreatePlaylist">
            取消
          </button>
          <button class="modal-btn confirm" @click="confirmCreatePlaylist">
            创建
          </button>
        </div>
      </div>
    </div>

    <div v-if="showAddToPlaylistModal" class="modal-overlay" @click="showAddToPlaylistModal = false">
      <div class="modal" @click.stop>
        <h2>添加到歌单</h2>
        <div class="playlist-list-modal">
          <div
            v-for="playlist in playlistStore.userPlaylists"
            :key="playlist.id"
            class="playlist-modal-item"
            @click="addToPlaylist(playlist)"
          >
            <span>{{ playlist.name }}</span>
            <span class="playlist-count">{{ playlist.music.length }} 首</span>
          </div>
          <div v-if="playlistStore.userPlaylists.length === 0" class="empty-list">
            <p>暂无歌单，请先创建</p>
          </div>
        </div>
        <div class="modal-buttons">
          <button class="modal-btn cancel" @click="showAddToPlaylistModal = false">
            关闭
          </button>
        </div>
      </div>
    </div>

    <!-- 设置面板已迁移至 MineView 中 -->

    <DownloadManager />

    <LoginPanel
      :visible="showLoginPanel"
      @update:visible="(val) => showLoginPanel = val"
      @login-success="handleLoginSuccess"
      @sync-favorites="handleSyncFavorites"
    />

    <AppDock />
  </div>
</template>