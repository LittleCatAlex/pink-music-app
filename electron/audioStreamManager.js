const axios = require('axios')
const fs = require('fs')
const path = require('path')
const cacheManager = require('./cacheManager')

class AudioStreamManager {
  constructor() {
    this.activeDownloads = new Map()
    this.concurrentLimit = 5
  }

  // 生成标准请求头
  getStandardHeaders(cookies = {}) {
    return {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      'Referer': 'https://www.bilibili.com/',
      'Cookie': Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')
    }
  }

  // 流式下载音频（支持Range请求）
  async streamDownload(bvid, audioUrl, quality = 'mp3', cookies = {}) {
    return new Promise((resolve, reject) => {
      const cachePath = cacheManager.getCacheFilePath(bvid, quality)
      const writeStream = fs.createWriteStream(cachePath)
      
      // 记录下载状态
      const downloadId = `${bvid}_${quality}`
      const downloadInfo = {
        bvid,
        audioUrl,
        quality,
        progress: 0,
        totalSize: 0,
        isComplete: false,
        settled: false,
        responseStream: null,
        writeStream,
        resolve,
        reject,
        abort: null
      }
      
      this.activeDownloads.set(downloadId, downloadInfo)

      // 失败/取消统一出口：放掉流 + 删掉半截缓存文件，并 reject 掉等待中的 Promise。
      // 不删文件的话，残包会留在缓存目录里，下次还可能被当成"已缓存"命中。
      const fail = (error) => {
        if (downloadInfo.settled) return
        downloadInfo.settled = true
        this.activeDownloads.delete(downloadId)
        try { downloadInfo.responseStream?.destroy() } catch (_) {}
        try { writeStream.destroy() } catch (_) {}
        const removePartial = () => {
          try {
            if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath)
          } catch (e) {
            console.warn('删除半截缓存文件失败:', e.message)
          }
        }
        // 写流未关闭时文件仍被占用（Windows 不允许删除），等 close 事件再删
        if (writeStream.closed) removePartial()
        else writeStream.once('close', removePartial)
        reject(error)
      }
      downloadInfo.abort = fail

      // 先发送HEAD请求获取文件大小
      axios.head(audioUrl, {
        headers: this.getStandardHeaders(cookies),
        timeout: 30000
      })
      .then(headResponse => {
        const contentLength = Number(headResponse.headers['content-length'] || headResponse.headers['Content-Length'])
        const hasContentLength = Number.isFinite(contentLength) && contentLength > 0
        if (hasContentLength) downloadInfo.totalSize = contentLength
        
        // 发起Range请求下载整个文件。长度未知时不发 Range，
        // 否则会拼出 'bytes=0-NaN' 这种非法头（服务端返回 416 或空响应）
        const headers = this.getStandardHeaders(cookies)
        if (hasContentLength) headers['Range'] = `bytes=0-${contentLength - 1}`

        const response = axios.get(audioUrl, {
          headers,
          responseType: 'stream',
          timeout: 60000
        })

        response.then(res => {
          if (downloadInfo.settled) {
            try { res.data.destroy() } catch (_) {}
            return
          }
          downloadInfo.responseStream = res.data

          // 只有 206 + 合法 Content-Range 才算分段真正生效；
          // 服务端忽略 Range（返回 200）或没回 Content-Range 时按整段下载处理，
          // 总长改用响应自身的 content-length，进度才不会被算错。
          const contentRange = String(res.headers['content-range'] || res.headers['Content-Range'] || '')
          const rangeTotal = Number((contentRange.match(/\/(\d+)\s*$/) || [])[1])
          const responseSize = Number(res.headers['content-length'] || res.headers['Content-Length'])
          const isPartial = res.status === 206 && Number.isFinite(rangeTotal) && rangeTotal > 0
          const fallbackSize = Number.isFinite(responseSize) && responseSize > 0 ? responseSize : downloadInfo.totalSize
          downloadInfo.totalSize = isPartial ? rangeTotal : (Number.isFinite(fallbackSize) ? fallbackSize : 0)

          let downloadedSize = 0
          let lastPersistAt = 0
          const PERSIST_INTERVAL_MS = 500

          res.data.on('data', (chunk) => {
            downloadedSize += chunk.length
            downloadInfo.progress = downloadInfo.totalSize > 0
              ? Math.min(100, Math.round((downloadedSize / downloadInfo.totalSize) * 100))
              : 0

            // 进度只更新内存；磁盘索引节流写，避免每个 chunk 全量写 cache.db.json
            const now = Date.now()
            if (now - lastPersistAt >= PERSIST_INTERVAL_MS) {
              lastPersistAt = now
              cacheManager.saveCacheInfo(bvid, quality, {
                url: audioUrl,
                path: cachePath,
                size: downloadInfo.totalSize,
                downloaded: downloadedSize,
                progress: downloadInfo.progress,
                quality
              })
            }
          })

          writeStream.on('finish', () => {
            if (downloadInfo.settled) return
            downloadInfo.settled = true
            downloadInfo.isComplete = true
            downloadInfo.progress = 100

            // 完成时立即落盘一次最终状态
            cacheManager.saveCacheInfo(bvid, quality, {
              url: audioUrl,
              path: cachePath,
              size: downloadInfo.totalSize || downloadedSize,
              downloaded: downloadedSize,
              progress: 100,
              quality,
              completed: true
            }, { immediate: true })

            this.activeDownloads.delete(downloadId)
            resolve({ success: true, path: cachePath })
          })

          writeStream.on('error', (error) => {
            console.error('写入文件失败:', error)
            fail(error)
          })

          // 响应流中断同样要 reject + 清理，否则 Promise 永远悬挂
          res.data.on('error', (error) => {
            console.error('下载流中断:', error)
            fail(error)
          })

          // 监听器全部就位后再开闸，避免首包错误早于 handler 注册
          res.data.pipe(writeStream)

        }).catch(error => {
          console.error('下载失败:', error)
          fail(error)
        })

      }).catch(error => {
        console.error('获取文件大小失败:', error)
        fail(error)
      })
    })
  }

  // 获取音频流（用于播放）
  async getAudioStream(audioUrl, cookies = {}) {
    try {
      const response = await axios.get(audioUrl, {
        headers: this.getStandardHeaders(cookies),
        responseType: 'stream',
        timeout: 30000
      })
      return response.data
    } catch (error) {
      console.error('获取音频流失败:', error)
      throw error
    }
  }

  // 获取缓存或下载
  async getAudioPath(bvid, audioUrl, quality = 'mp3', cookies = {}) {
    // 检查缓存
    if (cacheManager.hasCache(bvid, quality)) {
      const cacheInfo = cacheManager.getCacheInfo(bvid, quality)
      if (cacheInfo && cacheInfo.completed) {
        return { success: true, path: cacheManager.getCacheFilePath(bvid, quality), fromCache: true }
      }
    }

    // 开始下载
    try {
      const result = await this.streamDownload(bvid, audioUrl, quality, cookies)
      return { ...result, fromCache: false }
    } catch (error) {
      console.error('获取音频失败:', error)
      return { success: false, error: error.message }
    }
  }

  // 获取下载进度
  getDownloadProgress(bvid, quality = 'mp3') {
    const downloadId = `${bvid}_${quality}`
    const downloadInfo = this.activeDownloads.get(downloadId)
    if (downloadInfo) {
      return {
        progress: downloadInfo.progress,
        totalSize: downloadInfo.totalSize,
        isComplete: downloadInfo.isComplete
      }
    }
    
    // 检查缓存信息
    const cacheInfo = cacheManager.getCacheInfo(bvid, quality)
    if (cacheInfo) {
      return {
        progress: cacheInfo.progress || 0,
        totalSize: cacheInfo.size || 0,
        isComplete: cacheInfo.completed || false
      }
    }
    
    return { progress: 0, totalSize: 0, isComplete: false }
  }

  // 取消下载
  cancelDownload(bvid, quality = 'mp3') {
    const downloadId = `${bvid}_${quality}`
    const downloadInfo = this.activeDownloads.get(downloadId)
    if (!downloadInfo) return
    // 必须走 reject 路径：只 destroy 写流的话，等待中的 streamDownload Promise
    // 永远不会 settle，await 它的 getAudioPath / batchDownload 会永久挂起。
    if (typeof downloadInfo.abort === 'function') {
      downloadInfo.abort(new Error('下载已取消'))
      return
    }
    if (downloadInfo.writeStream) {
      downloadInfo.writeStream.destroy()
    }
    this.activeDownloads.delete(downloadId)
  }

  // 批量下载（控制并发）
  async batchDownload(downloads, cookies = {}) {
    const results = []
    const queue = [...downloads]
    
    async function processQueue() {
      if (queue.length === 0) return
      
      const task = queue.shift()
      try {
        const result = await audioStreamManager.getAudioPath(
          task.bvid,
          task.audioUrl,
          task.quality || 'mp3',
          cookies
        )
        results.push({ bvid: task.bvid, ...result })
      } catch (error) {
        results.push({ bvid: task.bvid, success: false, error: error.message })
      }
      
      await processQueue()
    }

    // 控制并发数
    const workers = []
    for (let i = 0; i < Math.min(this.concurrentLimit, downloads.length); i++) {
      workers.push(processQueue())
    }

    await Promise.all(workers)
    return results
  }
}

const audioStreamManager = new AudioStreamManager()
module.exports = audioStreamManager