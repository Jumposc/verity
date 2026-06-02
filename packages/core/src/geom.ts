/**
 * Rect 几何原语。被多信号配对（match）与几何边界距离 diff 复用。
 * 约定：传入的 rect 已是各自 root frame 的相对坐标（schema.Rect 契约）；
 * 跨 frame 尺寸对齐由调用方用 {@link scaleRect} 处理。
 */
import type { Rect } from './schema';

/** 两矩形交并比（IoU），0-1。任一退化为零面积返回 0。 */
export function iou(a: Rect, b: Rect): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const union = a.w * a.h + b.w * b.h - inter;
  if (union <= 0) return 0;
  return inter / union;
}

/** 按轴缩放矩形（位置与尺寸同缩放），用于把一端归一到另一端的 frame px 空间。 */
export function scaleRect(rect: Rect, sx: number, sy: number): Rect {
  return { x: rect.x * sx, y: rect.y * sy, w: rect.w * sx, h: rect.h * sy };
}

/** x 轴边界 gap：分离为正、重叠为负，与 a/b 先后无关。 */
export function gapX(a: Rect, b: Rect): number {
  const left = Math.min(a.x + a.w, b.x + b.w);
  const right = Math.max(a.x, b.x);
  return right - left;
}

/** y 轴边界 gap：分离为正、重叠为负，与 a/b 先后无关。 */
export function gapY(a: Rect, b: Rect): number {
  const top = Math.min(a.y + a.h, b.y + b.h);
  const bottom = Math.max(a.y, b.y);
  return bottom - top;
}
