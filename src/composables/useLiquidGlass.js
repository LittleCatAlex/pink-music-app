// === 数学工具 ===
function smoothStep(a, b, t) {
  t = Math.max(0, Math.min(1, (t - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

function length(x, y) {
  return Math.sqrt(x * x + y * y)
}

function roundedRectSDF(x, y, halfWidth, halfHeight, radius) {
  const qx = Math.abs(x) - halfWidth + radius
  const qy = Math.abs(y) - halfHeight + radius
  return Math.min(Math.max(qx, qy), 0) + length(Math.max(qx, 0), Math.max(qy, 0)) - radius
}

// === 全局管理 ===
let idCounter = 0
const instances = new Map() // id -> { el, filterEl, canvas, ctx, feImage, feDisplacementMap, width, height, fragment, options }
let mouseX = 0
let mouseY = 0
let mouseUsed = false
let rafId = null

// 鼠标进入/离开目标区域时的额外判定 padding（让效果"提前响应"）
// 32px 足够覆盖从屏幕外接近时的瞬时位移感，又不会误触发
const HOVER_PADDING = 32

function onMouseMove(e) {
  mouseX = e.clientX
  mouseY = e.clientY
  if (!mouseUsed) {
    mouseUsed = true
    // 首次进入时为所有已经在视口内的实例建立 rect，避免首次 hover 不响应
    instances.forEach((inst) => inst.updateRect())
  }
  scheduleRender()
}

// 找到当前鼠标位置命中的实例（仅返回第一个命中的）
// P0-2 修复：之前是 instances.forEach(render) 全量重画，
// 现在按 hover 范围局部 render：4 个实例时只画命中的 1 个
function pickHitInstance() {
  for (const inst of instances.values()) {
    if (inst.isMouseIn()) return inst
  }
  return null
}

function scheduleRender() {
  if (rafId !== null) return
  rafId = requestAnimationFrame(() => {
    rafId = null
    if (!mouseUsed) return
    const hit = pickHitInstance()
    if (hit) hit.render()
  })
}

function onWindowScrollOrResize() {
  // 滚动 / 窗口尺寸变化时所有 rect 失效，统一刷新
  instances.forEach((inst) => inst.updateRect())
}

function ensureMouseListeners() {
  if (instances.size === 0) return
  document.addEventListener('mousemove', onMouseMove, { passive: true })
  window.addEventListener('scroll', onWindowScrollOrResize, { passive: true, capture: true })
  window.addEventListener('resize', onWindowScrollOrResize, { passive: true })
}

function maybeRemoveMouseListeners() {
  if (instances.size === 0) {
    document.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('scroll', onWindowScrollOrResize, { capture: true })
    window.removeEventListener('resize', onWindowScrollOrResize)
  }
}

class LiquidGlassInstance {
  constructor(target, options) {
    this.id = `lg-${++idCounter}-${Date.now().toString(36)}`
    this.target = target
    this.options = options
    this.width = options.width || target.offsetWidth || 300
    this.height = options.height || target.offsetHeight || 60
    this.fragment = options.fragment || this.defaultFragment
    this.reactiveToMouse = options.reactiveToMouse !== false
    // 缓存目标元素的视口位置；命中检测复用，避免每次 mousemove 调 getBoundingClientRect 触发 reflow
    this.rect = null

    this.createSvg()
    this.createCanvas()
    this.updateRect()
    this.render()
    this.applyToTarget()
  }

  // 刷新 rect 缓存：构造、resize、scroll/resize 时调用
  updateRect() {
    if (!this.target) {
      this.rect = null
      return
    }
    const r = this.target.getBoundingClientRect()
    this.rect = {
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom
    }
  }

  // 鼠标是否在目标范围内（含 HOVER_PADDING 提前响应区）
  isMouseIn() {
    if (!this.rect) return false
    if (!this.reactiveToMouse) return false
    const r = this.rect
    return (
      mouseX >= r.left - HOVER_PADDING &&
      mouseX <= r.right + HOVER_PADDING &&
      mouseY >= r.top - HOVER_PADDING &&
      mouseY <= r.bottom + HOVER_PADDING
    )
  }

  defaultFragment(uv) {
    const ix = uv.x - 0.5
    const iy = uv.y - 0.5
    // 使用到最近边的距离，能自动适应任意长宽比
    const distToEdge = Math.min(0.5 - Math.abs(ix), 0.5 - Math.abs(iy))
    const edgeSoftness = this.options.edgeSoftness ?? 0.4
    const edgeDepth = this.options.depth ?? 0.15
    // 在边缘产生强位移，在中心不变形
    const displacement = smoothStep(edgeSoftness, 0, distToEdge - edgeDepth)
    // 用反相曲线：displacement=1 时边缘强收缩，displacement=0 时中心无变形
    const scaled = 1 - smoothStep(0, 1, displacement) * 0.95
    return { x: ix * scaled + 0.5, y: iy * scaled + 0.5 }
  }

  createSvg() {
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    this.svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    this.svg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
    this.svg.setAttribute('width', '0')
    this.svg.setAttribute('height', '0')
    this.svg.style.cssText = 'position: fixed; top: 0; left: 0; pointer-events: none; z-index: -1;'

    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs')
    const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter')
    filter.setAttribute('id', this.id)
    filter.setAttribute('color-interpolation-filters', 'sRGB')
    filter.setAttribute('x', '0')
    filter.setAttribute('y', '0')
    filter.setAttribute('width', this.width.toString())
    filter.setAttribute('height', this.height.toString())

    this.feImage = document.createElementNS('http://www.w3.org/2000/svg', 'feImage')
    this.feImage.setAttribute('id', `${this.id}_map`)
    this.feImage.setAttribute('width', this.width.toString())
    this.feImage.setAttribute('height', this.height.toString())

    this.feDisplacementMap = document.createElementNS('http://www.w3.org/2000/svg', 'feDisplacementMap')
    this.feDisplacementMap.setAttribute('in', 'SourceGraphic')
    this.feDisplacementMap.setAttribute('in2', `${this.id}_map`)
    this.feDisplacementMap.setAttribute('xChannelSelector', 'R')
    this.feDisplacementMap.setAttribute('yChannelSelector', 'G')

    filter.appendChild(this.feImage)
    filter.appendChild(this.feDisplacementMap)
    defs.appendChild(filter)
    this.svg.appendChild(defs)

    document.body.appendChild(this.svg)
  }

  createCanvas() {
    this.canvas = document.createElement('canvas')
    this.canvas.width = Math.floor(this.width)
    this.canvas.height = Math.floor(this.height)
    this.canvas.style.display = 'none'
    this.ctx = this.canvas.getContext('2d')
  }

  render() {
    if (!this.ctx) return
    const w = this.canvas.width
    const h = this.canvas.height
    const data = new Uint8ClampedArray(w * h * 4)
    const rawValues = []
    let maxScale = 0

    for (let i = 0; i < data.length; i += 4) {
      const x = (i / 4) % w
      const y = Math.floor(i / 4 / w)
      const uv = { x: x / w, y: y / h }
      const pos = this.fragment(uv)
      const dx = pos.x * w - x
      const dy = pos.y * h - y
      maxScale = Math.max(maxScale, Math.abs(dx), Math.abs(dy))
      rawValues.push(dx, dy)
    }

    maxScale = maxScale * 0.5 || 1
    // 放大整体位移强度，让液体玻璃效果更明显
    const amplifiedScale = maxScale * 1.6

    let index = 0
    for (let i = 0; i < data.length; i += 4) {
      const r = rawValues[index++] / maxScale + 0.5
      const g = rawValues[index++] / maxScale + 0.5
      data[i] = Math.max(0, Math.min(255, r * 255))
      data[i + 1] = Math.max(0, Math.min(255, g * 255))
      data[i + 2] = 0
      data[i + 3] = 255
    }

    this.ctx.putImageData(new ImageData(data, w, h), 0, 0)
    this.feImage.setAttributeNS('http://www.w3.org/1999/xlink', 'href', this.canvas.toDataURL())
    this.feDisplacementMap.setAttribute('scale', amplifiedScale.toFixed(2))
  }

  applyToTarget() {
    const existingFilter = this.target.style.backdropFilter || this.target.style.webkitBackdropFilter
    const newFilter = `url(#${this.id})`
    if (existingFilter && existingFilter.includes(newFilter)) return
    this.target.style.backdropFilter = `${newFilter} ${this.options.backdrop || ''}`.trim()
    this.target.style.webkitBackdropFilter = `${newFilter} ${this.options.backdrop || ''}`.trim()
  }

  destroy() {
    if (this.svg) this.svg.remove()
    if (this.canvas) this.canvas = null
  }
}

/**
 * 在元素上应用 liquid glass 效果
 * @param {HTMLElement|string} target 目标元素或选择器
 * @param {Object} options
 *   - width: 元素宽度（默认自动）
 *   - height: 元素高度（默认自动）
 *   - radius: 边缘 SDF 圆角 (0-1, 默认 0.6)
 *   - depth: 边缘凸起深度 (0-1, 默认 0.15)
 *   - edgeSoftness: 边缘软度 (0-1, 默认 0.8)
 *   - backdrop: 附加的 backdrop-filter 字符串，如 "blur(0.25px) contrast(1.2)"
 *   - reactiveToMouse: 是否随鼠标位置变化 (默认 true)
 */
export function applyLiquidGlass(target, options = {}) {
  if (!target) return null
  const el = typeof target === 'string' ? document.querySelector(target) : target
  if (!el) return null

  // 更新尺寸为实际元素尺寸
  if (!options.width) options.width = el.offsetWidth
  if (!options.height) options.height = el.offsetHeight

  const inst = new LiquidGlassInstance(el, options)
  instances.set(inst.id, inst)
  ensureMouseListeners()
  return inst
}

export function destroyLiquidGlass(id) {
  const inst = instances.get(id)
  if (inst) {
    inst.destroy()
    instances.delete(id)
    maybeRemoveMouseListeners()
  }
}

export function destroyAllLiquidGlass() {
  instances.forEach((inst) => inst.destroy())
  instances.clear()
  document.removeEventListener('mousemove', onMouseMove)
}

// 全局 reactive 鼠标位置
export function getLiquidGlassMouse() {
  return { x: mouseX, y: mouseY }
}

export { LiquidGlassInstance }
