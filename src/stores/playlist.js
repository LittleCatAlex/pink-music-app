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
    deletePlaylist(playlistId) {
      const index = this.userPlaylists.findIndex(p => p.id === playlistId)
      if (index > -1 && !this.userPlaylists[index].isDefault) {
        this.userPlaylists.splice(index, 1)
        this.savePlaylists()
      }
    }
  }
})
