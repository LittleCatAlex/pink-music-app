import { ref, computed } from 'vue'

export const SUPPORTED_LANGUAGES = [
  { code: 'zh-TW', label: '繁體中文', shortLabel: '繁' },
  { code: 'zh-CN', label: '简体中文', shortLabel: '简' },
  { code: 'en-US', label: 'English', shortLabel: 'EN' }
]

export const currentLanguage = ref('zh-TW')

export function setLanguage(lang) {
  if (['zh-TW', 'zh-CN', 'en-US'].includes(lang)) {
    currentLanguage.value = lang
  }
}

export const messages = {
  'zh-TW': {
    // Topbar & Navigation
    'brand.name': 'Pink Music',
    'nav.home': '發現',
    'nav.discover': '發現',
    'nav.rank': '榜單',
    'nav.library': '我的',
    'nav.local': '本地音樂',
    'nav.playlists': '歌單',
    'nav.downloads': '下載管理',
    'nav.settings': '設定',
    'topbar.themeDark': '切換到深色模式',
    'topbar.themeLight': '切換到淺色模式',
    'topbar.langSwitch': '切換語言',
    'topbar.loginBili': '登入 B 站',
    'topbar.loggedIn': '已登入',
    'topbar.searchPlaceholder': '搜尋音樂、歌手、BVID...',
    'topbar.search': '搜尋',

    // Hero & Home
    'home.heroTitle': '歡迎使用 Pink Music',
    'home.heroSubtitle': '從 B 站發現並播放你喜歡的音樂',
    'home.recommendedMusic': '推薦音樂',
    'home.refreshRecommend': '刷新推薦',
    'home.loading': '載入中...',

    // Player
    'player.noTrack': '暫無播放歌曲',
    'player.play': '播放',
    'player.pause': '暫停',
    'player.prev': '上一首',
    'player.next': '下一首',
    'player.queue': '播放佇列',
    'player.volume': '音量',
    'player.desktopLyrics': '桌面歌詞',
    'player.mode.repeatAll': '列表循環',
    'player.mode.repeatOne': '單曲循環',
    'player.mode.shuffle': '隨機播放',
    'player.mode.sequential': '順序播放',

    // Lyrics
    'lyrics.empty': '暫無歌詞',
    'lyrics.instrumental': '純音樂，請欣賞',
    'lyrics.search': '搜尋歌詞',
    'lyrics.source': '歌詞來源',
    'lyrics.source.bilibili': '嗶哩嗶哩 CC 字幕',
    'lyrics.source.kugou': '酷狗音樂',
    'lyrics.source.netease': '網易雲音樂',
    'lyrics.source.manual': '手動選擇',
    'lyrics.source.local': '本地 LRC',
    'lyrics.t2s': '繁簡轉換',

    // Settings
    'settings.title': '應用設定',
    'settings.language': '介面語言',
    'settings.langSelect': '選擇語言',
    'settings.audio': '音訊設定',
    'settings.audioQuality': '音質偏好',
    'settings.audioQuality.auto': '自動（依網路）',
    'settings.audioQuality.lossless': '無損 Hi-Res',
    'settings.audioQuality.high': '極高音質',
    'settings.audioQuality.medium': '標準音質',
    'settings.audioQuality.low': '省流音質',
    'settings.lyricSource': '預設歌詞源',
    'settings.visualizer': '音訊視覺化',
    'settings.eq': '等化器',
    'settings.about': '關於與更新',
    'settings.version': '目前版本',
    'settings.checkUpdate': '檢查更新',
    'settings.checkingUpdate': '檢查更新中...',
    'settings.upToDate': '目前已是最新版本',
    'settings.githubRepo': '開源專案主頁',
    'settings.clearCache': '清除快取',
    'settings.logout': '登出 B 站帳號',
    'settings.confirmLogout': '確定要登出當前帳號嗎？',

    // General / Modals
    'common.confirm': '確定',
    'common.cancel': '取消',
    'common.close': '關閉',
    'common.save': '儲存',
    'common.delete': '刪除',
    'common.retry': '重試',
    'common.success': '操作成功',
    'common.error': '操作失敗'
  },
  'zh-CN': {
    // Topbar & Navigation
    'brand.name': 'Pink Music',
    'nav.home': '发现',
    'nav.discover': '发现',
    'nav.rank': '榜单',
    'nav.library': '我的',
    'nav.local': '本地音乐',
    'nav.playlists': '歌单',
    'nav.downloads': '下载管理',
    'nav.settings': '设置',
    'topbar.themeDark': '切换到深色模式',
    'topbar.themeLight': '切换到浅色模式',
    'topbar.langSwitch': '切换语言',
    'topbar.loginBili': '登录 B 站',
    'topbar.loggedIn': '已登录',
    'topbar.searchPlaceholder': '搜索音乐、歌手、BVID...',
    'topbar.search': '搜索',

    // Hero & Home
    'home.heroTitle': '欢迎使用 Pink Music',
    'home.heroSubtitle': '从 B 站发现并播放你喜欢的音乐',
    'home.recommendedMusic': '推荐音乐',
    'home.refreshRecommend': '刷新推荐',
    'home.loading': '加载中...',

    // Player
    'player.noTrack': '暂无播放歌曲',
    'player.play': '播放',
    'player.pause': '暂停',
    'player.prev': '上一首',
    'player.next': '下一首',
    'player.queue': '播放队列',
    'player.volume': '音量',
    'player.desktopLyrics': '桌面歌词',
    'player.mode.repeatAll': '列表循环',
    'player.mode.repeatOne': '单曲循环',
    'player.mode.shuffle': '随机播放',
    'player.mode.sequential': '顺序播放',

    // Lyrics
    'lyrics.empty': '暂无歌词',
    'lyrics.instrumental': '纯音乐，请欣赏',
    'lyrics.search': '搜索歌词',
    'lyrics.source': '歌词来源',
    'lyrics.source.bilibili': '哔哩哔哩 CC 字幕',
    'lyrics.source.kugou': '酷狗音乐',
    'lyrics.source.netease': '网易云音乐',
    'lyrics.source.manual': '手动选择',
    'lyrics.source.local': '本地 LRC',
    'lyrics.t2s': '繁简转换',

    // Settings
    'settings.title': '应用设置',
    'settings.language': '界面语言',
    'settings.langSelect': '选择语言',
    'settings.audio': '音频设置',
    'settings.audioQuality': '音质偏好',
    'settings.audioQuality.auto': '自动（随网络）',
    'settings.audioQuality.lossless': '无损 Hi-Res',
    'settings.audioQuality.high': '极高音质',
    'settings.audioQuality.medium': '标准音质',
    'settings.audioQuality.low': '省流音质',
    'settings.lyricSource': '默认歌词源',
    'settings.visualizer': '音频可视化',
    'settings.eq': '均衡器',
    'settings.about': '关于与更新',
    'settings.version': '当前版本',
    'settings.checkUpdate': '检查更新',
    'settings.checkingUpdate': '检查更新中...',
    'settings.upToDate': '当前已是最新版本',
    'settings.githubRepo': '开源项目主页',
    'settings.clearCache': '清除缓存',
    'settings.logout': '退出登录 B 站',
    'settings.confirmLogout': '确定要退出当前账号吗？',

    // General / Modals
    'common.confirm': '确定',
    'common.cancel': '取消',
    'common.close': '关闭',
    'common.save': '保存',
    'common.delete': '删除',
    'common.retry': '重试',
    'common.success': '操作成功',
    'common.error': '操作失败'
  },
  'en-US': {
    // Topbar & Navigation
    'brand.name': 'Pink Music',
    'nav.home': 'Discover',
    'nav.discover': 'Discover',
    'nav.rank': 'Charts',
    'nav.library': 'Library',
    'nav.local': 'Local Music',
    'nav.playlists': 'Playlists',
    'nav.downloads': 'Downloads',
    'nav.settings': 'Settings',
    'topbar.themeDark': 'Switch to Dark Mode',
    'topbar.themeLight': 'Switch to Light Mode',
    'topbar.langSwitch': 'Switch Language',
    'topbar.loginBili': 'Sign in Bilibili',
    'topbar.loggedIn': 'Signed In',
    'topbar.searchPlaceholder': 'Search music, artist, BVID...',
    'topbar.search': 'Search',

    // Hero & Home
    'home.heroTitle': 'Welcome to Pink Music',
    'home.heroSubtitle': 'Discover and play music you love from Bilibili',
    'home.recommendedMusic': 'Recommended Music',
    'home.refreshRecommend': 'Refresh',
    'home.loading': 'Loading...',

    // Player
    'player.noTrack': 'No track playing',
    'player.play': 'Play',
    'player.pause': 'Pause',
    'player.prev': 'Previous',
    'player.next': 'Next',
    'player.queue': 'Play Queue',
    'player.volume': 'Volume',
    'player.desktopLyrics': 'Desktop Lyrics',
    'player.mode.repeatAll': 'Repeat All',
    'player.mode.repeatOne': 'Repeat One',
    'player.mode.shuffle': 'Shuffle',
    'player.mode.sequential': 'Sequential',

    // Lyrics
    'lyrics.empty': 'No lyrics available',
    'lyrics.instrumental': 'Instrumental, please enjoy',
    'lyrics.search': 'Search Lyrics',
    'lyrics.source': 'Lyric Source',
    'lyrics.source.bilibili': 'Bilibili CC Subtitle',
    'lyrics.source.kugou': 'Kugou Music',
    'lyrics.source.netease': 'NetEase Cloud Music',
    'lyrics.source.manual': 'Manual Select',
    'lyrics.source.local': 'Local LRC',
    'lyrics.t2s': 'Convert Trad/Simp',

    // Settings
    'settings.title': 'Application Settings',
    'settings.language': 'Interface Language',
    'settings.langSelect': 'Select Language',
    'settings.audio': 'Audio Settings',
    'settings.audioQuality': 'Audio Quality',
    'settings.audioQuality.auto': 'Auto (Adaptive)',
    'settings.audioQuality.lossless': 'Lossless Hi-Res',
    'settings.audioQuality.high': 'High Quality',
    'settings.audioQuality.medium': 'Standard Quality',
    'settings.audioQuality.low': 'Data Saver',
    'settings.lyricSource': 'Preferred Lyric Source',
    'settings.visualizer': 'Audio Visualizer',
    'settings.eq': 'Equalizer',
    'settings.about': 'About & Updates',
    'settings.version': 'Current Version',
    'settings.checkUpdate': 'Check for Updates',
    'settings.checkingUpdate': 'Checking for updates...',
    'settings.upToDate': 'You are using the latest version',
    'settings.githubRepo': 'GitHub Repository',
    'settings.clearCache': 'Clear Cache',
    'settings.logout': 'Sign Out',
    'settings.confirmLogout': 'Are you sure you want to sign out?',

    // General / Modals
    'common.confirm': 'OK',
    'common.cancel': 'Cancel',
    'common.close': 'Close',
    'common.save': 'Save',
    'common.delete': 'Delete',
    'common.retry': 'Retry',
    'common.success': 'Success',
    'common.error': 'Failed'
  }
}

export function t(key, fallback) {
  const lang = currentLanguage.value || 'zh-TW'
  const dict = messages[lang] || messages['zh-TW']
  if (dict && dict[key] !== undefined) {
    return dict[key]
  }
  const defaultDict = messages['zh-TW']
  if (defaultDict && defaultDict[key] !== undefined) {
    return defaultDict[key]
  }
  return fallback !== undefined ? fallback : key
}

export default {
  install(app) {
    app.config.globalProperties.$t = t
    app.provide('t', t)
    app.provide('currentLanguage', currentLanguage)
  }
}
