<script setup>
import { useDownloadStore } from '@/stores'
import { formatAudioQualityLabel } from '@/utils/audio.js'
import { appConfirm } from '@/utils/confirm'

const downloadStore = useDownloadStore()

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
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.download-manager-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.download-manager {
  width: 90%;
  max-width: 640px;
  max-height: 80vh;
  background: var(--bg-primary);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.download-manager-header {
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
  display: flex;
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
  flex: 1;
  overflow-y: auto;
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
  gap: 10px;
  font-size: 12px;
  color: var(--text-secondary);
}

.quality-badge {
  padding: 2px 6px;
  background: var(--primary-color);
  color: white;
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
  color: #fff;
  border-color: transparent;
}

.codec-badge.dolby {
  background: linear-gradient(135deg, #00d2ff 0%, #3a7bd5 100%);
  color: #fff;
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
  color: #4caf50;
}

.status-text.error {
  color: #e81123;
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
  color: #e81123;
}
</style>
