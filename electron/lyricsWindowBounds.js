/**
 * 桌面歌词窗位置兜底（纯函数，零依赖）
 * ─────────────────────────────────────────────────────────
 * 落盘位置（desktop-lyrics-bounds.json）里的 x/y 是「上次那块屏幕上的坐标」，
 * 而显示器配置随时会变（拔掉副屏、改分辨率/缩放、只在内置屏上启动）。
 * 直接用旧坐标会把歌词窗丢到看不见的地方——窗口开着，但哪儿都找不到。
 *
 * 规则：
 *   1. 没有保存位置 → 主屏 workArea 居中
 *   2. 保存位置与任何 workArea 都不相交（副屏被拔）→ 主屏 workArea 居中
 *   3. 仅部分越界 → 夹回重叠面积最大的那块 workArea
 *   4. 完全在屏内 → 原坐标返回
 *
 * 独立成模块：main.js 依赖整个 Electron 运行时，无法在 Node 里直接单测，
 * 抽成纯函数后 scripts/test-lyrics-window-bounds.cjs 测的就是主进程真正使用的那份实现。
 */

/** 完全没有显示器信息时的最后兜底（正常情况下走不到） */
const FALLBACK_AREA = { x: 0, y: 0, width: 1280, height: 800 };

/** Electron Display（或裸 workArea）→ 标准化矩形，非法返回 null */
function toWorkArea(display) {
  if (!display) return null;
  const wa = display.workArea || display;
  if (!['x', 'y', 'width', 'height'].every((k) => Number.isFinite(wa[k]))) return null;
  if (wa.width <= 0 || wa.height <= 0) return null;
  return { x: wa.x, y: wa.y, width: wa.width, height: wa.height };
}

/** 两矩形相交面积（不相交为 0） */
function overlapArea(a, b) {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** 在 workArea 内居中（窗口比屏幕大时贴左上角，保证标题区/控制条可见） */
function centerIn(rect, area) {
  return {
    x: Math.round(area.x + Math.max(0, (area.width - rect.width) / 2)),
    y: Math.round(area.y + Math.max(0, (area.height - rect.height) / 2))
  };
}

/** 夹进 workArea：上下界反转（窗口比屏幕大）时贴左上边 */
function clampInto(rect, area) {
  const maxX = area.x + area.width - rect.width;
  const maxY = area.y + area.height - rect.height;
  return {
    x: Math.round(Math.max(area.x, Math.min(rect.x, maxX))),
    y: Math.round(Math.max(area.y, Math.min(rect.y, maxY)))
  };
}

/**
 * @param {{saved?:{x:number,y:number,width:number,height:number}|null,
 *          displays?:Array, primary?:Object, width?:number, height?:number}} params
 * @returns {{x:number, y:number, reason:'no-saved'|'offscreen'|'clamped'|'inside'}}
 */
function resolveLyricsWindowPosition({ saved, displays, primary, width, height } = {}) {
  const rectWidth = Number.isFinite(width) && width > 0 ? width : 0;
  const rectHeight = Number.isFinite(height) && height > 0 ? height : 0;
  const areas = (Array.isArray(displays) ? displays : []).map(toWorkArea).filter(Boolean);
  const primaryArea = toWorkArea(primary) || areas[0] || FALLBACK_AREA;

  const hasSaved = !!saved && Number.isFinite(saved.x) && Number.isFinite(saved.y);
  if (!hasSaved) {
    return { ...centerIn({ width: rectWidth, height: rectHeight }, primaryArea), reason: 'no-saved' };
  }

  const rect = { x: saved.x, y: saved.y, width: rectWidth, height: rectHeight };
  if (!areas.length) {
    // 拿不到任何屏幕信息：不擅自搬窗口，交给调用方/系统
    return { x: Math.round(rect.x), y: Math.round(rect.y), reason: 'inside' };
  }

  let target = null;
  let bestOverlap = 0;
  for (const area of areas) {
    const overlap = overlapArea(rect, area);
    if (overlap > bestOverlap) { bestOverlap = overlap; target = area; }
  }

  if (!target) {
    return { ...centerIn(rect, primaryArea), reason: 'offscreen' };
  }

  const clamped = clampInto(rect, target);
  const moved = clamped.x !== Math.round(rect.x) || clamped.y !== Math.round(rect.y);
  return { x: clamped.x, y: clamped.y, reason: moved ? 'clamped' : 'inside' };
}

module.exports = { resolveLyricsWindowPosition };
