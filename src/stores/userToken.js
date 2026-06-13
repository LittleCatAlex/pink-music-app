import { defineStore } from 'pinia'
import moment from 'moment'

export const useUserTokenStore = defineStore('userToken', {
  state: () => ({
    tokenData: {},
    nextCheckRefreshTime: moment().unix()
  }),
  actions: {
    updateToken(info) {
      Object.assign(this, info)
    },
    clear() {
      this.tokenData = undefined
      this.nextCheckRefreshTime = undefined
    }
  },
  persist: {
    key: 'user-token',
    paths: ['tokenData', 'nextCheckRefreshTime']
  }
})
