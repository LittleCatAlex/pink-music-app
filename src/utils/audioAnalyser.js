// 音频分析器单例：把 <audio> 元素接到 Web Audio API 的 AnalyserNode
// 用于大屏播放页的频谱可视化。AudioContext 是昂贵的全局资源，跨页面共享。
//
// 关键约束：
// 1. MediaElementAudioSourceNode 一个 <audio> 只能连一次，
//    所以每次 App.vue 重建 audioElement 时必须重新 attach。
// 2. AudioContext 在浏览器自动播放策略下必须由用户手势创建或 resume，
//    我们在用户首次点击播放/打开大屏时 lazy 创建。
// 3. 切歌时旧的 source 自动停止（无引用），新 source 由 attach 接管。
// 4. 信号链路：
//      source → EQ 链(10 段 BiquadFilter) → analyser → compressor → destination
//    compressor 是安全限幅器：EQ 任何 boost 一旦把信号推过阈值就自动压回安全区，
//    防止低频叠加 / 预置过激导致 destination 处数字削波（"麦炸了"）。

import { initEQ, destroyEQ } from './audioEQ'

let audioContext = null
let currentSource = null
let currentAudio = null
let analyser = null
let compressor = null  // 安全限幅器：analyser → compressor → destination

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
    // 旧元素解绑：断开 source 和 analyser，无引用后会被 GC
    if (currentSource) {
      try { currentSource.disconnect() } catch (_) {}
    }
    if (analyser) {
      try { analyser.disconnect() } catch (_) {}
    }
    currentAudio = audioEl
    currentSource = ctx.createMediaElementSource(audioEl)
    analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.75

    // 把 EQ 链串到 source 和 analyser 之间
    // signal chain: source → eq.input → [10 biquad] → eq.output → analyser
    const eq = initEQ(ctx)
    if (eq) {
      currentSource.connect(eq.input)
      eq.output.connect(analyser)
    } else {
      currentSource.connect(analyser)
    }

    // 安全限幅器：ctx 级单例，跨切歌保持同一实例
    // - threshold -6dB：信号超过 -6dBFS 才开始介入
    // - knee 6dB：软拐点，过渡平滑不"咔哒"
    // - ratio 4:1：温和限制，不会把音乐压成"贴地砖"
    // - attack 3ms / release 250ms：能抓住 kick 瞬态，听感不"喘气"
    if (!compressor) {
      compressor = ctx.createDynamicsCompressor()
      compressor.threshold.value = -6
      compressor.knee.value = 6
      compressor.ratio.value = 4
      compressor.attack.value = 0.003
      compressor.release.value = 0.25
      compressor.connect(ctx.destination)
    }
    analyser.connect(compressor)
    return analyser
  } catch (err) {
    console.error('[audioAnalyser] attach 失败:', err)
    // 半初始化回滚：否则下次 attach 会因 currentAudio 已记录而误判为已连接
    try { if (currentSource) currentSource.disconnect() } catch (_) {}
    try { if (analyser) analyser.disconnect() } catch (_) {}
    currentAudio = null
    currentSource = null
    analyser = null
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
 * 释放资源（应用退出时调用）。可安全重复调用。
 */
export function destroyAudioAnalyser() {
  try { if (currentSource) currentSource.disconnect() } catch (_) {}
  try { if (analyser) analyser.disconnect() } catch (_) {}
  try { if (compressor) compressor.disconnect() } catch (_) {}
  try { destroyEQ() } catch (_) {}
  // 先清空模块级状态，重复调用时直接空转
  const ctx = audioContext
  audioContext = null
  currentSource = null
  currentAudio = null
  analyser = null
  compressor = null
  if (ctx) {
    try {
      if (ctx.state !== 'closed') ctx.close().catch(() => {})
    } catch (_) {}
  }
}
