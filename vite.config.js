import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

export default defineConfig({
  plugins: [vue()],
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  build: {
    assetsDir: 'assets',
    rollupOptions: {
      // 多入口：index.html 主应用 + desktop_lyrics.html 桌面歌词悬浮窗
      input: {
        main: path.resolve(__dirname, 'index.html'),
        desktopLyrics: path.resolve(__dirname, 'desktop_lyrics.html')
      }
    }
  },
  server: {
    proxy: {
      '/api': {
        target: 'https://api.bilibili.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      },
      '/passport': {
        target: 'https://passport.bilibili.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/passport/, '')
      }
    }
  }
})