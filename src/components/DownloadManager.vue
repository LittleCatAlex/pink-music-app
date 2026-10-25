<script setup>
import { ref } from 'vue'
import { useDownloadStore, useLocalStore } from '@/stores'
import { formatAudioQualityLabel } from '@/utils/audio.js'
import { appConfirm } from '@/utils/confirm'

const downloadStore = useDownloadStore()
const localStore = useLocalStore()

// 正在「加入本地库」的任务 id（防重复点击）
const addingIds = ref(new Set())

function close() {
  downloadStore.setShowDownloadManager(false)
}

function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return '-'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

function formatTime(timestamp) {
  if (!timestamp) return '-'
  const date = new Date(timestamp)
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function getStatusText(status) {
  const map = {
    waiting: '等待中',
    downloading: '下载中',
    completed: '已完成',
    error: '失败'
  }
  return map[status] || status
}

async function openDownloadFolder() {
  if (window.electronAPI) {
    await window.electronAPI.openDownloadFolder()
  }
}

function isAdding(task) {
  return addingIds.value.has(task.id)
}

/** 在系统文件管理器中定位已下载的文件 */
async function revealTaskFile(task) {
  if (!task?.filePath) return
  try {
    await window.electronAPI?.local?.revealFile(task.filePath)
  } catch (_) {}
}

/** 把下载完成的文件解析成一条本地曲目，写进本地音乐库（store 侧写回由别处负责，这里只消费） */
async function addTaskToLibrary(task) {
  const filePath = task?.filePath
  if (!filePath || isAdding(task)) return
  const api = window.electronAPI?.local
  if (!api) return alert('加入本地库仅在 Electron 环境中可用')
  addingIds.value = new Set(addingIds.value).add(task.id)
  try {
    const res = await api.parseMetadata([filePath])
    const track = res?.code === 0 && Array.isArray(res.data) ? res.data[0] : null
    if (!track) return alert(res?.message || '解析文件失败')
    const { added, skipped } = await localStore.addTracks([track])
    if (added > 0) alert(`已加入本地库：${track.title || track.fileName || filePath}`)
    else if (skipped > 0) alert('该文件已在本地音乐库中')
    else alert('加入本地库失败')
  } catch (e) {
    alert('加入本地库失败：' + (e?.message || e))
  } finally {
    const next = new Set(addingIds.value)
    next.delete(task.id)
    addingIds.value = next
  }
}

async function clearTasks() {
  const ok = await appConfirm({
    title: '清空下载记录',
    message: '确定要清空所有下载记录吗？',
    detail: '已下载的文件不会被删除，仅清空历史列表。',
    confirmText: '清空',
    cancelText: '取消'
  })
  if (ok) {
    await downloadStore.clearTasks()
  }
}
</script>

<template>
  <div v-if="downloadStore.showDownloadManager" class="download-manager-overlay" @click.self="close">
    <div class="download-manager">
      <div class="download-manager-header">
        <h2>下载管理</h2>
        <button class="close-btn" @click="close">
          <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
          </svg>
        </button>
      </div>

      <div class="download-manager-actions">
        <button class="action-btn" @click="openDownloadFolder">
          <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
            <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
          </svg>
          <span>打开下载目录</span>
        </button>
        <button class="action-btn" @click="clearTasks" :disabled="downloadStore.tasks.length === 0">
          <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
          </svg>
          <span>清空记录</span>
        </button>
      </div>

      <div class="download-list">
        <div v-if="downloadStore.tasks.length === 0" class="empty-list">
          <p>暂无下载任务</p>
        </div>
        <div
          v-for="task in downloadStore.tasks"
          :key="task.id"
          class="download-item"
          :class="task.status"
        >
          <div class="download-item-info">
            <div class="download-item-title">{{ task.title }}</div>
            <div class="download-item-meta">
              <span class="quality-badge">{{ formatAudioQualityLabel(task.quality) }}</span>
              <span>{{ formatFileSize(task.totalBytes) }}</span>
              <span>{{ formatTime(task.createdTime) }}</span>
            </div>
          </div>
          <div v-if="task.filePath" class="download-item-path" :title="task.filePath">
            {{ task.filePath }}
          </div>
          <div class="download-item-status">
            <span class="status-text" :class="task.status">{{ getStatusText(task.status) }}</span>
          </div>
          <div v-if="task.status === 'downloading' || task.status === 'waiting'" class="download-item-progress">
            <div class="progress-bar">
              <div class="progress-fill" :style="{ width: task.progress + '%' }"></div>
            </div>
            <span class="progress-text">{{ task.progress }}%</span>
          </div>
          <div v-if="task.status === 'error' && task.error" class="download-item-error">
            {{ task.error }}
          </div>
          <div v-if="task.status === 'completed' && task.filePath" class="download-item-actions">
            <button class="task-btn" @click="revealTaskFile(task)">在文件夹中显示</button>
            <button class="task-btn" :disabled="isAdding(task)" @click="addTaskToLibrary(task)">
              {{ isAdding(task) ? '加入中…' : '加入本地库' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.download-manager-overlay {
  position: fixed;
  inset: 0;
  background: var(--bg-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  /* 层级：A1 全局 token + 数值兜底 → 170，高于播放页(150)与 Dock(70)，
     低于 WindowControls(--z-window-controls: 900) */
  z-index: calc(var(--z-player-page, 150) + 20);
  /* 面板给底部「播放栏 + Dock」让位：
     --shell-bottom-reserve 由 A1 的 --shell-* 派生（播发栏 + Dock + 间距），
     兜底 = --player-height + Dock 占位；顶部让开拖拽条 --shell-dragbar-height */
  padding:
    calc(var(--shell-dragbar-height, 38px) + 10px)
    16px
    var(--shell-bottom-reserve, calc(var(--player-height, 100px) + 118px));
  -webkit-app-region: no-drag;
}

.download-manager {
  width: 90%;
  max-width: 640px;
  /* 高度吃掉 .download-manager-overlay 让位后的全部可用空间：
     不再用 80vh 魔法值（1000×700 下 80vh 会压到 Dock 与播放栏） */
  max-height: 100%;
  min-height: 0;
  background: var(--bg-primary);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.download-manager-header {
  flex: 0 0 auto;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color);
}

.download-manager-header h2 {
  margin: 0;
  font-size: 18px;
  color: var(--text-primary);
}

.close-btn {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.close-btn:hover {
  color: var(--text-primary);
}

.download-manager-actions {
  /* 不被压缩；宽度不够时换行而不是溢出/裁切（按钮不会消失） */
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color);
}

.action-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  font-size: 13px;
  color: var(--text-primary);
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.action-btn:hover:not(:disabled) {
  border-color: var(--primary-color);
  color: var(--primary-color);
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.download-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 12px 20px 20px;
}

.empty-list {
  text-align: center;
  padding: 40px 0;
  color: var(--text-secondary);
}

.download-item {
  padding: 14px;
  background: var(--bg-card);
  border-radius: var(--radius-md);
  margin-bottom: 10px;
  border: 1px solid var(--border-color);
}

.download-item-info {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 8px;
}

.download-item-title {
  font-size: 14px;
  color: var(--text-primary);
  font-weight: 500;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.download-item-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  row-gap: 4px;
  gap: 10px;
  font-size: 12px;
  color: var(--text-secondary);
  min-width: 0;
}

.quality-badge {
  padding: 2px 6px;
  background: var(--primary-color);
  color: var(--text-primary);
  border-radius: 4px;
  font-size: 11px;
}

.codec-badge {
  padding: 2px 6px;
  background: var(--bg-secondary, rgba(255, 255, 255, 0.1));
  color: var(--text-secondary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.5px;
}

.codec-badge.flac {
  background: linear-gradient(135deg, #ff6b9d 0%, #c06c84 100%);
  color: var(--text-primary);
  border-color: transparent;
}

.codec-badge.dolby {
  background: linear-gradient(135deg, #00d2ff 0%, #3a7bd5 100%);
  color: var(--text-primary);
  border-color: transparent;
}

.download-item-status {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 6px;
}

.status-text {
  font-size: 12px;
  font-weight: 500;
}

.status-text.completed {
  color: var(--success-color);
}

.status-text.error {
  color: var(--error-color);
}

.status-text.downloading {
  color: var(--primary-color);
}

.status-text.waiting {
  color: var(--text-secondary);
}

.download-item-progress {
  display: flex;
  align-items: center;
  gap: 10px;
}

.progress-bar {
  flex: 1;
  height: 4px;
  background: var(--border-color);
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--primary-color);
  border-radius: 2px;
  transition: width 0.3s ease;
}

.progress-text {
  font-size: 12px;
  color: var(--text-secondary);
  min-width: 36px;
  text-align: right;
}

.download-item-error {
  margin-top: 8px;
  font-size: 12px;
  color: var(--error-color);
}

.download-item-path {
  margin-bottom: 6px;
  font-size: 11px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.download-item-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.task-btn {
  padding: 5px 10px;
  font-size: 12px;
  color: var(--text-primary);
  background: var(--bg-secondary, rgba(255, 255, 255, 0.06));
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.task-btn:hover:not(:disabled) {
  border-color: var(--primary-color);
  color: var(--primary-color);
}

.task-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 所有可点元素显式 no-drag */
.download-manager button {
  -webkit-app-region: no-drag;
}

/* 按钮降级阶梯：① 缩内边距 → ② 只留图标（文字视觉隐藏，可访问名称保留）
   两个必测尺寸（1470×930 / 1000×700）下换行已足够，这两档只在更窄时生效 */
@media (max-width: 720px) {
  .download-manager-actions {
    gap: 8px;
    padding: 12px 14px;
  }
  .download-manager-actions .action-btn {
    padding: 8px 10px;
  }
}
@media (max-width: 520px) {
  .download-manager-actions .action-btn span {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
}
</style>
