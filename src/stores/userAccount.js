import { defineStore } from 'pinia'

export const useUserAccountStore = defineStore('userAccount', {
  state: () => ({
    user: null
  }),
  actions: {
    updateUser(user) {
      this.user = user
    },
    clear() {
      this.user = null
    }
  },
  persist: {
    key: 'user'
  }
})
