# Pink Music 开发规范

> **版本**: 1.4.0
> **最后更新**: 2026-06-13
> **技术栈**: Vue 3 + Electron + Pinia (含持久化) + Vite + Axios
> **项目版本**: 1.2.0（与 `package.json` 同步）

---

## 目录

1. [项目概述](#1-项目概述)
2. [代码风格与格式](#2-代码风格与格式)
3. [命名约定](#3-命名约定)
4. [架构设计原则](#4-架构设计原则)
5. [文件组织方式](#5-文件组织方式)
6. [状态管理规范](#6-状态管理规范)
7. [组件开发规范](#7-组件开发规范)
8. [API设计与通信](#8-api设计与通信)
9. [Electron IPC 通信规范](#9-electron-ipc-通信规范)
10. [错误处理机制](#10-错误处理机制)
11. [日志记录标准](#11-日志记录标准)
12. [性能优化要求](#12-性能优化要求)
13. [安全规范](#13-安全规范)
14. [测试策略](#14-测试策略)
15. [版本控制流程](#15-版本控制流程)
16. [构建与部署](#16-构建与部署)
17. [文档编写规范](#17-文档编写规范)

---

## 1. 项目概述

### 1.1 项目结构

```
Pink Music/
├── electron/                          # Electron 主进程代码
│   ├── main.js                        # 主进程入口（含 B 站 API、网易云歌词、登录等）
│   ├── preload.js                     # 预加载脚本（contextBridge 暴露 API）
│   ├── audioStreamManager.js          # 音频流式下载管理
│   ├── cacheManager.js                # 本地音频缓存管理
│   └── test.js                        # 最小化调试窗口
├── src/                               # 渲染进程代码（Vue 应用）
│   ├── assets/                        # 静态资源
│   ├── common/                        # 公共模块
│   │   └── utils/
│   │       ├── cookie.ts              # Cookie 刷新 / 读取 / 写入
│   │       └── geetest.ts             # Geetest 验证（占位）
│   ├── components/                    # Vue 组件（平铺 + 必要子目录）
│   │   ├── AppPlayerBar.vue
│   │   ├── AppSidebar.vue
│   │   ├── PlayerPage.vue
│   │   ├── SettingsPanel.vue
│   │   ├── WindowControls.vue
│   │   └── player/
│   │       └── LyricDisplay.vue
│   ├── composables/                   # 组合式函数
│   │   ├── index.js                   # 统一导出
│   │   ├── useAudioPlayer.js          # 音频播放器逻辑
│   │   └── useMusic.js                # 音乐搜索 / 推荐
│   ├── service/                       # API 服务（按功能域拆文件）
│   │   ├── request/                   # Axios 请求封装
│   │   │   ├── index.ts
│   │   │   ├── request-interceptors.ts
│   │   │   ├── response-interceptors.ts
│   │   │   └── wbi-sign.ts
│   │   ├── gaia-vgate.ts              # B 站极验注册 / 校验
│   │   ├── player-playurl.ts          # 视频流地址（WBI 签名）
│   │   ├── user-info.ts               # 登录态 / WBI 密钥
│   │   ├── web-interface-search-type.ts
│   │   └── web-interface-view.ts
│   ├── stores/                        # Pinia 状态管理
│   │   ├── index.js                   # 统一导出
│   │   ├── player.js
│   │   ├── playlist.js
│   │   ├── search.js
│   │   ├── settings.js
│   │   ├── theme.js
│   │   ├── userToken.js               # 使用 pinia-plugin-persistedstate
│   │   ├── userAccount.js             # 使用 pinia-plugin-persistedstate
│   │   └── lyric.js
│   ├── utils/                         # 工具函数
│   │   └── bilibili.js                # 渲染端 B 站数据格式化
│   ├── views/                         # 页面视图
│   │   ├── HomeView.vue
│   │   ├── SearchView.vue
│   │   └── PlaylistView.vue
│   ├── App.vue                        # 根组件（含主体业务）
│   ├── main.js                        # Vue 入口（注册 Pinia 持久化）
│   └── style.css                      # 全局样式
├── build/                             # 构建配置
│   └── entitlements.mac.plist
├── release/                           # 打包输出
├── scripts/                           # 构建脚本
│   └── notarize.js
├── cache/                             # 本地缓存（git 忽略）
├── public/                            # Vite 公共资源
├── package.json
├── vite.config.js
└── index.html
```

### 1.2 技术栈

| 层级 | 技术 | 用途 |
|------|------|------|
| 前端框架 | Vue 3 (Composition API) | UI 开发 |
| 构建工具 | Vite | 开发服务器和打包 |
| 状态管理 | Pinia | 全局状态管理 |
| 状态持久化 | pinia-plugin-persistedstate | 用户登录态等关键数据 |
| HTTP 客户端 | Axios | B 站 / 网易云 API 请求 |
| 工具库 | es-toolkit | 函数式 / 谓词工具 |
| 哈希算法 | spark-md5 | WBI 签名 |
| 时间处理 | moment | Cookie 刷新窗口、token 续期 |
| 桌面框架 | Electron | 跨平台桌面应用 |
| 包管理 | npm | 依赖管理 |

### 1.3 主要依赖（dependencies）

- `axios` — HTTP 客户端
- `cookie` — Cookie 解析（主进程 webRequest 重写 Set-Cookie）
- `es-toolkit` — 谓词 / 集合操作工具
- `lowdb` — 本地小数据库（保留依赖，按需使用）
- `moment` — 时间处理
- `pinia` — 状态管理
- `pinia-plugin-persistedstate` — Pinia 持久化
- `spark-md5` — WBI 签名
- `vue` — 视图框架

### 1.4 主要开发依赖（devDependencies）

- `@electron/notarize` — macOS 公证
- `@vitejs/plugin-vue` — Vite Vue 插件
- `electron` — 桌面框架
- `electron-builder` — 打包工具
- `electron-notarize` — 旧版公证（保留）
- `vite` — 构建工具

---

## 2. 代码风格与格式

### 2.1 通用规则

- **缩进**: 使用 2 个空格（项目已配置）
- **行尾**: 遵循系统默认（macOS: LF）
- **文件编码**: UTF-8
- **引号**: JavaScript 使用单引号，TypeScript/Pinia 使用单引号
- **分号**: 使用分号结尾
- **括号**: 花括号与关键字同行，如 `if () {`

### 2.2 Vue 组件规范

#### 2.2.1 组件结构顺序

```vue
<script setup>
// 1. 导入
import { ref, computed, onMounted } from 'vue'
import { useStore } from '@/stores'

// 2. Props 定义
const props = defineProps({
  title: {
    type: String,
    required: true
  }
})

// 3. Emits 定义
const emit = defineEmits(['update', 'delete'])

// 4. 常量定义
const CONSTANT_VALUE = 'fixed'

// 5. 响应式状态
const state = ref(null)
const isLoading = ref(false)

// 6. 计算属性
const computedValue = computed(() => {
  return state.value * 2
})

// 7. 观察者
watch(state, (newVal) => {
  console.log('Changed:', newVal)
})

// 8. 生命周期钩子
onMounted(() => {
  init()
})

// 9. 方法定义
function handleClick() {
  emit('update', computedValue.value)
}

// 10. 暴露给父组件
defineExpose({
  computedValue,
  handleClick
})
</script>

<template>
  <!-- 模板内容 -->
</template>

<style scoped>
/* 组件样式 */
</style>
```

#### 2.2.2 Script Setup 规范

**优点**：
- 更简洁的语法
- 更好的性能
- 更好的 TypeScript 支持

**使用方式**：
```vue
<script setup>
import { ref, computed } from 'vue'

// 使用 defineProps 定义 props
const props = defineProps({
  initialCount: {
    type: Number,
    default: 0
  }
})

// 使用 defineEmits 定义事件
const emit = defineEmits(['update'])

// 响应式引用
const count = ref(props.initialCount)

// 计算属性
const doubled = computed(() => count.value * 2)

// 方法
function increment() {
  count.value++
  emit('update', count.value)
}

// 暴露给父组件
defineExpose({ count, increment })
</script>
```

### 2.3 JavaScript 规范

#### 2.3.1 变量声明

```javascript
// ✅ 推荐：使用 const 声明不会改变的变量
const MAX_RETRY_COUNT = 3
const API_BASE_URL = 'https://api.bilibili.com'

// ✅ 推荐：使用 let 声明会改变的变量
let currentIndex = 0
let isLoading = false

// ❌ 避免：不使用 var
var oldStyle = 'avoid'
```

#### 2.3.2 函数定义

```javascript
// ✅ 推荐：箭头函数
const fetchData = async (params) => {
  const result = await api.request(params)
  return result
}

// ✅ 推荐：函数声明
function handleClick(event) {
  console.log('Clicked:', event)
}

// ✅ 推荐：简短回调使用箭头函数
const items = data.filter(item => item.active)
```

#### 2.3.3 异步处理

```javascript
// ✅ 推荐：使用 async/await
async function loadMusic(bvid) {
  try {
    const info = await window.electronAPI.getMusicInfo(bvid)
    const playUrl = await window.electronAPI.getMusicPlayUrl(bvid, info.data.cid)
    return { info, playUrl }
  } catch (error) {
    console.error('加载音乐失败:', error)
    throw error
  }
}

// ❌ 避免：过度嵌套的 Promise
function loadMusic(bvid) {
  return window.electronAPI.getMusicInfo(bvid)
    .then(info => {
      return window.electronAPI.getMusicPlayUrl(bvid, info.data.cid)
    })
}
```

### 2.4 CSS 规范

#### 2.4.1 样式文件结构

```css
/* 1. 变量定义 */
:root {
  --primary-color: #FF69B4;
  --font-size-base: 14px;
  --spacing-md: 16px;
}

/* 2. 基础样式 */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

/* 3. 布局样式 */
.container {
  display: flex;
  gap: var(--spacing-md);
}

/* 4. 组件样式 */
.button {
  padding: 8px 16px;
  background: var(--primary-color);
}

/* 5. 工具类 */
.text-center {
  text-align: center;
}
```

#### 2.4.2 CSS 变量命名

```css
/* ✅ 推荐：语义化命名 */
--primary-color: #FF69B4;
--text-primary: #ffffff;
--bg-secondary: #121220;

/* ❌ 避免：模糊命名 */
--color-1: #FF69B4;
--text-color: #ffffff;
```

#### 2.4.3 选择器规范

```css
/* ✅ 推荐：使用 BEM 或语义化命名 */
.music-card {
  padding: var(--spacing-md);
}

.music-card__title {
  font-size: 16px;
}

.music-card--active {
  background: var(--primary-color);
}

/* ✅ 推荐：组件作用域样式 */
<style scoped>
.card {
  padding: 16px;
}
</style>
```

---

## 3. 命名约定

### 3.1 文件命名

| 类型 | 规范 | 示例 |
|------|------|------|
| Vue 组件 | PascalCase | `UserProfile.vue`, `MusicPlayer.vue` |
| 组合式函数 | camelCase + use 前缀 | `useAudioPlayer.js`, `useMusic.js` |
| Pinia Store | camelCase + Store 后缀 | `playerStore`, `settingsStore` |
| 工具函数 | camelCase | `formatTime.js`, `parseDuration.js` |
| 常量 | SCREAMING_SNAKE_CASE | `API_URL`, `MAX_RETRY` |
| 样式文件 | kebab-case | `style.css`, `button-styles.css` |
| Electron 文件 | camelCase | `audioStreamManager.js` |

### 3.2 变量命名

```javascript
// ✅ 推荐：使用有意义的名称
const musicList = []
const currentTrack = {}
const isLoading = false

// ❌ 避免：模糊或单字母命名（循环变量除外）
const list = []     // ❌
const data = {}     // ❌
const a = 0         // ❌

// ✅ 循环变量可以使用简短命名
for (let i = 0; i < 10; i++)
for (const item of items)
for (const [key, value] of Object.entries(obj))
```

### 3.3 函数命名

```javascript
// ✅ 推荐：动词 + 名词
function loadMusic() {}
function playMusic(track) {}
function pauseMusic() {}
function searchMusic(keyword) {}

// ✅ 推荐：布尔值函数使用 is/has/can 前缀
function isPlaying() {}
function hasPermission() {}
function canEdit() {}

// ✅ 推荐：事件处理函数使用 handle 前缀
function handleClick(event) {}
function handleInput(value) {}
function handleSubmit(formData) {}
```

### 3.4 组件命名

```vue
<!-- ✅ 推荐：多单词组件名 -->
<UserProfile />
<MusicPlayer />
<SearchResults />

<!-- ❌ 避免：单单词组件名（除非是通用组件） -->
<Button />    // ✅ 通用组件
<Header />    // ✅ 通用组件
<Card />      // ✅ 通用组件

<Item />      // ❌ 太模糊
<Panel />    // ❌ 太模糊
```

---

## 4. 架构设计原则

### 4.1 整体架构

```
┌─────────────────────────────────────────┐
│           Electron 主进程                │
│  ┌─────────────────────────────────┐   │
│  │  • 窗口管理                      │   │
│  │  • 系统集成                      │   │
│  │  • IPC 通信处理                  │   │
│  │  • API 代理                      │   │
│  └─────────────────────────────────┘   │
└────────────────┬────────────────────────┘
                 │ IPC
┌────────────────┴────────────────────────┐
│           Electron 预加载              │
│  ┌─────────────────────────────────┐   │
│  │  • contextBridge 暴露 API        │   │
│  │  • 安全隔离层                    │   │
│  └─────────────────────────────────┘   │
└────────────────┬────────────────────────┘
                 │ 安全的 API
┌────────────────┴────────────────────────┐
│           Vue 3 渲染进程                │
│  ┌──────────────┬──────────────────┐   │
│  │  Pinia Store │  Vue Components   │   │
│  │  • player    │  • WindowControls │   │
│  │  • playlist  │  • AppSidebar     │   │
│  │  • search    │  • PlayerPage     │   │
│  │  • settings  │  • ...            │   │
│  └──────────────┴──────────────────┘   │
│  ┌─────────────────────────────────┐   │
│  │  Composables                    │   │
│  │  • useAudioPlayer               │   │
│  │  • useMusic                     │   │
│  └─────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

### 4.2 核心原则

#### 4.2.1 单一职责原则 (SRP)

每个模块应该只有一个职责：

```
✅ 推荐：分离关注点
├── stores/
│   ├── playerStore.js    # 播放器状态
│   ├── playlistStore.js  # 播放列表状态
│   └── settingsStore.js  # 设置状态

❌ 避免：职责混杂
├── stores/
│   └── allStore.js       # 包含所有状态
```

#### 4.2.2 依赖注入

通过 Pinia 和 Composables 实现依赖注入：

```javascript
// ✅ 推荐：通过参数传递依赖
function useMusicPlayer(playerStore, audioService) {
  // ...
}

// ❌ 避免：直接导入全局单例
function useMusicPlayer() {
  const playerStore = usePlayerStore() // 可能导致测试困难
}
```

#### 4.2.3 分层架构

```
┌─────────────────────────────────────┐
│        Views (页面层)               │
│  • HomeView, SearchView, PlaylistView │
└─────────────┬───────────────────────┘
              │
┌─────────────┴───────────────────────┐
│        Components (组件层)           │
│  • AppSidebar, PlayerPage, SettingsPanel │
└─────────────┬───────────────────────┘
              │
┌─────────────┴───────────────────────┐
│        Composables (逻辑层)          │
│  • useAudioPlayer, useMusic         │
└─────────────┬───────────────────────┘
              │
┌─────────────┴───────────────────────┐
│        Stores (状态层)               │
│  • playerStore, playlistStore        │
└─────────────┬───────────────────────┘
              │
┌─────────────┴───────────────────────┐
│        Services (服务层)             │
│  • electronAPI, Axios instances      │
└─────────────────────────────────────┘
```

---

## 5. 文件组织方式

### 5.1 Vue 组件组织

> 项目采用「**平铺为主 + 必要子目录**」的组织方式，模块边界清晰时不强拆目录。

```
src/components/
├── AppPlayerBar.vue           # 底部播放栏
├── AppSidebar.vue             # 侧边栏（含主题、歌单、历史）
├── PlayerPage.vue             # 大屏播放页（含分P / 合集面板）
├── SettingsPanel.vue          # 设置面板（独立组件）
├── WindowControls.vue         # 窗口最小化 / 最大化 / 关闭
└── player/
    └── LyricDisplay.vue       # 歌词展示（独立子目录）
```

> ⚠️ **注意**：`App.vue` 仍包含登录、歌单管理、主题等主体业务逻辑，属于历史遗留。在新增功能时，**优先**把逻辑放到对应 Composable / Store / 独立组件中，再在 App.vue 中组合。

### 5.2 Store 组织

```
src/stores/
├── index.js                # 统一导出
├── player.js               # 播放器：currentTrack / isPlaying / 播放模式 / 历史 / 分P
├── playlist.js             # 用户歌单：增删 / 导入导出 / 当前歌单
├── search.js               # 搜索 / 推荐结果
├── settings.js             # 设置面板状态 + IPC 桥接（缓存 / 下载目录）
├── theme.js                # 主题模式 + 主题色
├── userToken.js            # token 续期时间（pinia-plugin-persistedstate）
├── userAccount.js          # 用户信息（含 wbi_img）
└── lyric.js                # 歌词加载 / 解析 / 缓存 / 滚动
```

> 命名约定：文件名不带后缀，导出的 hook 使用 `useXxxStore` 前缀。

### 5.3 Service 组织

```
src/service/
├── request/                          # Axios 基础
│   ├── index.ts                      # 多实例创建
│   ├── request-interceptors.ts       # Cookie 刷新 / CSRF / WBI / FormData
│   ├── response-interceptors.ts      # Geetest voucher 检测
│   └── wbi-sign.ts                   # B 站 WBI 签名
├── gaia-vgate.ts                     # 极验注册 / 校验
├── player-playurl.ts                 # /x/player/wbi/playurl（WBI）
├── user-info.ts                      # /x/web-interface/nav（WBI）
├── web-interface-search-type.ts      # /x/web-interface/wbi/search/type（WBI）
└── web-interface-view.ts             # /x/web-interface/view
```

> `src/utils/bilibili.js` 仅做**渲染端格式化**（`parseDuration`、`formatPlayCount`、`stripHtmlTags`、`fixCoverUrl`、`extractBVId`），不发起任何 HTTP 请求。

### 5.4 Composables 组织

```
src/composables/
├── index.js                 # 统一导出
├── useAudioPlayer.js        # 音频播放单例（play / pause / seek / next / prev）
└── useMusic.js              # 音乐搜索 / 推荐（handleSearch / loadRecommendedMusic）
```

### 5.5 Common Utils 组织

```
src/common/utils/
├── cookie.ts                # refreshCookie / getCookie / setCookie
└── geetest.ts               # verifyGeetest（占位，未实装）

---

## 6. 状态管理规范

### 6.1 Pinia Store 设计

#### 6.1.1 Store 基本结构（Options API 风格）

项目统一使用 **Options API** 风格的 `defineStore`，不引入 setup store。

```javascript
// stores/player.js
import { defineStore } from 'pinia'

export const usePlayerStore = defineStore('player', {
  // 1. State
  state: () => ({
    currentTrack: null,
    isPlaying: false,
    showPlayerPage: false,
    currentTime: 0,
    duration: 0,
    isAudioLoading: false,
    audioError: '',
    bufferedProgress: 0,
    playMode: 'order', // order | loop | single | shuffle
    playModes: [
      { value: 'order',   icon: '🔁', label: '顺序播放' },
      { value: 'loop',    icon: '🔃', label: '列表循环' },
      { value: 'single',  icon: '🔂', label: '单曲循环' },
      { value: 'shuffle', icon: '🔀', label: '随机播放' }
    ],
    playHistory: JSON.parse(localStorage.getItem('pink-music-history') || '[]'),
    currentSeries: null,
    showSeriesPanel: false,
    currentVideoEpisodes: [],
    currentEpisodeIndex: 0,
    showPlaylistManager: false,
    isLoadingEpisodes: false
  }),

  // 2. Actions
  actions: {
    setCurrentTrack(track) {
      this.currentTrack = track
      if (track) this.addToPlayHistory(track)
    },
    setIsPlaying(playing) { this.isPlaying = playing },
    togglePlayMode() {
      const modes = ['order', 'loop', 'single', 'shuffle']
      const i = modes.indexOf(this.playMode)
      this.playMode = modes[(i + 1) % modes.length]
    },
    getPlayModeIcon() {
      return this.playModes.find(m => m.value === this.playMode)?.icon || this.playModes[0].icon
    },
    // ...
    async loadVideoEpisodes(bvid) {
      this.setIsLoadingEpisodes(true)
      try {
        const response = await window.electronAPI.getVideoEpisodes(bvid)
        if (response.code === 0 && response.data) {
          this.setCurrentVideoEpisodes(response.data)
        } else {
          this.setCurrentVideoEpisodes([])
          this.setCurrentEpisodeIndex(0)
        }
      } catch (error) {
        console.error('获取分P列表失败:', error)
        this.setCurrentVideoEpisodes([])
        this.setCurrentEpisodeIndex(0)
      } finally {
        this.setIsLoadingEpisodes(false)
      }
    }
  }
})
```

#### 6.1.2 Store 使用规范

```javascript
// ✅ 推荐：组件内使用
import { usePlayerStore, usePlaylistStore, useSearchStore } from '@/stores'
import { useAudioPlayer } from '@/composables/useAudioPlayer'

const playerStore = usePlayerStore()
const playlistStore = usePlaylistStore()
const searchStore = useSearchStore()
const { playMusic, togglePlayPause } = useAudioPlayer()
```

#### 6.1.3 状态持久化（两种方式并存）

项目实际使用**两种持久化方式**，按数据重要性选择：

##### 方式一：`localStorage` 直读（适用于缓存、UI 状态）

```javascript
// stores/theme.js
import { defineStore } from 'pinia'

export const useThemeStore = defineStore('theme', {
  state: () => ({
    currentTheme: localStorage.getItem('pink-music-theme') || 'dark',
    currentColor: localStorage.getItem('pink-music-color') || 'pink'
  }),
  actions: {
    setTheme(theme) {
      this.currentTheme = theme
      localStorage.setItem('pink-music-theme', theme)
      document.documentElement.setAttribute('data-theme', theme)
    },
    setColor(color) {
      this.currentColor = color
      localStorage.setItem('pink-music-color', color)
      document.documentElement.setAttribute('data-color', color)
    },
    initTheme() {
      document.documentElement.setAttribute('data-theme', this.currentTheme)
      document.documentElement.setAttribute('data-color', this.currentColor)
    }
  }
})
```

类似处理：`stores/player.js`（`playHistory`）、`stores/playlist.js`（`userPlaylists`）、`stores/lyric.js`（`lyricCache`）。

##### 方式二：`pinia-plugin-persistedstate`（适用于关键用户态）

```javascript
// stores/userAccount.js
import { defineStore } from 'pinia'

export const useUserAccountStore = defineStore('userAccount', {
  state: () => ({ user: null }),
  actions: {
    updateUser(user) { this.user = user },
    clear() { this.user = null }
  },
  persist: { key: 'user' }            // 整个 state 自动持久化
})
```

```javascript
// stores/userToken.js
import { defineStore } from 'pinia'
import moment from 'moment'

export const useUserTokenStore = defineStore('userToken', {
  state: () => ({
    tokenData: {},
    nextCheckRefreshTime: moment().unix()
  }),
  actions: {
    updateToken(info) { Object.assign(this, info) },
    clear() {
      this.tokenData = undefined
      this.nextCheckRefreshTime = undefined
    }
  },
  persist: {
    key: 'user-token',
    paths: ['tokenData', 'nextCheckRefreshTime']  // 只持久化指定字段
  }
})
```

> **选择建议**：
> - 涉及登录态、token → 用 `pinia-plugin-persistedstate`（自动反序列化、可配置 `paths`）。
> - 大量缓存（歌词、播放历史、用户歌单） → 用 `localStorage`（避免插件序列化性能开销，可在 action 中控制节流）。

#### 6.1.4 Lyric Store 特殊模式

`stores/lyric.js` 内部维护了一个**带 TTL 的内存 + localStorage 歌词缓存**：

- 缓存键：`${bvid}-${cid}`
- 默认 TTL：7 天（`Date.now() - timestamp < 7 * 24 * 60 * 60 * 1000`）
- 容量上限：1000 条，超出后按时间戳淘汰
- 来源标记：`netease` / `manual`
- 解析方法：`parseLyric(rawLyric)` 自动过滤 `作词/作曲/编曲/未经许可` 等元信息行

新增歌词相关功能时，**直接复用 `lyricStore.getCachedLyric` / `cacheLyric`**，避免重复实现。

---

## 7. 组件开发规范

### 7.1 组件分类

#### 7.1.1 容器组件 vs 展示组件

```vue
<!-- Container Component（容器组件）—— 负责数据 + 业务 -->
<script setup>
import { ref, onMounted } from 'vue'
import { useSearchStore } from '@/stores'
import { useMusic } from '@/composables/useMusic'
import SearchResults from './SearchResults.vue'

const searchStore = useSearchStore()
const { loadRecommendedMusic } = useMusic()
const isLoading = ref(false)

onMounted(() => { loadRecommendedMusic() })
</script>

<template>
  <div class="search-container">
    <SearchResults :results="searchStore.searchResults" :loading="isLoading" />
  </div>
</template>
```

```vue
<!-- Presentational Component（展示组件）—— 只接收 props + emit -->
<script setup>
defineProps({
  results: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false }
})
defineEmits(['select'])
</script>

<template>
  <div class="search-results">
    <div v-if="loading" class="loading">加载中...</div>
    <div v-else v-for="item in results" :key="item.bvid" class="result-item">
      {{ item.title }}
    </div>
  </div>
</template>
```

#### 7.1.2 业务组件现状

| 组件 | 角色 | 备注 |
|------|------|------|
| `App.vue` | 容器 + 业务聚合 | 登录、歌单、主题、设置均在此实现 |
| `AppPlayerBar.vue` | 展示 | 消费 `usePlayerStore` + `useAudioPlayer` |
| `AppSidebar.vue` | 展示 | 消费 store 数据，调用 store action |
| `PlayerPage.vue` | 容器 | 聚合分P / 合集 / 歌词 |
| `player/LyricDisplay.vue` | 容器 | 消费 `useLyricStore`，本地维护滚动状态 |
| `SettingsPanel.vue` | 容器 | 消费 `useSettingsStore` + `useThemeStore` |
| `WindowControls.vue` | 展示 | 通过 `electronAPI` 调用窗口控制 IPC |

> 新增组件时，**优先**遵循容器/展示分离；只有样式简单、状态全部由 prop 驱动的组件可保持展示性质。

### 7.2 Props 定义

```vue
<script setup>
// ✅ 推荐：详细的 Props 定义
const props = defineProps({
  // 基础类型
  title: String,

  // 带验证
  count: {
    type: Number,
    required: true,
    validator: (value) => value >= 0
  },

  // 带默认值（数组 / 对象必须用工厂函数）
  items:  { type: Array,  default: () => [] },
  config: { type: Object, default: () => ({ autoPlay: false, loop: false }) },

  // 自定义验证器
  status: {
    type: String,
    default: 'pending',
    validator: (v) => ['pending', 'success', 'error'].includes(v)
  }
})

// ❌ 避免：偷懒式声明
// const props = defineProps(['title', 'count'])
</script>
```

### 7.3 事件定义

```vue
<script setup>
const emit = defineEmits(['update', 'delete', 'select'])

function handleItemClick(item) {
  emit('select', item)
}
</script>

<template>
  <div @click="handleItemClick">
    <button @click.stop="emit('update', { value: 1, timestamp: Date.now() })">更新</button>
  </div>
</template>
```

### 7.4 WindowControls 组件实现要点

`components/WindowControls.vue` 是**唯一**与平台相关的展示组件：

```vue
<script setup>
import { ref, onMounted } from 'vue'

const isMac = ref(false)

onMounted(() => {
  if (window.electronAPI) {
    const platform = window.electronAPI.getPlatform()
    isMac.value = platform === 'darwin'
  }
})

function minimizeWindow() { window.electronAPI?.minimizeWindow() }
function maximizeWindow() { window.electronAPI?.maximizeWindow() }
function closeWindow()    { window.electronAPI?.closeWindow() }
</script>

<template>
  <!-- macOS 不显示（系统提供红绿灯按钮） -->
  <div v-if="!isMac" class="window-controls">
    <button class="control-btn minimize" @click="minimizeWindow" title="最小化">…</button>
    <button class="control-btn maximize" @click="maximizeWindow" title="最大化">…</button>
    <button class="control-btn close"     @click="closeWindow"    title="关闭">…</button>
  </div>
</template>
```

### 7.5 跨组件通信

主要依赖 Pinia + `defineProps/defineEmits` + Composable。

> 项目**没有**使用 `provide/inject` 与 EventBus。父→子用 props，子→父用 emit，跨层级共享状态走 Pinia Store。

### 7.6 入口与全局注册

```javascript
// src/main.js
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import './style.css'
import App from './App.vue'

const app = createApp(App)
const pinia = createPinia()
pinia.use(piniaPluginPersistedstate)   // 必须先 use 再 mount
app.use(pinia)
app.mount('#app')
```

---

## 8. API设计与通信

### 8.1 Axios 多实例配置

`src/service/request/index.ts` 维护 **6 个** Axios 实例，按域名拆分；每个实例单独挂载请求 / 响应拦截器。

```typescript
// src/service/request/index.ts
import axios, { type CreateAxiosDefaults } from 'axios';

import { requestInterceptors } from './request-interceptors';
import { responseInterceptors } from './response-interceptors';

const axiosConfig: CreateAxiosDefaults = {
  timeout: 10000,
  withCredentials: true,
};

export const axiosInstance = axios.create(axiosConfig);

export const searchRequest = axios.create({
  ...axiosConfig,
  baseURL: 'https://s.search.bilibili.com',
});

export const biliRequest = axios.create({
  ...axiosConfig,
  baseURL: 'https://www.bilibili.com',
});

export const memberRequest = axios.create({
  ...axiosConfig,
  baseURL: 'https://member.bilibili.com',
});

export const apiRequest = axios.create({
  ...axiosConfig,
  baseURL: 'https://api.bilibili.com',
});

export const passportRequest = axios.create({
  ...axiosConfig,
  baseURL: 'https://passport.bilibili.com',
});

apiRequest.interceptors.request.use(requestInterceptors);
passportRequest.interceptors.request.use(requestInterceptors);
searchRequest.interceptors.request.use(requestInterceptors);
memberRequest.interceptors.request.use(requestInterceptors);

apiRequest.interceptors.response.use(responseInterceptors);
passportRequest.interceptors.response.use(responseInterceptors);
searchRequest.interceptors.response.use(responseInterceptors);
memberRequest.interceptors.response.use(responseInterceptors);
biliRequest.interceptors.response.use(responseInterceptors);
axiosInstance.interceptors.response.use(responseInterceptors);

// 不走 WBI / 自定义 header 的请求（极少，例如 wbi-sign 自身取密钥）
const noWbiRequest = axios.create({
  timeout: 10000,
  withCredentials: true,
  baseURL: 'https://api.bilibili.com',
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://www.bilibili.com/',
    'Origin': 'https://www.bilibili.com',
  },
});
noWbiRequest.interceptors.response.use(responseInterceptors);

export { noWbiRequest };
```

> ⚠️ **项目实际不做** `axios.defaults` 集中配置，所有实例都通过 `interceptors` 显式注入。

### 8.2 请求拦截器（基于 config flag）

请求拦截器**不**做通用 header 注入，而是按 `config` 上的布尔位决定行为：

| Flag | 含义 | 触发逻辑 |
|------|------|---------|
| `skipRefreshCheck` | 跳过 Cookie 刷新检查 | 默认每个请求都走 refresh 流程 |
| `useCSRF` | 注入 `bili_jct` 作为 CSRF | POST 走 body，其他走 query |
| `useWbi` | 对 params 做 WBI 签名 | 调用 `encodeParamsWbi` |
| `useFormData` | 自动转 `FormData` | 遍历 `config.data` 字段 |

```typescript
// src/service/request/request-interceptors.ts
import { type InternalAxiosRequestConfig } from "axios";
import moment from "moment";

import { refreshCookie } from "@/common/utils/cookie";
import { useUserTokenStore } from "@/stores";
import { encodeParamsWbi } from "./wbi-sign";

let refreshCookiePromise: Promise<any> | null = null;

export const requestInterceptors = async (config: InternalAxiosRequestConfig) => {
  const tokenStore = useUserTokenStore();

  // 1. Cookie 刷新（默认每个请求都会检查）
  if (!config.skipRefreshCheck && (tokenStore.nextCheckRefreshTime || 0) < moment().unix()) {
    if (!refreshCookiePromise) {
      tokenStore.nextCheckRefreshTime = moment().add(30, "seconds").unix();
      refreshCookiePromise = refreshCookie().finally(() => {
        refreshCookiePromise = null;
      });
    }
    try {
      await refreshCookiePromise;
    } finally {
      tokenStore.nextCheckRefreshTime = moment().add(2, "days").unix();
    }
  }

  // 2. CSRF（useCSRF: true 时）
  if (config.useCSRF) {
    const csrfToken = await window.electronAPI.getCookie("bili_jct");
    if (csrfToken) {
      if (config.method === "post") {
        config.data ??= {};
        config.data.csrf = csrfToken;
      } else {
        config.params ??= {};
        config.params.csrf = csrfToken;
      }
    }
  }

  // 3. WBI 签名（useWbi: true 时）
  if (config.useWbi) {
    config.params ??= {};
    config.params = await encodeParamsWbi(config.params);
  }

  // 4. FormData 转换（useFormData: true 时）
  if (config.useFormData) {
    const formData = new FormData();
    for (const key in config.data) {
      formData.append(key, config.data[key]);
    }
    config.data = formData;
  }

  return config;
};
```

### 8.3 响应拦截器

只做 **极简检测**：发现 Geetest 触发即打日志，最终**直接返回 `response.data`**（由调用方取 `data` 字段）。

```typescript
// src/service/request/response-interceptors.ts
import type { AxiosResponse } from 'axios';

export const responseInterceptors = (response: AxiosResponse) => {
  if (response?.data?.data?.v_voucher) {
    console.log('Geetest verification required but not implemented');
  }
  return response.data;
};
```

> ❗ 状态码 4xx/5xx **不会**被这里拦截 — `Axios` 本身会 reject，调用方用 `try/catch` 处理。

### 8.4 WBI 签名

`src/service/request/wbi-sign.ts` 提供 `encodeParamsWbi(params)`：

- 优先从 `useUserAccountStore().user.wbi_img` 取 `img_url` / `sub_url`；
- 取不到则用 `noWbiRequest.get('/x/web-interface/nav')` 实时拉取；
- 走标准 B 站 WBI 算法：`getMixinKey` → 排序 params → `chr_filter` 过滤 → `SparkMD5` 哈希 → 追加 `w_rid`。

调用约定（与请求拦截器联动）：

```typescript
return apiRequest.get<WebInterfaceViewResponse>('/x/web-interface/view', { params, useWbi: true });
```

### 8.5 Service 文件拆分

`src/service/` 下的 API 文件统一为 **TypeScript**，每个文件聚焦一个端点（带类型定义）：

```
src/service/
├── request/                          # Axios 基础（见 8.1-8.3）
│   ├── index.ts
│   ├── request-interceptors.ts
│   ├── response-interceptors.ts
│   └── wbi-sign.ts
├── gaia-vgate.ts                     # /api/gaia-vgate/register & validate（极验）
├── player-playurl.ts                 # /x/player/wbi/playurl（getPlayerPlayurl）
├── user-info.ts                      # /x/web-interface/nav（getUserInfo）
├── web-interface-search-type.ts      # /x/web-interface/wbi/search/type
└── web-interface-view.ts             # /x/web-interface/view（getWebInterfaceView）
```

#### 8.5.1 典型 API 封装

```typescript
// src/service/web-interface-view.ts
import { apiRequest } from './request';

export interface WebInterfaceViewRequestParams {
  aid?: number;
  bvid?: string;
}

export interface WebInterfaceViewResponse {
  code: number;
  message: string;
  ttl: number;
  data: WebInterfaceViewData;
}
// ... 完整类型定义 ...

export const getWebInterfaceView = (params: WebInterfaceViewRequestParams) => {
  return apiRequest.get<WebInterfaceViewResponse>('/x/web-interface/view', { params });
};
```

#### 8.5.2 极验（占位）

```typescript
// src/service/gaia-vgate.ts
import axios from 'axios';

export const postGaiaVgateRegister = (data: GaiaVgateRegisterRequest) => {
  return axios.post<GaiaVgateRegisterResponse>('https://api.bilibili.com/api/gaia-vgate/register', data);
};
// validate 同理
```

> 实际渲染端**未使用** `gaia-vgate.ts`，仅作占位导出以备后续接入。

### 8.6 渲染端格式化工具

`src/utils/bilibili.js` **不发起任何 HTTP 请求**，仅做字段格式化（`parseDuration` 把秒数转 `m:ss`、`formatPlayCount` 转 `万/亿`、`stripHtmlTags` 去除搜索高亮标签、`fixCoverUrl` 补齐 `https://` 前缀、`extractBVId` 抽取 BV 号）。

---

## 9. Electron IPC 通信规范

### 9.1 IPC 通信架构

```
┌──────────────────┐         ┌──────────────────┐
│   Main Process   │◄───────►│  Renderer Process │
│   (electron/)    │  IPC    │    (src/)         │
│                  │         │                   │
│  ipcMain.handle  │────────►│ window.electronAPI │
│                  │◄────────│ ipcRenderer       │
└──────────────────┘         └───────────────────┘
         │
         ▼
┌──────────────────┐
│  preload.js      │
│  contextBridge   │
│  暴露安全的 API   │
└──────────────────┘
```

### 9.2 主进程 IPC 处理

```javascript
// electron/main.js

// 1. 注册 IPC 处理器
ipcMain.handle('search-music', async (event, keyword, page, pageSize) => {
  try {
    // 处理逻辑
    const result = await bilibiliAPI.searchMusic(keyword, page, pageSize)
    return { code: 0, data: result }
  } catch (error) {
    console.error('搜索失败:', error)
    return { code: -1, message: error.message }
  }
})

// 2. 窗口控制 IPC
ipcMain.handle('minimize-window', () => {
  const window = BrowserWindow.getFocusedWindow()
  if (window) {
    window.minimize()
  }
  return { code: 0 }
})

ipcMain.handle('maximize-window', () => {
  const window = BrowserWindow.getFocusedWindow()
  if (window) {
    if (window.isMaximized()) {
      window.unmaximize()
    } else {
      window.maximize()
    }
  }
  return { code: 0 }
})

ipcMain.handle('close-window', () => {
  const window = BrowserWindow.getFocusedWindow()
  if (window) {
    window.close()
  }
  return { code: 0 }
})
```

### 9.3 预加载脚本暴露 API

```javascript
// electron/preload.js
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // 搜索相关
  searchMusic: (keyword, page, pageSize) =>
    ipcRenderer.invoke('search-music', keyword, page, pageSize),

  // 音乐信息
  getMusicInfo: (bvid) =>
    ipcRenderer.invoke('get-music-info', bvid),

  getMusicPlayUrl: (bvid, cid) =>
    ipcRenderer.invoke('get-music-play-url', bvid, cid),

  // 音频代理
  proxyAudio: (audioUrl) =>
    ipcRenderer.invoke('proxy-audio', audioUrl),

  // 窗口控制
  minimizeWindow: () =>
    ipcRenderer.invoke('minimize-window'),

  maximizeWindow: () =>
    ipcRenderer.invoke('maximize-window'),

  closeWindow: () =>
    ipcRenderer.invoke('close-window'),

  getPlatform: () =>
    ipcRenderer.invoke('get-platform'),

  // 设置相关
  getCacheSize: () =>
    ipcRenderer.invoke('get-cache-size'),

  clearCache: () =>
    ipcRenderer.invoke('clear-cache'),

  selectDownloadDirectory: () =>
    ipcRenderer.invoke('select-download-directory'),

  // Cookie 管理
  getCookies: () =>
    ipcRenderer.invoke('get-cookies'),

  setCookies: (cookies) =>
    ipcRenderer.invoke('set-cookies', cookies)
})
```

### 9.4 渲染进程调用

```javascript
// 在 Vue 组件中使用
export default {
  async loadMusic() {
    try {
      // 通过 electronAPI 调用主进程
      const info = await window.electronAPI.getMusicInfo('BV1xx411c7mu')
      if (info.code === 0) {
        this.musicInfo = info.data
      }
    } catch (error) {
      console.error('加载失败:', error)
    }
  },

  minimizeWindow() {
    if (window.electronAPI) {
      window.electronAPI.minimizeWindow()
    }
  }
}
```

### 9.5 IPC 命名规范

```javascript
// ✅ 推荐：清晰的命名
ipcMain.handle('get-music-info', handler)
ipcMain.handle('get-music-play-url', handler)
ipcMain.handle('search-music', handler)

// ✅ 推荐：使用名词描述资源
ipcMain.handle('get-user-profile', handler)
ipcMain.handle('update-user-settings', handler)

// ❌ 避免：模糊的命名
ipcMain.handle('get-data', handler)
ipcMain.handle('process', handler)
```

---

## 10. 错误处理机制

### 10.1 错误分类

```javascript
// errors/ErrorTypes.js
export const ErrorTypes = {
  // 网络错误
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT_ERROR: 'TIMEOUT_ERROR',

  // 业务错误
  AUTH_ERROR: 'AUTH_ERROR',
  PERMISSION_ERROR: 'PERMISSION_ERROR',
  NOT_FOUND_ERROR: 'NOT_FOUND_ERROR',

  // 系统错误
  SYSTEM_ERROR: 'SYSTEM_ERROR',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR'
}

// errors/ErrorHandler.js
export class AppError extends Error {
  constructor(type, message, code = -1) {
    super(message)
    this.type = type
    this.code = code
    this.timestamp = Date.now()
  }
}
```

### 10.2 统一错误处理

```javascript
// utils/errorHandler.js
export function handleApiError(error, context = '') {
  if (error.response) {
    // 服务器返回错误响应
    const { status, data } = error.response

    switch (status) {
      case 401:
        console.error(`${context}: 未授权`)
        return { type: 'AUTH_ERROR', message: '请先登录' }
      case 403:
        return { type: 'PERMISSION_ERROR', message: '无权限访问' }
      case 404:
        return { type: 'NOT_FOUND_ERROR', message: '资源不存在' }
      default:
        return { type: 'SYSTEM_ERROR', message: data.message || '服务器错误' }
    }
  } else if (error.request) {
    // 请求已发送但无响应
    return { type: 'NETWORK_ERROR', message: '网络连接失败' }
  } else {
    // 请求配置错误
    return { type: 'UNKNOWN_ERROR', message: error.message }
  }
}
```

### 10.3 组件内错误处理

```vue
<script setup>
import { ref } from 'vue'

const errorMessage = ref('')
const isLoading = ref(false)

async function loadData() {
  isLoading.value = true
  errorMessage.value = ''

  try {
    const result = await window.electronAPI.getMusicInfo(bvid)
    if (result.code === 0) {
      // 处理成功
      data.value = result.data
    } else {
      // 业务逻辑错误
      errorMessage.value = result.message || '加载失败'
    }
  } catch (error) {
    // 系统错误
    console.error('加载失败:', error)
    errorMessage.value = '系统错误，请稍后重试'
  } finally {
    isLoading.value = false
  }
}
</script>

<template>
  <div>
    <div v-if="errorMessage" class="error-message">
      {{ errorMessage }}
    </div>
    <div v-if="isLoading" class="loading">
      加载中...
    </div>
  </div>
</template>
```

### 10.4 异步操作错误处理

```javascript
// ✅ 推荐：使用 try-catch
async function loadMusic() {
  try {
    const info = await window.electronAPI.getMusicInfo(bvid)
    if (info.code !== 0) {
      throw new Error(info.message)
    }
    return info.data
  } catch (error) {
    console.error('加载音乐失败:', error)
    throw error
  }
}

// ✅ 推荐：Promise 链式调用
window.electronAPI.getMusicInfo(bvid)
  .then(info => {
    if (info.code !== 0) {
      throw new Error(info.message)
    }
    return window.electronAPI.getPlayUrl(bvid, info.data.cid)
  })
  .then(playUrl => {
    // 处理播放地址
  })
  .catch(error => {
    console.error('操作失败:', error)
  })
```

---

## 11. 日志记录标准

### 11.1 日志级别

```javascript
// utils/logger.js
const LogLevel = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
}

class Logger {
  constructor(level = LogLevel.INFO) {
    this.level = level
  }

  debug(message, ...args) {
    if (this.level <= LogLevel.DEBUG) {
      console.debug(`[DEBUG] ${message}`, ...args)
    }
  }

  info(message, ...args) {
    if (this.level <= LogLevel.INFO) {
      console.info(`[INFO] ${message}`, ...args)
    }
  }

  warn(message, ...args) {
    if (this.level <= LogLevel.WARN) {
      console.warn(`[WARN] ${message}`, ...args)
    }
  }

  error(message, ...args) {
    if (this.level <= LogLevel.ERROR) {
      console.error(`[ERROR] ${message}`, ...args)
    }
  }
}

export const logger = new Logger(LogLevel.DEBUG)
```

### 11.2 日志使用规范

```javascript
// ✅ 推荐：带上下文的日志
logger.info('加载音乐', { bvid: 'BV1xx411c7mu', title: '歌曲名' })
logger.error('播放失败', { bvid, error: error.message })

// ✅ 推荐：区分日志级别
logger.debug('请求参数:', params)        // 调试信息
logger.info('搜索完成', { count: 20 })   // 一般信息
logger.warn('播放地址为空', { bvid })    // 警告信息
logger.error('网络错误', error)          // 错误信息

// ❌ 避免：使用 console.log 记录重要信息
console.log('用户登录成功')      // ❌
console.error('请求失败')        // ✅
```

### 11.3 结构化日志

```javascript
// ✅ 推荐：结构化日志
logger.info('用户操作', {
  userId: '12345',
  action: 'play_music',
  bvid: 'BV1xx411c7mu',
  timestamp: Date.now()
})

// ❌ 避免：字符串拼接
logger.info('用户' + userId + '播放了' + bvid)
```

### 11.4 Electron 主进程日志

```javascript
// electron/main.js
const fs = require('fs')
const path = require('path')

class FileLogger {
  constructor(filename) {
    this.logPath = path.join(app.getPath('userData'), 'logs', filename)
    this.ensureLogDir()
  }

  ensureLogDir() {
    const logDir = path.dirname(this.logPath)
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true })
    }
  }

  write(level, message, data = {}) {
    const log = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...data
    }
    const logLine = JSON.stringify(log) + '\n'
    fs.appendFileSync(this.logPath, logLine)
  }
}

const mainLogger = new FileLogger('main.log')

// 使用
mainLogger.write('INFO', '应用启动')
mainLogger.write('ERROR', '窗口创建失败', { error: error.message })
```

---

## 12. 性能优化要求

### 12.1 当前实践

| 场景 | 实际做法 |
|------|---------|
| 音频播放 | `useAudioPlayer.js` 内部维护**单例** `Audio` 实例，避免重复创建。 |
| 歌词滚动 | `LyricDisplay.vue` 用 `requestAnimationFrame` 节流 + 2 秒手动滚动回自动跟随（见 12.1.1）。 |
| 播放历史 | `addToPlayHistory` 写库前 `slice(0, 50)`，防止 localStorage 膨胀。 |
| 歌词缓存 | `lyricCache` 上限 1000 条，超出按时间戳淘汰。 |
| 时间更新 | `audioInstance` 触发 `timeupdate` 后通过 `setCurrentTime` 写 store，依赖 Pinia 自身响应式。 |
| Vite proxy | dev 模式 `/api` / `/passport` 走代理，避免 CORS 预检开销。 |

#### 12.1.1 歌词滚动节流

```javascript
// components/player/LyricDisplay.vue
let timeUpdateThrottle = null
let scrollReturnTimer = null

watch(() => props.currentTime, (newTime) => {
  if (isManualScrolling.value) return
  if (timeUpdateThrottle) return
  timeUpdateThrottle = true
  requestAnimationFrame(() => {
    lyricStore.updateCurrentLine(newTime)
    timeUpdateThrottle = null
  })
})
```

#### 12.1.2 缓存淘汰

```javascript
// stores/lyric.js
cleanupCache() {
  const keys = Object.keys(this.lyricCache)
  if (keys.length > 1000) {
    const sorted = keys.sort((a, b) => (this.lyricCache[b].timestamp - this.lyricCache[a].timestamp))
    const toRemove = sorted.slice(1000)
    toRemove.forEach(key => delete this.lyricCache[key])
  }
}
```

### 12.2 推荐的进一步优化（未实施）

> 以下为方向性建议，**不要**作为强制要求。

- **大列表渲染**：搜索结果超过 100 条时考虑 `v-memo`。
- **大对象响应式**：搜索结果 / 歌单若扩展至千级，可改用 `shallowRef`。
- **异步组件**：大屏 `PlayerPage.vue` 可改 `defineAsyncComponent` 懒加载。
- **图片懒加载**：搜索结果封面若改用 `v-lazy`。
- **IndexedDB**：歌词 / 歌单迁移到 `lowdb`（依赖已就位）以避免 localStorage 5MB 上限。

### 12.3 不推荐的模式

```javascript
// ❌ 避免：每个组件 new Audio()
function useAudioPlayer() {
  const audio = new Audio()   // 项目已用单例
}

// ❌ 避免：歌词 setInterval 轮询
setInterval(() => updateLyric(), 100)   // 应基于 audioInstance.timeupdate

// ❌ 避免：把 base64 音频塞进 Vue 响应式
const audioData = ref('data:audio/...')  // proxyAudio 已改为 IPC buffer
```

---

## 13. 安全规范

### 13.1 Electron BrowserWindow 配置（实际值）

```javascript
// electron/main.js
const mainWindow = new BrowserWindow({
  width: 1200,
  height: 800,
  frame: false,                  // 自定义红绿灯 / 顶栏
  titleBarStyle: 'hidden',
  webPreferences: {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,      // ✅ 启用上下文隔离（preload 才能用 contextBridge）
    // nodeIntegration: false    // 默认就是 false，未显式声明
    // sandbox: true              // 未启用：项目里有少数 Node 用法
    webSecurity: false           // ⚠️ 与官方默认相反 — 必需，详见 13.1.1
  }
});
```

#### 13.1.1 为什么 `webSecurity: false`？

主进程通过 `session.defaultSession.webRequest.onHeadersReceived` **重写 Set-Cookie 的 `sameSite`/`secure` 属性**，以便第三方域名的 Cookie 能被 Electron 持久化。开启 `webSecurity` 会阻断此改写。

> **折衷方案**：通过 `webRequest` 拦截 + 主进程集中管理 Cookie，替代完全信任渲染端网络栈。这是已知的临时妥协，待未来通过 BrowserWindow `partition` + `permissions` 收紧。

### 13.2 contextBridge 白名单

`electron/preload.js` 严格按白名单暴露 3 个 API，**绝不**直接传 `ipcRenderer`：

```javascript
// ✅ 推荐：白名单方式暴露 API
contextBridge.exposeInMainWorld('electronAPI', { /* 通用 */ });
contextBridge.exposeInMainWorld('electron',     { /* Cookie */ });
contextBridge.exposeInMainWorld('electronPlayer', { /* 音频 seek */ });

// ❌ 禁止：
// contextBridge.exposeInMainWorld('ipc', ipcRenderer);
```

### 13.3 Cookie 与敏感数据

| 类别 | 存储位置 | 访问方式 |
|------|---------|---------|
| 用户登录 Cookie | Electron `session.defaultSession` | `window.electronAPI.getCookie` / `setCookie` |
| 主题 / 颜色 / 歌单 / 播放历史 | `localStorage` | `useThemeStore` / `usePlaylistStore` / `usePlayerStore` |
| 登录态 / Token / 续期时间 | `localStorage`（经 `pinia-plugin-persistedstate`） | `useUserAccountStore` / `useUserTokenStore` |
| 歌词缓存（最多 1000 条） | `localStorage` | `useLyricStore` |
| 用户级下载设置 | `userData/settings.json` | `useSettingsStore` |

> 项目**未**使用 `safeStorage` 加密 — 因为核心登录态由 B 站维持，本地只缓存非敏感的 `wbi_img` 与 token 时间戳。涉及金额 / 实名等敏感数据时，**应**改用 `safeStorage.encryptString`。

### 13.4 IPC 响应安全

主进程统一返回 `{ code, data?, message? }` 形式，并在 `try/catch` 中捕获异常返回 `{ code: -1, message }`，避免异常对象直接序列化到 IPC 通道。

### 13.5 渲染端输入校验

- 搜索词、文件名传入主进程前在渲染端 `trim()`。
- 下载文件名 `fileName.replace(/[<>"/\\|?*]/g, '').substring(0, 100)`，避免路径注入与超长文件名。
- 路由参数（如 `bvid`）只透传给 B 站，不做二次拼接。

### 13.6 开发环境约束

- dev 模式：渲染端连 `http://localhost:5173`，主进程 `webContents.openDevTools()`。
- production 模式：加载 `dist/index.html`（`file://`），不开放 DevTools。

---

## 14. 测试策略

### 14.1 测试框架选择

| 测试类型 | 框架 | 用途 |
|---------|------|------|
| 单元测试 | Vitest | Vue 组件、Composables、Utils |
| 组件测试 | Vue Test Utils + Vitest | Vue 组件行为 |
| E2E 测试 | Playwright | 完整用户流程 |
| 手动测试 | - | 视觉和体验测试 |

### 14.2 单元测试示例

```javascript
// stores/__tests__/playerStore.spec.js
import { defineStore } from 'pinia'
import { setActivePinia, createPinia } from 'pinia'
import { usePlayerStore } from '../player'

describe('Player Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('should set current track', () => {
    const playerStore = usePlayerStore()
    const track = { bvid: 'BV1xx411c7mu', title: 'Test' }

    playerStore.setCurrentTrack(track)

    expect(playerStore.currentTrack).toEqual(track)
  })

  it('should toggle play/pause', () => {
    const playerStore = usePlayerStore()

    expect(playerStore.isPlaying).toBe(false)

    playerStore.setIsPlaying(true)
    expect(playerStore.isPlaying).toBe(true)

    playerStore.setIsPlaying(false)
    expect(playerStore.isPlaying).toBe(false)
  })
})
```

### 14.3 组件测试示例

```javascript
// components/__tests__/WindowControls.spec.js
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import WindowControls from '../WindowControls.vue'

describe('WindowControls', () => {
  it('renders minimize, maximize, and close buttons', () => {
    const wrapper = mount(WindowControls, {
      global: {
        stubs: {
          'window.electronAPI': {
            minimizeWindow: vi.fn(),
            maximizeWindow: vi.fn(),
            closeWindow: vi.fn(),
            getPlatform: () => 'win32'
          }
        }
      }
    })

    expect(wrapper.findAll('button')).toHaveLength(3)
  })

  it('calls minimizeWindow when minimize button is clicked', async () => {
    const mockMinimize = vi.fn()
    const wrapper = mount(WindowControls, {
      global: {
        stubs: {
          'window.electronAPI': {
            minimizeWindow: mockMinimize,
            maximizeWindow: vi.fn(),
            closeWindow: vi.fn(),
            getPlatform: () => 'win32'
          }
        }
      }
    })

    await wrapper.find('.control-btn.minimize').trigger('click')

    expect(mockMinimize).toHaveBeenCalled()
  })
})
```

### 14.4 E2E 测试示例

```javascript
// e2e/music-player.spec.js
import { test, expect } from '@playwright/test'

test.describe('Music Player', () => {
  test('should play music', async ({ page }) => {
    await page.goto('/')

    // 等待页面加载
    await page.waitForSelector('.music-card')

    // 点击音乐卡片
    await page.click('.music-card:first-child')

    // 验证播放器显示
    await expect(page.locator('.player-bar')).toBeVisible()

    // 验证播放状态
    await expect(page.locator('.play-button svg')).toContainHTML('M8 5v14l11-7z')
  })

  test('should search music', async ({ page }) => {
    await page.goto('/')

    // 导航到搜索页
    await page.click('button:has-text("搜索")')

    // 输入搜索关键词
    await page.fill('input[type="text"]', '周杰伦')

    // 提交搜索
    await page.click('button:has-text("搜索")')

    // 验证搜索结果
    await expect(page.locator('.search-results')).toBeVisible()
  })
})
```

### 14.5 测试覆盖率要求

```
目标覆盖率：
├── Utils/Composables: 80%+
├── Pinia Stores: 80%+
├── 组件方法: 70%+
└── 整体: 60%+
```

---

## 15. 版本控制流程

### 15.1 Git 分支模型

```
main (生产环境)
  │
  ├── develop (开发分支)
  │     │
  │     ├── feature/user-auth (功能分支)
  │     ├── feature/music-player (功能分支)
  │     ├── bugfix/fix-playback (修复分支)
  │     └── release/1.2.0 (发布分支)
  │
  └── hotfix/critical-bug (热修复分支)
```

### 15.2 提交信息规范

```
<type>(<scope>): <subject>

[可选的 body]

[可选的 footer]
```

**Type 类型**：

| Type | 说明 |
|------|------|
| feat | 新功能 |
| fix | Bug 修复 |
| docs | 文档更新 |
| style | 代码格式（不影响功能） |
| refactor | 重构（不是新功能或修复） |
| perf | 性能优化 |
| test | 测试相关 |
| build | 构建相关 |
| ci | CI/CD 相关 |
| chore | 其他更改 |

**示例**：

```
feat(player): 添加播放模式切换功能

添加单曲循环、列表循环、随机播放、顺序播放四种模式

Closes #123
```

```
fix(api): 修复音乐搜索接口超时问题

- 添加超时重试机制
- 优化错误处理

Closes #456
```

### 15.3 版本号规范

采用 **语义化版本 (SemVer)**：

```
主版本.次版本.修订号

例如：1.2.0

- 主版本 (1): 不兼容的重大更改
- 次版本 (2): 向下兼容的新功能
- 修订号 (0): 向下兼容的问题修复
```

### 15.4 发布流程

```bash
# 1. 从 develop 创建 release 分支
git checkout develop
git pull
git checkout -b release/1.2.0

# 2. 更新版本号
npm version patch  # 或 minor / major

# 3. 构建和测试
npm run electron:build

# 4. 合并到 main
git checkout main
git merge release/1.2.0
git tag -a v1.2.0 -m "Release version 1.2.0"

# 5. 合并回 develop
git checkout develop
git merge release/1.2.0

# 6. 删除 release 分支
git branch -d release/1.2.0
```

---

## 16. 构建与部署

### 16.1 构建脚本

```json
// package.json
{
  "name": "pink-music",
  "private": true,
  "version": "1.2.0",
  "main": "electron/main.js",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "electron:dev": "NODE_ENV=development electron . --no-sandbox",
    "electron:build": "npm run build && electron-builder -mw",
    "electron:build:mac": "npm run build && electron-builder --mac",
    "electron:build:win": "npm run build && electron-builder --win",
    "electron:build:all": "npm run build && electron-builder -mw"
  }
}
```

> ⚠️ 实际脚本中 `electron:build` 与 `electron:build:all` **完全相同**（`electron-builder -mw`）— 拆开仅为多平台扩展预留。

### 16.2 electron-builder 配置

```json
// package.json -> build
{
  "appId": "com.pinkmusic.app",
  "productName": "Pink Music",
  "compression": "maximum",
  "directories": { "output": "release" },
  "files": [
    "electron/**/*",
    { "from": "dist", "to": "dist", "filter": ["index.html", "assets/**/*"] },
    "pink.png"
  ],
  "afterSign": "scripts/notarize.js",
  "mac": {
    "target": [{ "target": "dmg", "arch": ["arm64"] }],
    "icon": "pink.png",
    "hardenedRuntime": true,
    "gatekeeperAssess": false,
    "entitlements": "build/entitlements.mac.plist",
    "entitlementsInherit": "build/entitlements.mac.plist"
  },
  "dmg": { "sign": false },
  "win": {
    "target": [{ "target": "nsis", "arch": ["x64", "arm64"] }],
    "icon": "pink.png"
  },
  "nsis": {
    "oneClick": false,
    "allowToChangeInstallationDirectory": true,
    "createDesktopShortcut": true,
    "createStartMenuShortcut": true,
    "shortcutName": "Pink Music"
  }
}
```

> - `gatekeeperAssess: false` + `dmg.sign: false`：本地构建跳过苹果二次校验。
> - `entitlements` / `entitlementsInherit` 必须指向 `build/entitlements.mac.plist`（`hardenedRuntime: true` 必填）。

### 16.3 公证脚本

`scripts/notarize.js` 在 `afterSign` 阶段被调用，仅对 `darwin` 生效：

```javascript
const { notarize } = require('@electron/notarize');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') return;
  const appName = context.packager.appInfo.productFilename;
  try {
    await notarize({
      appBundleId: 'com.pinkmusic.app',
      appPath: `${appOutDir}/${appName}.app`,
      appleId:        process.env.APPLE_ID,
      appleIdPassword: process.env.APPLE_ID_PASSWORD,
      ascProvider:    process.env.APPLE_TEAM_ID
    });
  } catch (error) {
    console.warn('Notarization skipped or failed:', error.message);
  }
};
```

> 凭据通过环境变量传入；未配置时跳过公证，App 仍可启动但需"仍要打开"。

### 16.4 Vite 配置

```javascript
// vite.config.js
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

export default defineConfig({
  plugins: [vue()],
  base: './',                                    // ⚠️ 相对路径，打包后走 file://
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') }
  },
  build: { assetsDir: 'assets' },
  server: {                                       // 仅 dev 模式生效
    proxy: {
      '/api':      { target: 'https://api.bilibili.com',      changeOrigin: true, rewrite: p => p.replace(/^\/api/, '') },
      '/passport': { target: 'https://passport.bilibili.com', changeOrigin: true, rewrite: p => p.replace(/^\/passport/, '') }
    }
  }
})
```

> 项目**不**使用 `define` 注入版本号（`SettingsPanel.vue` 中硬编码 `1.2.0`）。

### 16.5 构建流程

```bash
# 纯 Vite 构建（不打包 Electron）
npm run build
# 产物：dist/

# Electron 调试模式（连 Vite dev server）
npm run electron:dev

# 完整打包（macOS dmg + Windows nsis）
npm run electron:build
# 产物：release/Pink Music Setup 1.2.0.exe、Pink Music-1.2.0-arm64.dmg

# 仅 macOS / 仅 Windows
npm run electron:build:mac
npm run electron:build:win
```

### 16.6 Electron 版本说明

`package.json` 锁定 `electron@^20.0.0`（兼容 Node 16），与 `vite@^8` / `vue@^3.5` / `pinia@^3` 配合。`electron-builder@^24` 与 `electron-notarize@^1.2.2` 保留为旧版公证，**实际公证走 `@electron/notarize@^3.1.1`**（见 16.3）。

---

## 17. 文档编写规范

### 17.1 代码注释规范

```javascript
/**
 * 获取音乐播放地址
 * @param {string} bvid - B站视频 BV 号
 * @param {number} cid - 视频 cid
 * @returns {Promise<Object>} 包含播放地址的结果
 * @throws {Error} 当获取失败时抛出错误
 */
async function getMusicPlayUrl(bvid, cid) {
  // 单行注释：解释下一步操作
  const params = { bvid, cid, qn: 0, fnval: 4048 }

  try {
    const response = await apiRequest.get('/x/player/playurl', { params })
    return response.data
  } catch (error) {
    // 处理错误情况
    throw new Error(`获取播放地址失败: ${error.message}`)
  }
}
```

### 17.2 README 规范

```markdown
# Pink Music

> 基于 Electron + Vue 3 的 B 站音乐播放器

## 功能特性

- ✅ 音乐搜索与播放
- ✅ 播放列表管理
- ✅ 多平台支持 (macOS, Windows)
- 🎨 主题定制

## 技术栈

- Vue 3 + Composition API
- Pinia (状态管理)
- Vite (构建工具)
- Electron (桌面框架)
- Axios (HTTP 客户端)

## 快速开始

### 安装依赖

\`\`\`bash
npm install
\`\`\`

### 开发模式

\`\`\`bash
npm run electron:dev
\`\`\`

### 构建打包

\`\`\`bash
# 打包所有平台
npm run electron:build

# 仅 macOS
npm run electron:build:mac

# 仅 Windows
npm run electron:build:win
\`\`\`

## 项目结构

\`\`\`
src/
├── components/    # Vue 组件
├── composables/   # 组合式函数
├── stores/        # Pinia 状态
└── service/       # API 服务
\`\`\`

## License

MIT
```

### 17.3 API 文档规范

```markdown
## API 文档

### 搜索音乐

**请求**
\`\`\`
GET /api/search
\`\`\`

**参数**
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| keyword | string | 是 | 搜索关键词 |
| page | number | 否 | 页码，默认 1 |
| pageSize | number | 否 | 每页数量，默认 20 |

**响应**
\`\`\`json
{
  "code": 0,
  "data": {
    "results": [
      {
        "bvid": "BV1xx411c7mu",
        "title": "示例音乐",
        "author": "示例作者",
        "cover": "https://..."
      }
    ]
  }
}
\`\`\`

**错误码**
| code | 说明 |
|------|------|
| 0 | 成功 |
| -1 | 请求失败 |
| -2 | 参数错误 |
```

---

## 附录

### A. ESLint 配置

```javascript
// .eslintrc.js
module.exports = {
  root: true,
  env: {
    browser: true,
    es2021: true,
    node: true
  },
  extends: [
    'eslint:recommended',
    'plugin:vue/vue3-recommended'
  ],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module'
  },
  rules: {
    'no-console': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
    'no-debugger': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
    'vue/multi-word-component-names': 'off'
  }
}
```

### B. Prettier 配置

```javascript
// .prettierrc.js
module.exports = {
  semi: true,
  singleQuote: true,
  tabWidth: 2,
  useTabs: false,
  trailingComma: 'none',
  printWidth: 100,
  arrowParens: 'always'
}
```

### C. Git Hooks

```javascript
// .huskyrc
{
  "hooks": {
    "pre-commit": "npm run lint && npm run test",
    "commit-msg": "commitlint -E HUSKY_GIT_PARAMS"
  }
}
```

---

## 总结

本开发规范涵盖了 Pink Music 项目的各个方面：

1. **代码质量**：统一的代码风格、命名规范、组件结构
2. **架构设计**：清晰的分层架构、模块职责划分
3. **安全规范**：Electron 安全配置、数据保护
4. **性能优化**：组件优化、资源加载优化
5. **测试策略**：单元测试、集成测试、E2E 测试
6. **协作流程**：Git 工作流、版本控制、发布流程
7. **文档规范**：代码注释、README、API 文档

遵循这些规范可以确保代码的一致性、可维护性和可扩展性，提升团队协作效率。

---

**文档版本**: 1.0.0
**创建日期**: 2026-05-07
**下次审查**: 2026-08-07
