const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  searchMusic: (keyword, page, pageSize) => ipcRenderer.invoke('search-music', keyword, page, pageSize),
  getMusicRegionFeed: (displayId, requestCnt) => ipcRenderer.invoke('get-music-region-feed', displayId, requestCnt),
  getMusicComprehensiveWebRank: (pn, ps) => ipcRenderer.invoke('get-music-comprehensive-web-rank', pn, ps),
  getMusicInfo: (bvid) => ipcRenderer.invoke('get-music-info', bvid),
  getMusicPlayUrl: (bvid, cid) => ipcRenderer.invoke('get-music-play-url', bvid, cid),
  getVideoEpisodes: (bvid) => ipcRenderer.invoke('get-video-episodes', bvid),
  proxyAudio: (audioUrl) => ipcRenderer.invoke('proxy-audio', audioUrl),

  getRecommendations: () => ipcRenderer.invoke('get-recommendations'),
  getVideoSeries: (bvid) => ipcRenderer.invoke('get-video-series', bvid),
  downloadAudio: (taskInfo) => ipcRenderer.invoke('download-audio', taskInfo),
  getDownloadTasks: () => ipcRenderer.invoke('get-download-tasks'),
  clearDownloadTasks: () => ipcRenderer.invoke('clear-download-tasks'),
  onDownloadProgress: (callback) => {
    const listener = (event, task) => callback(task)
    ipcRenderer.on('download-progress', listener)
    return () => ipcRenderer.removeListener('download-progress', listener)
  },
  openDownloadFolder: () => ipcRenderer.invoke('open-download-folder'),

  // 设置相关 API
  getCacheSize: () => ipcRenderer.invoke('get-cache-size'),
  clearCache: () => ipcRenderer.invoke('clear-cache'),
  selectDownloadDirectory: () => ipcRenderer.invoke('select-download-directory'),
  getDownloadDirectory: () => ipcRenderer.invoke('get-download-directory'),
  setDownloadDirectory: (dirPath) => ipcRenderer.invoke('set-download-directory', dirPath),
  openGitHub: () => ipcRenderer.invoke('open-github'),

  // 窗口控制 API
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  maximizeWindow: () => ipcRenderer.invoke('maximize-window'),
  closeWindow: () => ipcRenderer.invoke('close-window'),
  isWindowMaximized: () => ipcRenderer.invoke('is-window-maximized'),
  getPlatform: () => ipcRenderer.invoke('get-platform'),

  // 歌词相关 API
  getLyric: (params) => ipcRenderer.invoke('get-lyric', params),
  searchLyric: (keyword) => ipcRenderer.invoke('search-lyric', keyword),
  getLyricById: (songId) => ipcRenderer.invoke('get-lyric-by-id', songId),

  // 登录与收藏夹同步 API
  generateQrcode: () => ipcRenderer.invoke('generate-qrcode'),
  pollQrcode: (qrcodeKey) => ipcRenderer.invoke('poll-qrcode', qrcodeKey),
  getUserInfo: () => ipcRenderer.invoke('get-user-info'),
  getFavFolderCreatedList: (upMid, pn, ps) => ipcRenderer.invoke('get-fav-folder-created-list', upMid, pn, ps),
  getFavFolderCollectedList: (upMid, pn, ps) => ipcRenderer.invoke('get-fav-folder-collected-list', upMid, pn, ps),
  getFavResourceList: (mediaId, pn, ps) => ipcRenderer.invoke('get-fav-resource-list', mediaId, pn, ps),
  getFavResourceIds: (mediaId) => ipcRenderer.invoke('get-fav-resource-ids', mediaId),
  getFavResourceInfos: (resources) => ipcRenderer.invoke('get-fav-resource-infos', resources),
  showMessageBox: (options) => ipcRenderer.invoke('dialog-message-box', options),
  getBilibiliCookies: () => ipcRenderer.invoke('get-bilibili-cookies'),
  logoutBilibili: () => ipcRenderer.invoke('logout-bilibili')
});

contextBridge.exposeInMainWorld('electronPlayer', {
  seekToTime: (time) => ipcRenderer.invoke('seek-to-time', time)
});
