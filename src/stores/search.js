import { defineStore } from 'pinia'

export const useSearchStore = defineStore('search', {
  state: () => ({
    searchQuery: '',
    isSearching: false,
    searchResults: [],
    isLoadingSearch: false,
    recommendedMusic: [],
    isLoadingRecommended: false
  }),
  actions: {
    setSearchQuery(query) {
      this.searchQuery = query
    },
    setIsSearching(searching) {
      this.isSearching = searching
    },
    setSearchResults(results) {
      this.searchResults = results
    },
    setIsLoadingSearch(loading) {
      this.isLoadingSearch = loading
    },
    setRecommendedMusic(music) {
      this.recommendedMusic = music
    },
    setIsLoadingRecommended(loading) {
      this.isLoadingRecommended = loading
    }
  }
})
