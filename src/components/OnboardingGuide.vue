<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { useSettingsStore, useThemeStore } from '../stores'
import pinkLogo from '../../pink.png'

const settingsStore = useSettingsStore()
const themeStore = useThemeStore()

// 首次启动才显示（state 初始化走 localStorage peek，同步可得，无闪烁）
const visible = computed(() => !settingsStore.onboardingCompleted)

const TOTAL_STEPS = 8
const step = ref(0)
const bodyRef = ref(null)

// 切步后把滚动区复位到顶部：上一步滚到底再翻页，下一步不应从中间开始
watch(step, () => nextTick(() => {
  if (bodyRef.value) bodyRef.value.scrollTop = 0
}))

// 桌面歌词快捷键展示文案（跟随设置项，按平台转写）
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || '')
const hotkeyText = computed(() => {
  const acc = settingsStore.desktopLyricsHotkey || 'CommandOrControl+D'
  return acc.split('+')
    .map(p => (p === 'CommandOrControl' ? (isMac ? '⌘' : 'Ctrl') : p))
    .join(' + ')
})

// 主题色选项（与 MineView 设置一致）
const colorOptions = [
  { value: 'pink', label: '粉色', color: '#FF69B4' },
  { value: 'purple', label: '紫色', color: '#9C27B0' },
  { value: 'blue', label: '蓝色', color: '#2196F3' },
  { value: 'green', label: '绿色', color: '#4CAF50' },
  { value: 'orange', label: '橙色', color: '#FF9800' },
  { value: 'apple-music', label: 'Apple Music', color: '#FC3C44' }
]

function isDarkTheme() {
  return themeStore.currentTheme !== 'light' && themeStore.currentTheme !== 'apple-light'
}
const themeMode = ref(isDarkTheme() ? 'dark' : 'light')

function setThemeMode(mode) {
  themeMode.value = mode
  themeStore.setTheme(mode === 'light' ? 'light' : 'dark')
}
function setColor(color) {
  themeStore.setColor(color)
}
function setVisualizer(enabled) {
  settingsStore.setAudioVisualizerEnabled(enabled)
}

function nextStep() {
  if (step.value < TOTAL_STEPS - 1) step.value++
  else finish()
}
function prevStep() {
  if (step.value > 0) step.value--
}
function finish() {
  settingsStore.completeOnboarding()
}

function onKeyDown(e) {
  if (!visible.value) return
  if (e.key === 'Escape') finish()
  else if (e.key === 'ArrowRight') nextStep()
  else if (e.key === 'ArrowLeft') prevStep()
}
onMounted(() => window.addEventListener('keydown', onKeyDown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeyDown))
</script>

<template>
  <Transition name="ob-fade">
    <div v-if="visible" class="onboarding-overlay" role="dialog" aria-label="首次启动引导">
      <div class="onboarding-card">
        <!-- 跳过 -->
        <button v-if="step < TOTAL_STEPS - 1" class="ob-skip" @click="finish">
          跳过引导
        </button>

        <!-- 内容滚动区：卡片本身不滚动，底部「上一步/下一步」常驻可见 -->
        <div ref="bodyRef" class="ob-body">
        <Transition name="ob-slide" mode="out-in">
          <!-- 步骤 0：欢迎 -->
          <div v-if="step === 0" key="s0" class="ob-step ob-step-welcome">
            <img class="ob-logo ob-logo-img" :src="pinkLogo" alt="Pink Music 应用图标" />
            <h2 class="ob-title text-gradient">欢迎使用 Pink Music</h2>
            <p class="ob-desc">一款基于 B 站的桌面音乐播放器<br>发现、播放、下载你喜欢的音乐</p>
            <p class="ob-hint">花 1 分钟了解各项功能与设置</p>
          </div>

          <!-- 步骤 1：发现音乐 -->
          <div v-else-if="step === 1" key="s1" class="ob-step">
            <h2 class="ob-title">发现音乐</h2>
            <p class="ob-desc">底部导航栏可在五个页面间切换</p>
            <div class="ob-feature-list">
              <div class="ob-feature">
                <span class="ob-icon">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>
                </span>
                <div>
                  <h4>首页</h4>
                  <p>浏览推荐音乐，点击封面即可播放</p>
                </div>
              </div>
              <div class="ob-feature">
                <span class="ob-icon">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
                </span>
                <div>
                  <h4>搜索</h4>
                  <p>搜索 B 站的海量音频与视频稿件</p>
                </div>
              </div>
              <div class="ob-feature">
                <span class="ob-icon">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M3 10h11v2H3v-2zm0-4h11v2H3V6zm0 8h7v2H3v-2zm13.59-5.41L20 12l-3.41 3.41-1.41-1.41L17.17 12l-1.99-1.99 1.41-1.42z"/></svg>
                </span>
                <div>
                  <h4>歌单</h4>
                  <p>创建歌单整理音乐，支持多 P 视频导入</p>
                </div>
              </div>
              <div class="ob-feature">
                <span class="ob-icon">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
                </span>
                <div>
                  <h4>本地</h4>
                  <p>导入自己电脑里的音频，与 B 站曲目一起播放</p>
                </div>
              </div>
              <div class="ob-feature">
                <span class="ob-icon">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
                </span>
                <div>
                  <h4>我的 · 登录 B 站</h4>
                  <p>右上角登录后可同步 B 站收藏夹与播放历史</p>
                </div>
              </div>
            </div>
          </div>

          <!-- 步骤 2：播放与歌词 -->
          <div v-else-if="step === 2" key="s2" class="ob-step">
            <h2 class="ob-title">播放与歌词</h2>
            <p class="ob-desc">播放器栏常驻底部，点击封面进入大屏播放页</p>
            <div class="ob-feature-list">
              <div class="ob-feature">
                <span class="ob-icon">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
                </span>
                <div>
                  <h4>播放控制</h4>
                  <p>支持播放模式切换、进度拖拽与系统媒体键控制</p>
                </div>
              </div>
              <div class="ob-feature">
                <span class="ob-icon">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/></svg>
                </span>
                <div>
                  <h4>歌词显示</h4>
                  <p>大屏播放页逐行滚动歌词，可在设置中切换原文 / 罗马音 / 翻译</p>
                </div>
              </div>
              <div class="ob-feature">
                <span class="ob-icon">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M3 12h4l3-9 4 18 3-9h4"/></svg>
                </span>
                <div>
                  <h4>音频可视化</h4>
                  <p>播放页底部随音乐律动的频谱效果，可在设置中调节强度</p>
                </div>
              </div>
            </div>
          </div>

          <!-- 步骤 3：桌面歌词（专页） -->
          <div v-else-if="step === 3" key="s3" class="ob-step">
            <h2 class="ob-title">桌面歌词</h2>
            <p class="ob-desc">播放控制栏上的「词」图标，就是桌面歌词的开关</p>
            <div class="ob-dl-demo">
              <span class="ob-dl-lyric-btn"><span class="ob-dl-char">词</span></span>
              <span class="ob-dl-demo-text">← 就是它，点一下即可开启</span>
            </div>
            <div class="ob-feature-list">
              <div class="ob-feature">
                <span class="ob-icon">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h5v2h8v-2h5c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 14H3V5h18v12z"/></svg>
                </span>
                <div>
                  <h4>悬浮桌面</h4>
                  <p>歌词悬浮在屏幕最上层，可拖动、可锁定，刷网页也能跟唱</p>
                </div>
              </div>
              <div class="ob-feature">
                <span class="ob-icon">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M20 5H4c-1.1 0-1.99.9-1.99 2L2 17c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm-9 3h2v2h-2V8zm0 3h2v2h-2v-2zM8 8h2v2H8V8zm0 3h2v2H8v-2zm-3 0h2v2H5v-2zm0-3h2v2H5V8zm9 7H8v2h6v-2zm0-4h2v2h-2v-2zm0-3h2v2h-2V8zm3 3h2v2h-2v-2zm0-3h2v2h-2V8z"/></svg>
                </span>
                <div>
                  <h4>快捷键</h4>
                  <p>随时按 {{ hotkeyText }} 开关桌面歌词，无需回到主窗口</p>
                </div>
              </div>
              <div class="ob-feature">
                <span class="ob-icon">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M17 1H7c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-2-2-2zm0 18H7V5h10v14zm-5-2.5c.83 0 1.5-.67 1.5-1.5s-.67-1.5-1.5-1.5-1.5.67-1.5 1.5.67 1.5 1.5 1.5z"/></svg>
                </span>
                <div>
                  <h4>可锁定防误触</h4>
                  <p>锁定后歌词窗口不再拦截鼠标点击，操作下层应用不被打扰</p>
                </div>
              </div>
            </div>
          </div>

          <!-- 步骤 4：歌曲下载（专页） -->
          <div v-else-if="step === 4" key="s4" class="ob-step">
            <h2 class="ob-title">歌曲下载</h2>
            <p class="ob-desc">把喜欢的歌保存到本地，离线也能听</p>
            <div class="ob-feature-list">
              <div class="ob-feature">
                <span class="ob-icon">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
                </span>
                <div>
                  <h4>一键下载</h4>
                  <p>在歌曲菜单里点击下载，自动加入下载队列</p>
                </div>
              </div>
              <div class="ob-feature">
                <span class="ob-icon">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-9 14H5v-2h5v2zm0-4H5v-2h5v2zm0-4H5V7h5v2zm4 8l-3-3h2V9h2v5h2l-3 3z"/></svg>
                </span>
                <div>
                  <h4>进度管理</h4>
                  <p>下载面板实时查看进度，完成/失败一目了然</p>
                </div>
              </div>
              <div class="ob-feature">
                <span class="ob-icon">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>
                </span>
                <div>
                  <h4>目录自选</h4>
                  <p>保存位置可在设置中更改，并支持一键打开</p>
                </div>
              </div>
            </div>
          </div>

          <!-- 步骤 5：本地音乐（专页） -->
          <div v-else-if="step === 5" key="s5" class="ob-step">
            <h2 class="ob-title">本地音乐</h2>
            <p class="ob-desc">底部导航栏的「本地」页面，播放你自己收藏的音频文件</p>
            <div class="ob-feature-list">
              <div class="ob-feature">
                <span class="ob-icon">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
                </span>
                <div>
                  <h4>导入文件 / 文件夹</h4>
                  <p>选音频或整个文件夹，可按文件夹名建同名歌单</p>
                </div>
              </div>
              <div class="ob-feature">
                <span class="ob-icon">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>
                </span>
                <div>
                  <h4>匹配封面</h4>
                  <p>缺封面的曲目可匹配云端封面，也可手动搜索</p>
                </div>
              </div>
              <div class="ob-feature">
                <span class="ob-icon">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
                </span>
                <div>
                  <h4>失效检测</h4>
                  <p>文件被移动会标记失效，可一键重新定位</p>
                </div>
              </div>
            </div>
            <p class="ob-hint">本地曲可直接加进歌单<br>wma / ape / dsf 等格式默认收录并标记为需转码</p>
          </div>

          <!-- 步骤 6：快速设置（交互式） -->
          <div v-else-if="step === 6" key="s6" class="ob-step">
            <h2 class="ob-title">先调调外观</h2>
            <p class="ob-desc">这几项现在就能试，随时可在「我的 → 设置」里更改</p>
            <div class="ob-quick-settings">
              <div class="ob-setting-row">
                <span class="ob-setting-label">外观模式</span>
                <div class="ob-mode-switch">
                  <button :class="{ active: themeMode === 'light' }" @click="setThemeMode('light')">浅色</button>
                  <button :class="{ active: themeMode === 'dark' }" @click="setThemeMode('dark')">深色</button>
                </div>
              </div>
              <div class="ob-setting-row">
                <span class="ob-setting-label">主题色</span>
                <div class="ob-color-list">
                  <button
                    v-for="c in colorOptions"
                    :key="c.value"
                    class="ob-color-dot"
                    :class="{ active: themeStore.currentColor === c.value }"
                    :style="{ background: c.color }"
                    :title="c.label"
                    :aria-label="c.label"
                    @click="setColor(c.value)"
                  ></button>
                </div>
              </div>
              <div class="ob-setting-row">
                <span class="ob-setting-label">音频可视化</span>
                <button
                  class="ob-toggle"
                  :class="{ on: settingsStore.audioVisualizerEnabled }"
                  role="switch"
                  :aria-checked="settingsStore.audioVisualizerEnabled"
                  @click="setVisualizer(!settingsStore.audioVisualizerEnabled)"
                >
                  <span class="ob-toggle-thumb"></span>
                </button>
              </div>
            </div>
          </div>

          <!-- 步骤 7：完成 -->
          <div v-else key="s7" class="ob-step ob-step-welcome">
            <img class="ob-logo ob-logo-img ob-logo-img-sm" :src="pinkLogo" alt="Pink Music 应用图标" />
            <h2 class="ob-title text-gradient">一切就绪</h2>
            <p class="ob-desc">更多设置（音质、均衡器、歌词、下载目录等）<br>都在「我的 → 设置」里</p>
            <p class="ob-hint">祝你听歌愉快 🎵</p>
          </div>
        </Transition>
        </div>

        <!-- 底部：进度点 + 导航 -->
        <div class="ob-footer">
          <div class="ob-dots">
            <button
              v-for="i in TOTAL_STEPS"
              :key="i"
              class="ob-dot"
              :class="{ active: step === i - 1 }"
              :aria-label="`第 ${i} 步`"
              @click="step = i - 1"
            ></button>
          </div>
          <div class="ob-nav">
            <button v-if="step > 0" class="ob-btn ob-btn-ghost" @click="prevStep">上一步</button>
            <button class="ob-btn ob-btn-primary" @click="nextStep">
              {{ step === TOTAL_STEPS - 1 ? '开始体验' : '下一步' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.onboarding-overlay {
  position: fixed;
  inset: 0;
  /* 层级：挂在 A1 全局 token 上（兜底 150 = --z-player-page）→ 190，
     高于播放页(150)与 Dock(70)，低于 toast(200) 与 WindowControls(900) */
  z-index: calc(var(--z-player-page, 150) + 40);
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(8, 8, 16, 0.55);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  padding: 24px;
  /* 遮罩不是拖拽区：否则 Electron 会吞掉盖在其上的按钮 click */
  -webkit-app-region: no-drag;
}

.onboarding-card {
  position: relative;
  width: min(520px, 92vw);
  /* 与「视口安全边距」取小值：1000×700 时 86vh=602 已生效，
     窗口再矮时由 calc(100vh - 48px) 兜底，卡片永远不会被窗口边缘裁掉 */
  max-height: min(86vh, calc(100vh - 48px));
  /* 卡片自身不滚动（旧写法 overflow-y:auto 会把 .ob-footer 一起滚出可视区，
     导致「下一步」看不见也点不到）；滚动交给内部 .ob-body */
  overflow: hidden;
  padding: 40px 36px 28px;
  border-radius: 24px;
  background: var(--bg-card);
  border: 1px solid var(--glass-border);
  box-shadow: var(--shadow-glow-strong), 0 24px 64px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(var(--glass-blur-heavy));
  -webkit-backdrop-filter: blur(var(--glass-blur-heavy));
  display: flex;
  flex-direction: column;
}

/* 内容滚动区：仅这里滚动，头部与底部导航固定 */
.ob-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
}

/* 跳过 */
.ob-skip {
  position: absolute;
  top: 16px;
  right: 18px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: var(--text-sm);
  cursor: pointer;
  padding: 6px 10px;
  border-radius: 8px;
  transition: color 0.2s, background 0.2s;
}
.ob-skip:hover {
  color: var(--text-primary);
  background: var(--bg-surface);
}

/* 步骤容器 */
.ob-step {
  flex: 1;
  text-align: center;
  padding: 8px 0 20px;
}
.ob-title {
  font-size: var(--text-3xl);
  font-weight: var(--font-weight-bold);
  margin: 0 0 12px;
}
.ob-desc {
  color: var(--text-secondary);
  font-size: var(--text-base);
  line-height: 1.7;
  margin: 0 0 8px;
}
.ob-hint {
  color: var(--text-muted);
  font-size: var(--text-sm);
  margin: 12px 0 0;
}

/* 欢迎 / 完成 logo */
.ob-logo {
  width: 88px;
  height: 88px;
  margin: 8px auto 20px;
  border-radius: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  background: var(--primary-gradient);
  box-shadow: var(--shadow-glow-strong);
}
/* 欢迎 / 完成页使用应用 logo 图片（pink.png 自带白色底与音符图形，按圆角图标呈现） */
.ob-logo-img {
  width: 104px;
  height: 104px;
  display: block;
  object-fit: contain;
  background: transparent;
  border-radius: 24px;
}
.ob-logo-img-sm {
  width: 84px;
  height: 84px;
  border-radius: 20px;
}

/* 桌面歌词「词」图标演示（仿播放控制栏按钮） */
.ob-dl-demo {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin: 16px 0 4px;
}
.ob-dl-lyric-btn {
  position: relative;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-tertiary);
  border: 1px solid var(--glass-border);
  animation: ob-dl-pulse 2s ease-in-out infinite;
}
.ob-dl-lyric-btn::after {
  /* 仿激活态右上角的状态点 */
  content: '';
  position: absolute;
  top: 7px;
  right: 7px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--primary-color);
}
.ob-dl-char {
  background: var(--primary-gradient);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  font-size: 16px;
  font-weight: 700;
  line-height: 1;
}
.ob-dl-demo-text {
  color: var(--text-secondary);
  font-size: var(--text-sm);
}
@keyframes ob-dl-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.08); }
}

/* 功能列表 */
.ob-feature-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 20px;
  text-align: left;
}
.ob-feature {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 12px 16px;
  border-radius: 14px;
  background: var(--bg-surface);
  border: 1px solid var(--glass-border);
  transition: border-color 0.2s, transform 0.2s;
}
.ob-feature:hover {
  border-color: var(--border-glow);
  transform: translateX(2px);
}
.ob-feature h4 {
  margin: 0 0 2px;
  font-size: var(--text-base);
  color: var(--text-primary);
}
.ob-feature p {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--text-secondary);
  line-height: 1.5;
}
.ob-icon {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--primary-color);
  background: var(--accent-glow-subtle);
}

/* 快速设置 */
.ob-quick-settings {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 24px;
}
.ob-setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 18px;
  border-radius: 14px;
  background: var(--bg-surface);
  border: 1px solid var(--glass-border);
}
.ob-setting-label {
  font-size: var(--text-base);
  color: var(--text-primary);
  flex-shrink: 0;
}
.ob-mode-switch {
  display: flex;
  gap: 4px;
  padding: 4px;
  border-radius: 10px;
  background: var(--bg-tertiary);
}
.ob-mode-switch button {
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  padding: 6px 16px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
}
.ob-mode-switch button.active {
  background: var(--primary-color);
  color: #fff;
}
.ob-color-list {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.ob-color-dot {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  outline: none;
  box-shadow: 0 0 0 2px var(--bg-card) inset;
  transition: transform 0.15s, box-shadow 0.15s;
}
.ob-color-dot:hover {
  transform: scale(1.15);
}
.ob-color-dot.active {
  border-color: var(--text-primary);
  transform: scale(1.1);
}

/* 开关 */
.ob-toggle {
  width: 46px;
  height: 26px;
  border-radius: 13px;
  border: none;
  position: relative;
  cursor: pointer;
  background: var(--bg-tertiary);
  transition: background 0.2s;
  outline: none;
}
.ob-toggle.on {
  background: var(--primary-color);
}
.ob-toggle-thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
  transition: transform 0.2s;
}
.ob-toggle.on .ob-toggle-thumb {
  transform: translateX(20px);
}

/* 底部导航 */
.ob-footer {
  /* 不允许被上方内容压缩：任何窗口高度下按钮区都保持完整高度 */
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
  padding-top: 18px;
  border-top: 1px solid var(--glass-border);
}

/* 所有可点元素显式 no-drag（引导页可能盖在拖拽区之上） */
.ob-skip,
.ob-btn,
.ob-dot,
.ob-mode-switch button,
.ob-color-dot,
.ob-toggle {
  -webkit-app-region: no-drag;
}
.ob-dots {
  display: flex;
  gap: 8px;
}
.ob-dot {
  width: 8px;
  height: 8px;
  padding: 0;
  border-radius: 50%;
  border: none;
  background: var(--text-muted);
  opacity: 0.4;
  cursor: pointer;
  transition: all 0.25s;
}
.ob-dot.active {
  width: 22px;
  border-radius: 4px;
  background: var(--primary-color);
  opacity: 1;
}
.ob-nav {
  display: flex;
  gap: 10px;
}
.ob-btn {
  border: none;
  border-radius: 10px;
  font-size: var(--text-base);
  padding: 9px 22px;
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.2s, background 0.2s;
}
.ob-btn:active {
  transform: scale(0.97);
}
.ob-btn-ghost {
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--glass-border);
}
.ob-btn-ghost:hover {
  color: var(--text-primary);
  border-color: var(--border-glow);
}
.ob-btn-primary {
  background: var(--primary-gradient);
  color: #fff;
  font-weight: var(--font-weight-medium);
}
.ob-btn-primary:hover {
  box-shadow: var(--shadow-glow);
}

/* 步骤切换动画 */
.ob-slide-enter-active,
.ob-slide-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.ob-slide-enter-from {
  opacity: 0;
  transform: translateX(24px);
}
.ob-slide-leave-to {
  opacity: 0;
  transform: translateX(-24px);
}

/* 整体淡入淡出 */
.ob-fade-enter-active,
.ob-fade-leave-active {
  transition: opacity 0.3s ease;
}
.ob-fade-enter-from,
.ob-fade-leave-to {
  opacity: 0;
}

/* 浅色模式下遮罩稍浅 */
[data-theme='light'] .onboarding-overlay,
[data-theme='apple-light'] .onboarding-overlay {
  background: rgba(240, 240, 248, 0.5);
}
</style>
