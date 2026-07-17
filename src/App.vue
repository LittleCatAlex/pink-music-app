<script setup>
import { ref, onMounted, onUnmounted, computed, watch, nextTick } from 'vue'
import { parseDuration, formatPlayCount, fixCoverUrl } from './utils/bilibili.js'
import { selectAudioUrl, selectAudioInfo } from './utils/audio.js'
import WindowControls from './components/WindowControls.vue'
import AppDock from './components/AppDock.vue'
import MineView from './components/MineView.vue'
import LyricDisplay from './components/player/LyricDisplay.vue'
import { useLyricStore, usePlayerStore, useSettingsStore, useDownloadStore, useUserStore, usePlaylistStore } from './stores'
import DownloadManager from './components/DownloadManager.vue'
import LoginPanel from './components/LoginPanel.vue'
import { applyLiquidGlass, destroyLiquidGlass } from './composables/useLiquidGlass'
import { appConfirm } from './utils/confirm'

const topbarRef = ref(null)
const playerBarRef = ref(null)
const liquidGlassInstances = new Map()

const lyricStore = useLyricStore()
const playerStore = usePlayerStore()
const settingsStore = useSettingsStore()
const downloadStore = useDownloadStore()
const userStore = useUserStore()
const playlistStore = usePlaylistStore()

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

const currentTheme = ref(localStorage.getItem('pink-music-theme') || 'dark')
const currentColor = ref(localStorage.getItem('pink-music-color') || 'pink')
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
const isPlaying = ref(false)
const showPlayerPage = ref(false)
const audioElement = ref(null)
const currentTime = ref(0)
const duration = ref(0)
const isSeeking = ref(false)
function onSeekStart() { isSeeking.value = true }
function onSeekEnd() { isSeeking.value = false }
const showThemePanel = ref(false)
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
const playModes = [
  { value: 'order', icon: '🔁', label: '顺序播放' },
  { value: 'loop', icon: '🔃', label: '列表循环' },
  { value: 'single', icon: '🔂', label: '单曲循环' },
  { value: 'shuffle', icon: '🔀', label: '随机播放' }
]

const colorOptions = [
  { value: 'pink', label: '粉色' },
  { value: 'purple', label: '紫色' },
  { value: 'blue', label: '蓝色' },
  { value: 'green', label: '绿色' },
  { value: 'orange', label: '橙色' }
]

function toggleTheme() {
  showThemePanel.value = !showThemePanel.value
}

function setTheme(mode) {
  currentTheme.value = mode
  localStorage.setItem('pink-music-theme', mode)
  document.documentElement.setAttribute('data-theme', mode)
  showThemePanel.value = false
}

function setColor(color) {
  currentColor.value = color
  localStorage.setItem('pink-music-color', color)
  document.documentElement.setAttribute('data-color', color)
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
    if (added === 0) {
      const detail = userStore._lastFavError || '请稍后重试'
      alert(`未拉取到新视频（${detail}）。可尝试重新登录 B 站后再试。`)
    } else {
      // 同步刷新 currentPlaylist 引用，让视图立即看到新歌曲
      currentPlaylist.value = playlistStore.userPlaylists.find(p => p.id === currentPlaylist.value.id) || currentPlaylist.value
    }
  } catch (error) {
    console.error('加载收藏夹内容失败:', error)
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

function selectAllDeletablePlaylists() {
  const next = new Set()
  for (const p of playlistStore.userPlaylists) {
    if (!p.isDefault) next.add(p.id)
  }
  selectedPlaylistIds.value = next
}

function isPlaylistSelected(playlist) {
  return !!playlist && selectedPlaylistIds.value.has(playlist.id)
}

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
  if (newPlaylistName.value.trim()) {
    const newId = Date.now()
    playlistStore.userPlaylists.push({
      id: newId,
      name: newPlaylistName.value.trim(),
      music: []
    })
    playlistStore.savePlaylists()
    showCreatePlaylistModal.value = false
  }
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
          const newPlaylist = {
            id: Date.now(),
            name: imported.name,
            cover: imported.cover || '',
            music: imported.music
          }
          playlistStore.userPlaylists.push(newPlaylist)
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

onMounted(async () => {
  document.documentElement.setAttribute('data-theme', currentTheme.value)
  document.documentElement.setAttribute('data-color', currentColor.value)
  loadPlaylists()
  loadRecommendedMusic()
  setupMediaSessionHandlers()
  downloadStore.loadTasks()
  downloadStore.registerProgressListener()
  window.addEventListener('pink-music:play-track', handlePinkMusicEvent)
  window.addEventListener('pink-music:open-download', handlePinkMusicEvent)
  window.addEventListener('pink-music:open-login', handlePinkMusicEvent)
  window.addEventListener('pink-music:playlist-deleted', handlePinkMusicEvent)
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
})

onUnmounted(() => {
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
        <button class="topbar-btn" @click="toggleTheme" title="主题设置">
          <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18" v-if="currentTheme === 'dark'">
            <path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"/>
          </svg>
          <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18" v-else>
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
                  @click="selectAllDeletablePlaylists"
                  class="playlist-action-btn"
                  title="选中所有可删除的歌单（默认收藏夹除外）"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>
                  <span>全选</span>
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
              <div class="playlist-card-toolbar">
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
                v-if="!currentPlaylist?.isDefault"
                @click="confirmDeletePlaylist(currentPlaylist)"
                class="playlist-action-btn danger"
                title="删除歌单（仅本地）"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1-1H5v2h14V4z"/></svg>
                <span>删除</span>
              </button>
            </div>
          </div>
        </div>

        <div class="track-list" v-if="currentPlaylist?.music && currentPlaylist.music.length > 0">
          <div class="track-list-header">
            <span class="col-index">#</span>
            <span class="col-title">标题</span>
            <span class="col-actions"></span>
            <span class="col-duration">时长</span>
          </div>
          <div
            v-for="(music, index) in currentPlaylist?.music"
            :key="(music.bvid || '') + ':' + (music.favId ?? index) + ':' + (music.favType ?? '')"
            class="track-row"
            :style="{ '--track-index': index }"
            @click="playMusic(music)"
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
              <button class="track-action-btn" @click.stop="downloadMusic(music)" title="下载">
                <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
              </button>
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
            <span class="mode-icon">{{ getPlayModeIcon() }}</span>
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

    <div v-if="showPlayerPage && currentTrack" class="player-page" :class="{ active: showPlayerPage }" @click="closePlayerPage">
      <!-- 左上角：返回 -->
      <button class="back-btn" @click.stop="closePlayerPage">
        <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
        <span>返回</span>
      </button>

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
            <div ref="albumArtRef" class="album-art">
              <img :src="fixCoverUrl(currentTrack.cover)" :alt="currentTrack.title" @error="$event.target.src='https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=400'">
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
                    <span class="mode-icon">{{ getPlayModeIcon() }}</span>
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

    <div v-if="showThemePanel" class="theme-panel">
      <h3>选择主题颜色</h3>
      <div class="theme-colors">
        <button
          v-for="color in colorOptions"
          :key="color.value"
          class="theme-color-btn"
          :class="['color-' + color.value, { active: currentColor === color.value }]"
          @click="setColor(color.value)"
          :title="color.label"
        ></button>
      </div>

      <h3>选择模式</h3>
      <div class="theme-modes">
        <button
          class="theme-mode-btn"
          :class="{ active: currentTheme.value === 'dark' }"
          @click="setTheme('dark')"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-.46-.04-.92-.1-1.36-.98 1.37-2.58 2.26-4.4 2.26-2.98 0-5.4-2.42-5.4-5.4 0-1.81.89-3.42 2.26-4.4-.44-.06-.9-.1-1.36-.1z"/></svg>
          深色
        </button>
        <button
          class="theme-mode-btn"
          :class="{ active: currentTheme.value === 'light' }"
          @click="setTheme('light')"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M6.76 4.84l-1.8-1.79-1.41 1.41 1.79 1.79 1.42-1.41zM4 10.5H1v2h3v-2zm9-9.95h-2V3.5h2V.55zm7.45 3.91l-1.41-1.41-1.79 1.79 1.41 1.41 1.79-1.79zm-3.21 13.7l1.79 1.8 1.41-1.41-1.8-1.79-1.4 1.4zM20 10.5v2h3v-2h-3zm-8-5c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm-1 16.95h2V19.5h-2v2.95zm-7.45-3.91l1.41 1.41 1.79-1.8-1.41-1.41-1.79 1.8z"/></svg>
          浅色
        </button>
      </div>
    </div>

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