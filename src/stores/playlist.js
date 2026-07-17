import { defineStore } from 'pinia'

export const usePlaylistStore = defineStore('playlist', {
  state: () => ({
    userPlaylists: JSON.parse(localStorage.getItem('pink-music-playlists') || '[]'),
    currentPlaylist: null,
    currentView: 'home',
    showCreatePlaylistModal: false,
    showAddToPlaylistModal: false,
    showPlaylistManager: false
  }),
  actions: {
    setCurrentView(view) {
      this.currentView = view
    },
    setCurrentPlaylist(playlist) {
      this.currentPlaylist = playlist
    },
    setShowCreatePlaylistModal(show) {
      this.showCreatePlaylistModal = show
    },
    setShowAddToPlaylistModal(show) {
      this.showAddToPlaylistModal = show
    },
    setShowPlaylistManager(show) {
      this.showPlaylistManager = show
    },
    savePlaylists() {
      localStorage.setItem('pink-music-playlists', JSON.stringify(this.userPlaylists))
    },
    loadPlaylists() {
      const saved = localStorage.getItem('pink-music-playlists')
      if (saved) {
        this.userPlaylists = JSON.parse(saved)
      }
      const favoritesExists = this.userPlaylists.some(p => p.id === 'favorites')
      if (!favoritesExists) {
        this.userPlaylists.unshift({
          id: 'favorites',
          name: '收藏夹',
          music: [],
          isDefault: true
        })
        this.savePlaylists()
      }
    },
    addToPlaylist(playlistId, music) {
      const playlist = this.userPlaylists.find(p => p.id === playlistId)
      if (!playlist) return
      if (!playlist.music) playlist.music = []
      const exists = playlist.music.some(m => m.bvid === music.bvid && m.cid === music.cid)
      if (!exists) {
        playlist.music.push(music)
        this.savePlaylists()
      }
    },
    /**
     * 删除歌单（仅本地）
     * - 默认收藏夹（isDefault）不可删
     * - B 站同步的收藏夹（isBiliFavorite）可以删，但**只删本地副本**，不影响 B 站云端
     * 返回是否真的删了
     */
    deletePlaylist(playlistId) {
      const index = this.userPlaylists.findIndex(p => p.id === playlistId)
      if (index < 0) return false
      const target = this.userPlaylists[index]
      if (target.isDefault) return false
      this.userPlaylists.splice(index, 1)
      this.savePlaylists()
      return true
    },
    /**
     * 批量删除歌单：默认收藏夹会被自动跳过，B 站收藏夹允许删除（仅本地副本）
     * @param {string[]} playlistIds
     * @returns {{ deleted: number, skipped: number, deletedIds: string[] }}
     */
    batchDeletePlaylists(playlistIds) {
      if (!Array.isArray(playlistIds) || playlistIds.length === 0) {
        return { deleted: 0, skipped: 0, deletedIds: [] }
      }
      const idSet = new Set(playlistIds)
      const deletedIds = []
      let skipped = 0
      this.userPlaylists = this.userPlaylists.filter(p => {
        if (!idSet.has(p.id)) return true
        if (p.isDefault) { skipped++; return true }
        deletedIds.push(p.id)
        return false
      })
      if (deletedIds.length > 0) this.savePlaylists()
      return { deleted: deletedIds.length, skipped, deletedIds }
    },
    mergeBiliFavorites(favorites) {
      if (!Array.isArray(favorites) || favorites.length === 0) return 0
      let added = 0
      favorites.forEach(fav => {
        if (!fav || !fav.id) return
        const localId = `bili-fav-${fav.id}`
        const existing = this.userPlaylists.find(p => p.id === localId)
        const cover = fav.cover && (fav.cover.startsWith('//') ? `https:${fav.cover}` : fav.cover)
        if (existing) {
          existing.name = fav.title || existing.name
          existing.cover = cover || existing.cover
          existing.media_count = fav.media_count ?? existing.media_count
          existing.isBiliFavorite = true
          existing.source = fav.source || existing.source
        } else {
          this.userPlaylists.push({
            id: localId,
            name: fav.title || 'B 站收藏夹',
            cover: cover || '',
            media_count: fav.media_count || 0,
            music: [],
            isBiliFavorite: true,
            source: fav.source || 'created'
          })
          added++
        }
      })
      this.savePlaylists()
      return added
    }
  }
})
