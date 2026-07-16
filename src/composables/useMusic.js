import { useSearchStore, usePlaylistStore } from '@/stores'
import { stripHtmlTags, fixCoverUrl } from '@/utils/bilibili'

export function useMusic() {
  const searchStore = useSearchStore()
  const playlistStore = usePlaylistStore()

  async function loadRecommendedMusic() {
    searchStore.setIsLoadingRecommended(true)

    try {
      let feedResult
      if (window.electronAPI?.getMusicRegionFeed) {
        // 走 B 站音乐区推荐（tid=1003），避免全站搜索返回擦边视频
        // 参考 biu-master 的 getRegionFeedRcmd
        const r = await window.electronAPI.getMusicRegionFeed(1, 20)
        feedResult = r
        console.log('[debug] loadRecommendedMusic 音乐区返回 archives:', r?.data?.archives?.length)
      } else {
        feedResult = { code: -1, message: 'Not available in web mode' }
      }

      if (feedResult.code === 0 && feedResult.data?.archives?.length) {
        const archives = feedResult.data.archives
        const musicList = archives.map((item) => ({
          bvid: item.bvid,
          aid: item.aid,
          title: stripHtmlTags(item.title || ''),
          author: item.author?.name || '',
          cover: fixCoverUrl(item.cover),
          duration: item.duration || 180,
          playCount: item.stat?.view || 0,
          pubdate: item.pubdate,
          rec_reason: item.rec_reason || ''
        }))

        const shuffledMusic = [...musicList].sort(() => 0.5 - Math.random())
        searchStore.setRecommendedMusic(shuffledMusic)
      } else {
        searchStore.setRecommendedMusic([])
      }
    } catch (error) {
      console.error('加载推荐音乐失败:', error)
      searchStore.setRecommendedMusic([])
    } finally {
      searchStore.setIsLoadingRecommended(false)
    }
  }

  async function handleSearch() {
    if (!searchStore.searchQuery.trim()) return
    searchStore.setIsSearching(true)
    searchStore.setIsLoadingSearch(true)
    playlistStore.setCurrentView('search')
    try {
      let searchResult
      if (window.electronAPI) {
        console.log('开始搜索:', searchStore.searchQuery)
        searchResult = await window.electronAPI.searchMusic(searchStore.searchQuery, 1, 30)
        console.log('搜索结果:', searchResult)
      } else {
        searchResult = { code: -1, message: 'Not available' }
      }

      if (searchResult.code === 0 && searchResult.data?.result) {
        const videoResult = searchResult.data.result.find(item => item.result_type === 'video')
        if (videoResult && videoResult.data?.length > 0) {
          searchStore.setSearchResults(videoResult.data.map((item, index) => ({
            bvid: item.bvid,
            aid: item.aid,
            title: stripHtmlTags(item.title),
            author: stripHtmlTags(item.author),
            cover: fixCoverUrl(item.pic),
            duration: typeof item.duration === 'string' ? parseDuration(item.duration) : item.duration || 180,
            playCount: item.play || 0,
            pubdate: item.pubdate
          })))
        } else {
          searchStore.setSearchResults([])
        }
      } else {
        searchStore.setSearchResults([])
      }
    } catch (error) {
      console.error('搜索音乐失败:', error)
      searchStore.setSearchResults([])
    } finally {
      searchStore.setIsLoadingSearch(false)
    }
  }

  return {
    loadRecommendedMusic,
    handleSearch
  }
}

function parseDuration(duration) {
  if (typeof duration === 'number') return duration
  if (!duration) return 180
  const parts = duration.split(':')
  if (parts.length === 2) {
    return parseInt(parts[0]) * 60 + parseInt(parts[1])
  } else if (parts.length === 3) {
    return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2])
  }
  return 180
}
