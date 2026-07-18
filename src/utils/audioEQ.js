// 10 段图式均衡器（基于 BiquadFilterNode peaking）
// 灵感来自 weq8c 的参数化 EQ 思路，但用更通用的图式 EQ 滑块 UI 方便用户调节。
//
// 关键约束：
// 1. AudioContext 是昂贵的全局资源，EQ 链与 audioAnalyser 共享同一个 ctx。
// 2. MediaElementAudioSourceNode 一个 <audio> 只能连一次，但 BiquadFilterNode
//    链是 ctx 级单例，跨 <audio> 切换时 EQ 状态保持不变。
// 3. 当 eqEnabled=false 时把所有 band gain 设为 0，peaking filter 在 0dB 处
//    是透明的，所以无需单独的旁路开关，逻辑更简单。
// 4. 切歌时新 <audio> 由 attachAudioAnalyser 处理 source 重新连接，
//    EQ 链不变（input/output 是同一对 GainNode），配置自动生效。

// 标准 10 段图式 EQ 频点（近似 ISO 1/3 倍频程），覆盖人耳主要频段
export const EQ_BANDS = [
  { freq: 31,    label: '31' },
  { freq: 62,    label: '62' },
  { freq: 125,   label: '125' },
  { freq: 250,   label: '250' },
  { freq: 500,   label: '500' },
  { freq: 1000,  label: '1K' },
  { freq: 2000,  label: '2K' },
  { freq: 4000,  label: '4K' },
  { freq: 8000,  label: '8K' },
  { freq: 16000, label: '16K' }
]

export const EQ_DB_MIN = -12
export const EQ_DB_MAX = 12
export const EQ_DB_STEP = 0.5

// 预置 EQ 曲线（dB）。参考常见播放器的图式 EQ 取值。
export const EQ_PRESETS = {
  flat:      [ 0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
  pop:       [-1,  2,  4,  4,  1, -1, -1,  1,  2,  3],
  rock:      [ 4,  3,  1,  0, -1, -1,  1,  3,  4,  4],
  jazz:      [ 3,  2,  1,  2, -1, -1,  0,  1,  2,  3],
  classical: [ 4,  3,  2,  0,  0,  0, -1, -1, -1, -2],
  electronic:[ 5,  3,  0,  0, -2,  1,  0,  1,  4,  5],
  vocal:     [-2, -1,  0,  3,  5,  5,  3,  0, -1, -2],
  bass:      [ 8,  6,  4,  2,  0,  0,  0,  0,  0,  0]
}

export const EQ_PRESET_KEYS = ['flat', 'pop', 'rock', 'jazz', 'classical', 'electronic', 'vocal', 'bass']

export const EQ_PRESET_LABELS = {
  flat: '默认',
  pop: '流行',
  rock: '摇滚',
  jazz: '爵士',
  classical: '古典',
  electronic: '电子',
  vocal: '人声',
  bass: '低音增强'
}

let audioContext = null
let eqInput = null
let eqOutput = null
let filters = []
let initialized = false

// pending 状态：在 EQ 链尚未初始化时记录用户最新配置。
// initEQ 时回放，避免"切歌后才生效"或"首次播放未应用 EQ"的延迟。
let pendingEnabled = true
let pendingBands = new Array(EQ_BANDS.length).fill(0)

function clampDb(v) {
  return Math.max(EQ_DB_MIN, Math.min(EQ_DB_MAX, Number(v) || 0))
}

function normalizeBands(arr) {
  const out = new Array(EQ_BANDS.length).fill(0)
  if (!Array.isArray(arr)) return out
  for (let i = 0; i < EQ_BANDS.length; i++) {
    out[i] = clampDb(arr[i])
  }
  return out
}

function buildChain(ctx) {
  const input = ctx.createGain()
  const output = ctx.createGain()
  const list = []
  let prev = input
  for (const band of EQ_BANDS) {
    const f = ctx.createBiquadFilter()
    f.type = 'peaking'
    f.frequency.value = band.freq
    // Q=1.0 是图式 EQ 各段之间的常用折中值
    f.Q.value = 1.0
    f.gain.value = 0
    prev.connect(f)
    prev = f
    list.push(f)
  }
  prev.connect(output)
  return { input, output, list }
}

function applyToFilters() {
  if (!initialized || filters.length === 0) return
  const target = pendingEnabled
    ? pendingBands
    : new Array(EQ_BANDS.length).fill(0)
  const t = audioContext?.currentTime ?? 0
  for (let i = 0; i < filters.length; i++) {
    // setTargetAtTime 平滑过渡 10ms，避免拖动滑块时产生爆破音
    filters[i].gain.setTargetAtTime(target[i], t, 0.01)
  }
}

/**
 * 初始化 EQ 链（幂等）。同一 ctx 多次调用返回同一组节点。
 * 必须在创建 MediaElementSource 之后、connect 到 destination 之前调用。
 */
export function initEQ(ctx) {
  if (!ctx) return null
  if (initialized && audioContext === ctx) {
    applyToFilters()
    return { input: eqInput, output: eqOutput, filters }
  }
  audioContext = ctx
  const chain = buildChain(ctx)
  eqInput = chain.input
  eqOutput = chain.output
  filters = chain.list
  initialized = true
  applyToFilters()
  return { input: eqInput, output: eqOutput, filters }
}

/**
 * 由 settings store 在每次配置变化时同步。
 * - enabled=false 时把全部 band 置 0（透明 pass-through）
 * - bands 数组自动 clamp 到 [-12, 12]
 */
export function setTargetState(enabled, bands) {
  pendingEnabled = !!enabled
  pendingBands = normalizeBands(bands)
  applyToFilters()
}

export function isEQReady() {
  return initialized
}

export function getEQState() {
  return {
    enabled: pendingEnabled,
    bands: pendingBands.slice()
  }
}

/**
 * 重置 EQ（enabled=true, 全 0dB）
 */
export function resetEQ() {
  setTargetState(true, new Array(EQ_BANDS.length).fill(0))
}

/**
 * 释放资源（应用退出时调用）。AudioContext 关闭后下次 initEQ 会重建。
 */
export function destroyEQ() {
  try { if (eqInput) eqInput.disconnect() } catch (_) {}
  try { if (eqOutput) eqOutput.disconnect() } catch (_) {}
  for (const f of filters) {
    try { f.disconnect() } catch (_) {}
  }
  audioContext = null
  eqInput = null
  eqOutput = null
  filters = []
  initialized = false
}
