// 音频分析器单例：把 <audio> 元素接到 Web Audio API 的 AnalyserNode
// 用于大屏播放页的频谱可视化。AudioContext 是昂贵的全局资源，跨页面共享。
//
// 关键约束：
// 1. MediaElementAudioSourceNode 一个 <audio> 只能连一次，
//    所以每次 App.vue 重建 audioElement 时必须重新 attach。
// 2. AudioContext 在浏览器自动播放策略下必须由用户手势创建或 resume，
//    我们在用户首次点击播放/打开大屏时 lazy 创建。
// 3. 切歌时旧的 source 自动停止（无引用），新 source 由 attach 接管。
// 4. 信号链路：source → EQ 链（10 段 BiquadFilter）→ analyser → destination。

import { initEQ, destroyEQ } from './audioEQ'

let audioContext = null
let currentSource = null
let currentAudio = null
let analyser = null

function ensureContext() {
  if (audioContext) return audioContext
  const Ctor = window.AudioContext || window.webkitAudioContext
  if (!Ctor) return null
  audioContext = new Ctor()
  return audioContext
}

/**
 * 把一个 HTMLAudioElement 接到分析器。
 * - 同一元素重复 attach 不会重建 source。
 * - 新元素会替换旧 source（旧 source 无引用后被 GC）。
 * - EQ 链是 ctx 级单例，首次 attach 时创建，配置由 audioEQ 模块管理。
 */
export function attachAudioAnalyser(audioEl) {
  if (!audioEl) return null
  const ctx = ensureContext()
  if (!ctx) return null

  // 自动播放策略：很多浏览器要求 AudioContext 处于 running 状态。
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {})
  }

  // 同一个 audio 元素重复调用时，直接复用旧 source
  if (currentAudio === audioEl && currentSource && analyser) {
    return analyser
  }

  try {
    // 旧元素解绑：断开 source 即可，无引用后会被 GC
    if (currentSource) {
      try { currentSource.disconnect() } catch (_) {}
    }
    currentAudio = audioEl
    currentSource = ctx.createMediaElementSource(audioEl)
    analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.75

    // 把 EQ 链串到 source 和 analyser 之间
    // signal chain: source → eq.input → [10 biquad] → eq.output → analyser → destination
    const eq = initEQ(ctx)
    if (eq) {
      currentSource.connect(eq.input)
      eq.output.connect(analyser)
    } else {
      currentSource.connect(analyser)
    }
    // 关键：analyser 也要连到 destination，否则音频会被 mute
    analyser.connect(ctx.destination)
    return analyser
  } catch (err) {
    console.error('[audioAnalyser] attach 失败:', err)
    return null
  }
}

export function getAnalyser() {
  return analyser
}

export function getAudioContext() {
  return audioContext
}

export function isAnalyserReady() {
  return !!analyser && !!currentAudio
}

/**
 * 释放资源（应用退出时调用）
 */
export function destroyAudioAnalyser() {
  try { if (currentSource) currentSource.disconnect() } catch (_) {}
  try { if (analyser) analyser.disconnect() } catch (_) {}
  destroyEQ()
  if (audioContext) {
    audioContext.close().catch(() => {})
  }
  audioContext = null
  currentSource = null
  currentAudio = null
  analyser = null
}
