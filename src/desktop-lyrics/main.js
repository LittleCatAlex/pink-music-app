import { createApp } from 'vue'
import App from './App.vue'

// 桌面歌词悬浮窗：独立 Vite 入口，不引入 Pinia / 路由，
// 全部状态来自主窗口经主进程中继的 desktop-lyrics-state 消息流。
createApp(App).mount('#app')
