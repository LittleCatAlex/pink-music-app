import { defineStore } from 'pinia'

// 仍在进行中的任务状态：只有它们允许「带外出现」时补回列表
const ACTIVE_STATUSES = ['downloading', 'waiting', 'pending']

export const useDownloadStore = defineStore('download', {
  state: () => ({
    tasks: [],
    showDownloadManager: false
  }),
  actions: {
    setShowDownloadManager(show) {
      this.showDownloadManager = show
    },
    setTasks(tasks) {
      this.tasks = tasks
    },
    addTaskLocal(task) {
      const exists = this.tasks.some(t => t.id === task.id)
      if (!exists) {
        this.tasks.unshift(task)
      }
    },
    updateTask(task) {
      const index = this.tasks.findIndex(t => t.id === task.id)
      if (index > -1) {
        const prev = this.tasks[index]
        const merged = { ...prev, ...task }
        // 进度帧可能不带 filePath（或带空值），不能把已拿到的落盘路径抹掉
        if (!merged.filePath && prev.filePath) merged.filePath = prev.filePath
        this.tasks[index] = merged
      } else if (ACTIVE_STATUSES.includes(task.status)) {
        // 清空列表后主进程仍会推来终态帧：只补回进行中的任务，
        // 否则已完成的旧任务会「复活」在列表里
        this.tasks.unshift(task)
      }
    },
    async loadTasks() {
      if (!window.electronAPI) return
      try {
        const result = await window.electronAPI.getDownloadTasks()
        if (result?.code === 0 && Array.isArray(result.data)) {
          this.tasks = result.data
        }
      } catch (error) {
        console.error('加载下载任务失败:', error)
      }
    },
    async addTask(taskInfo) {
      if (!window.electronAPI) {
        alert('下载功能仅在 Electron 环境中可用')
        return
      }

      const waitingTask = {
        id: `dl_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
        title: taskInfo.title || taskInfo.fileName || '未知文件',
        author: taskInfo.author || '',
        bvid: taskInfo.bvid || '',
        cid: taskInfo.cid || '',
        quality: taskInfo.quality || 'auto',
        fileName: taskInfo.fileName || '',
        status: 'waiting',
        progress: 0,
        totalBytes: 0,
        downloadedBytes: 0,
        createdTime: Date.now(),
        error: ''
      }
      this.addTaskLocal(waitingTask)

      try {
        // 把渲染层生成的 id 一起传过去，主进程用同一个 id 维护任务，
        // 避免 broadcastDownloadProgress 推回时因 id 不匹配而新增重复条目
        const result = await window.electronAPI.downloadAudio({
          ...taskInfo,
          id: waitingTask.id,
          title: waitingTask.title,
          author: waitingTask.author
        })
        if (result.code !== 0) {
          const task = this.tasks.find(t => t.id === waitingTask.id)
          if (task) {
            task.status = 'error'
            task.error = result.message || '下载失败'
          }
        }
      } catch (error) {
        const task = this.tasks.find(t => t.id === waitingTask.id)
        if (task) {
          task.status = 'error'
          task.error = error.message || '下载失败'
        }
      }
    },
    async clearTasks() {
      if (!window.electronAPI) return
      try {
        await window.electronAPI.clearDownloadTasks()
        this.tasks = []
      } catch (error) {
        console.error('清空下载任务失败:', error)
      }
    },
    registerProgressListener() {
      if (!window.electronAPI || !window.electronAPI.onDownloadProgress) return
      this._unsubscribeProgress = window.electronAPI.onDownloadProgress((task) => {
        this.updateTask(task)
      })
    },
    unregisterProgressListener() {
      if (this._unsubscribeProgress) {
        this._unsubscribeProgress()
        this._unsubscribeProgress = null
      }
    }
  }
})
