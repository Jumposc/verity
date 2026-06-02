/**
 * 颜色解析与 CIEDE2000 色差。两端 adapter 把颜色归一化为 {@link Color}，
 * diff 层用 {@link deltaE} 算感知色差（design.md 5.2）。culori 负责解析与 ΔE。
 */
import { differenceCiede2000, parse, rgb } from 'culori';
import type { Color } from './schema';

const ciede2000 = differenceCiede2000();

/** 0-1 浮点（culori / Figma 通道）转 0-255 整数，越界夹紧。 */
function to255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v * 255)));
}

/** culori rgb（0-1）对象，供 ΔE 计算。alpha 不参与 CIEDE2000。 */
function toCulori(c: Color): { mode: 'rgb'; r: number; g: number; b: number } {
  return { mode: 'rgb', r: c.r / 255, g: c.g / 255, b: c.b / 255 };
}

/** 解析任意 CSS 颜色字符串为 {@link Color}；无法解析返回 null。 */
export function parseColor(input: string): Color | null {
  const parsed = parse(input);
  if (!parsed) return null;
  const c = rgb(parsed);
  if (!c) return null;
  return { r: to255(c.r), g: to255(c.g), b: to255(c.b), a: c.alpha ?? 1 };
}

/** Figma 0-1 浮点通道转 {@link Color}；alpha 缺省为 1。 */
export function figmaColor(c: { r: number; g: number; b: number; a?: number }): Color {
  return { r: to255(c.r), g: to255(c.g), b: to255(c.b), a: c.a ?? 1 };
}

/** 两色 CIEDE2000 感知色差。相同色为 0，白对黑约 100。 */
export function deltaE(a: Color, b: Color): number {
  return ciede2000(toCulori(a), toCulori(b));
}

function hex2(v: number): string {
  return Math.max(0, Math.min(255, Math.round(v)))
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();
}

/** 格式化为 hex 字符串：不透明 6 位 `#RRGGBB`，半透明 8 位 `#RRGGBBAA`。 */
export function toHex(c: Color): string {
  const base = `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
  return c.a >= 1 ? base : `${base}${hex2(c.a * 255)}`;
}
