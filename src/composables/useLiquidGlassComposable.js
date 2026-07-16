import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { applyLiquidGlass, destroyLiquidGlass } from './liquidGlassCore'

/**
 * 在组件中应用 liquid glass 效果
 * 用法：
 *   const dockRef = ref(null)
 *   useLiquidGlass(dockRef, { depth: 0.2, edgeSoftness: 0.7 })
 */
export function useLiquidGlass(targetRef, options = {}) {
  let instance = null
  let resizeObserver = null

  onMounted(async () => {
    await nextTick()
    if (!targetRef.value) return
    instance = applyLiquidGlass(targetRef.value, options)

    if (options.watchResize !== false && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        // 元素尺寸变化时只刷新 rect 缓存 + 重画一帧
        // 之前是 destroy + applyLiquidGlass，每次都会重建 canvas/SVG/feImage，开销很大
        if (instance && targetRef.value) {
          const newWidth = targetRef.value.offsetWidth
          const newHeight = targetRef.value.offsetHeight
          if (newWidth && newHeight && (newWidth !== instance.width || newHeight !== instance.height)) {
            // 尺寸真的变了才重建（避免移动 1px 也重建）
            if (!options.width) options.width = newWidth
            if (!options.height) options.height = newHeight
            destroyLiquidGlass(instance.id)
            instance = applyLiquidGlass(targetRef.value, options)
          } else {
            instance.updateRect()
            instance.render()
          }
        }
      })
      resizeObserver.observe(targetRef.value)
    }
  })

  onBeforeUnmount(() => {
    if (resizeObserver) {
      resizeObserver.disconnect()
      resizeObserver = null
    }
    if (instance) {
      destroyLiquidGlass(instance.id)
      instance = null
    }
  })
}
