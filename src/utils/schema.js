/**
 * Schema 校验 + 版本迁移框架
 * ─────────────────────────────────────────────────────────────
 * 目标：
 * - 每个 store 声明一次"它的数据应该长什么样"，load() 时自动校验 + 兜底缺失字段
 * - 老数据格式变化时声明一条迁移路径，新老数据共存
 * - 零依赖（不引 zod/yup），手写足够用，约 200 行
 *
 * 用法：
 *   import { s, defineSchema } from '@/utils/schema'
 *
 *   const settingsSchema = defineSchema({
 *     version: 2,
 *     fields: {
 *       audioVisualizerEnabled: s.boolean(true),
 *       audioVisualizerIntensity: s.number(0, 1, 0.6),
 *       eqBands: s.array(s.number(-12, 12, 0), 10),
 *       // 缺省字段
 *       newField: s.string('default')   // 2.0 加的，老数据没这个字段时会兜底
 *     },
 *     // 迁移链：v1 → v2 时调用
 *     migrations: {
 *       2: (data) => ({ ...data, newField: 'default' })
 *     }
 *   })
 *
 * 集成在 createPersistentStorage 里使用：
 *   createPersistentStorage('settings', { schema: settingsSchema })
 *   await storage.load()  // 自动跑校验 + 迁移 + 兜底
 *
 * 校验失败时只 warn，不阻塞（数据丢了不能用，宁可降级也不阻断启动）
 */

// ───────── 类型构造器 ─────────

/**
 * 创建字段定义
 * @param {object} opts
 * @param {*}      opts.default    字段默认值（缺省时填这个）
 * @param {function} opts.validate value → { ok: boolean, value?: any, error?: string }
 * @param {boolean} [opts.optional] 是否允许 undefined/null
 */
function field({ default: def, validate, optional = false }) {
  return { default: def, validate, optional }
}

const s = {
  /** 字符串，默认 '' */
  string(defaultValue = '') {
    return field({
      default: defaultValue,
      validate: v => {
        if (v === undefined || v === null) return { ok: true, value: defaultValue }
        if (typeof v !== 'string') return { ok: false, error: `expected string, got ${typeof v}` }
        return { ok: true, value: v }
      }
    })
  },

  /** 数字，clamp 到 [min, max]，NaN/Infinity 走 default */
  number(min = -Infinity, max = Infinity, defaultValue = 0) {
    return field({
      default: defaultValue,
      validate: v => {
        if (v === undefined || v === null) return { ok: true, value: defaultValue }
        const n = Number(v)
        if (Number.isNaN(n) || !Number.isFinite(n)) {
          return { ok: false, error: `not a finite number: ${v}` }
        }
        return { ok: true, value: Math.max(min, Math.min(max, n)) }
      }
    })
  },

  /** 布尔 */
  boolean(defaultValue = false) {
    return field({
      default: defaultValue,
      validate: v => {
        if (v === undefined || v === null) return { ok: true, value: defaultValue }
        if (typeof v === 'boolean') return { ok: true, value: v }
        if (v === 'true' || v === 1 || v === '1') return { ok: true, value: true }
        if (v === 'false' || v === 0 || v === '0') return { ok: true, value: false }
        return { ok: false, error: `not boolean: ${v}` }
      }
    })
  },

  /**
   * 数组：每个元素跑 element validate
   * @param {object} elementField s.*() 返回的字段定义
   * @param {number} [fixedLength]  期望长度（用于 EQ 10 段这种定长场景）
   */
  array(elementField, fixedLength = null) {
    return field({
      default: fixedLength
        ? new Array(fixedLength).fill(elementField.default)
        : [],
      validate: v => {
        if (v === undefined || v === null) {
          return { ok: true, value: fieldDefault(elementField) }
        }
        if (!Array.isArray(v)) return { ok: false, error: `expected array, got ${typeof v}` }
        const out = []
        for (let i = 0; i < v.length; i++) {
          const r = elementField.validate(v[i])
          if (!r.ok) {
            // 单个元素坏了不要全扔，用 element default 兜底
            console.warn(`[schema] array[${i}] 校验失败: ${r.error}，用默认值兜底`)
            out.push(elementField.default)
          } else {
            out.push(r.value)
          }
        }
        if (fixedLength !== null && out.length !== fixedLength) {
          // 长度不对的常见情况：老数据 8 段 EQ 升到 10 段
          const padded = fieldDefault(elementField)
          while (out.length < fixedLength) out.push(padded.default !== undefined ? padded.default : 0)
          if (out.length > fixedLength) out.length = fixedLength
        }
        return { ok: true, value: out }
      }
    })
  },

  /**
   * 对象：每个 key 跑对应字段 validate
   * @param {object} shape { key: fieldDef, ... }
   * @param {boolean} [strict] 严格模式：遇到未声明的 key 报错（默认 false，未知 key 保留）
   */
  object(shape, strict = false) {
    const shapeKeys = Object.keys(shape)
    return field({
      default: () => {
        const out = {}
        for (const k of shapeKeys) out[k] = fieldDefault(shape[k])
        return out
      },
      validate: v => {
        if (v === undefined || v === null) return { ok: true, value: null }
        if (typeof v !== 'object' || Array.isArray(v)) {
          return { ok: false, error: `expected object, got ${typeof v}` }
        }
        const out = {}
        for (const k of shapeKeys) {
          const r = shape[k].validate(v[k])
          if (!r.ok) {
            console.warn(`[schema] object.${k} 校验失败: ${r.error}，用默认值兜底`)
            out[k] = fieldDefault(shape[k])
          } else {
            out[k] = r.value
          }
        }
        if (!strict) {
          // 保留未知 key（不破坏老数据中的扩展字段）
          for (const k of Object.keys(v)) {
            if (!(k in out)) out[k] = v[k]
          }
        }
        return { ok: true, value: out }
      }
    })
  },

  /**
   * 枚举字符串
   * @param {string[]} allowed
   * @param {string} defaultValue
   */
  enum(allowed, defaultValue) {
    const set = new Set(allowed)
    return field({
      default: defaultValue,
      validate: v => {
        if (v === undefined || v === null) return { ok: true, value: defaultValue }
        if (set.has(v)) return { ok: true, value: v }
        return { ok: false, error: `not in enum: ${v}` }
      }
    })
  },

  /** 任意值，不校验 */
  any() {
    return field({
      default: null,
      validate: v => ({ ok: true, value: v })
    })
  }
}

function fieldDefault(f) {
  if (typeof f.default === 'function') return f.default()
  return f.default
}

// ───────── Schema 定义 ─────────

/**
 * 定义一个 store 的 schema
 * @param {object} def
 * @param {number} def.version    当前版本号（从 1 开始）
 * @param {object} def.fields     { key: fieldDef }
 * @param {object} [def.migrations] { toVersion: (data) => nextData }
 */
function defineSchema({ version, fields, migrations = {} }) {
  if (typeof version !== 'number' || version < 1) {
    throw new Error('[schema] version 必须是从 1 开始的整数')
  }
  if (!fields || typeof fields !== 'object') {
    throw new Error('[schema] fields 必须存在且是对象')
  }
  return {
    version,
    fields,
    migrations,
    /**
     * 把原始数据校验 + 兜底成 schema 当前版本
     * @param {*} raw
     * @returns {*} sanitized
     */
    parse(raw, rawVersion) {
      // 1) raw 不是一个对象：直接用全默认值
      if (raw === undefined || raw === null || typeof raw !== 'object') {
        return defaultsFromFields(fields)
      }
      // 2) 如果 raw 带 _schemaVersion 字段，用它；否则认为是当前版本
      let data
      const fromVersion = rawVersion || raw._schemaVersion || version
      if (fromVersion === version) {
        data = raw
      } else {
        // 3) 跑迁移链
        data = raw
        for (let v = fromVersion; v < version; v++) {
          const migrator = migrations[v + 1]
          if (typeof migrator === 'function') {
            try {
              const next = migrator(data)
              if (next && typeof next === 'object') {
                data = next
                console.log(`[schema] 迁移 v${v} → v${v + 1} 完成`)
              }
            } catch (e) {
              console.warn(`[schema] 迁移 v${v} → v${v + 1} 失败:`, e.message)
              // 迁移失败：放弃迁移，从默认值起
              return defaultsFromFields(fields)
            }
          } else {
            console.warn(`[schema] 缺少迁移 v${v} → v${v + 1}，使用默认值`)
            return defaultsFromFields(fields)
          }
        }
      }
      // 4) 字段级校验 + 兜底
      const out = {}
      const fieldKeys = Object.keys(fields)
      for (const k of fieldKeys) {
        const r = fields[k].validate(data[k])
        if (!r.ok) {
          console.warn(`[schema] ${k} 校验失败: ${r.error}，用默认值兜底`)
          out[k] = fieldDefault(fields[k])
        } else {
          out[k] = r.value
        }
      }
      // 保留未知字段（避免破坏扩展）
      for (const k of Object.keys(data)) {
        if (!(k in out)) out[k] = data[k]
      }
      out._schemaVersion = version
      return out
    }
  }
}

function defaultsFromFields(fields) {
  const out = {}
  for (const k of Object.keys(fields)) {
    out[k] = fieldDefault(fields[k])
  }
  out._schemaVersion = 1 // 让下次 parse 还能再跑
  return out
}

export { s, defineSchema }
