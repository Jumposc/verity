/**
 * 样式族逐属性 diff（design.md 5.2）。纯客观：只产出 {design, actual, delta/deltaE}，
 * 不含任何阈值或价值判断（那是 compute 的 baseline 与 AI judge 的事）。
 *
 * 仅覆盖"样式族"（颜色 / 字体 / 圆角 / 边框 / 背景 / 不透明度 / 布局模式）。
 * 间距 / 位置 / 尺寸属于"几何族"，走 diff/geometry，不在此（design.md 11）。
 */
import { deltaE, toHex } from '../color';
import type { AttributeDiff, Color, StyleNode } from '../schema';

type AttrKind = 'number' | 'color' | 'string';

interface AttrSpec {
  attr: string;
  kind: AttrKind;
  get: (n: StyleNode) => number | string | Color | null;
}

const SPECS: AttrSpec[] = [
  // typography
  { attr: 'fontFamily', kind: 'string', get: (n) => n.typography.fontFamily },
  { attr: 'fontSize', kind: 'number', get: (n) => n.typography.fontSize },
  { attr: 'fontWeight', kind: 'number', get: (n) => n.typography.fontWeight },
  { attr: 'lineHeight', kind: 'number', get: (n) => n.typography.lineHeight },
  { attr: 'letterSpacing', kind: 'number', get: (n) => n.typography.letterSpacing },
  { attr: 'textAlign', kind: 'string', get: (n) => n.typography.textAlign },
  { attr: 'color', kind: 'color', get: (n) => n.typography.color },
  // fill
  { attr: 'backgroundColor', kind: 'color', get: (n) => n.fill.backgroundColor },
  { attr: 'backgroundKind', kind: 'string', get: (n) => n.fill.backgroundKind },
  // border
  { attr: 'borderWidth', kind: 'number', get: (n) => n.border.width },
  { attr: 'borderStyle', kind: 'string', get: (n) => n.border.style },
  { attr: 'borderColor', kind: 'color', get: (n) => n.border.color },
  { attr: 'borderRadius.tl', kind: 'number', get: (n) => n.border.radius[0] },
  { attr: 'borderRadius.tr', kind: 'number', get: (n) => n.border.radius[1] },
  { attr: 'borderRadius.br', kind: 'number', get: (n) => n.border.radius[2] },
  { attr: 'borderRadius.bl', kind: 'number', get: (n) => n.border.radius[3] },
  // effect
  { attr: 'opacity', kind: 'number', get: (n) => n.effect.opacity },
  { attr: 'boxShadow', kind: 'string', get: (n) => n.effect.boxShadow },
  // layout mode（结构枚举，非间距）
  { attr: 'display', kind: 'string', get: (n) => n.layout.display },
  { attr: 'flexDirection', kind: 'string', get: (n) => n.layout.flexDirection },
  { attr: 'justifyContent', kind: 'string', get: (n) => n.layout.justifyContent },
  { attr: 'alignItems', kind: 'string', get: (n) => n.layout.alignItems },
];

/** 角的有效视觉半径：声明值与盒短边一半取小（超过即完全圆角，再大也一样）。 */
function effectiveRadius(raw: number, node: StyleNode): number {
  const cap = Math.min(node.rect.w, node.rect.h) / 2;
  return Math.min(raw, cap);
}

function diffOne(
  spec: AttrSpec,
  design: StyleNode,
  actual: StyleNode,
  opts: DiffAttrOptions,
): AttributeDiff | null {
  let d = spec.get(design);
  let a = spec.get(actual);
  if (d == null && a == null) return null;

  // 圆角完全等价：钳到盒短边一半后再比（design.md：AI 判断沉淀为确定性容差）
  if (opts.clampRoundedRadius && spec.attr.startsWith('borderRadius.')) {
    if (typeof d === 'number') d = effectiveRadius(d, design);
    if (typeof a === 'number') a = effectiveRadius(a, actual);
  }

  if (spec.kind === 'color') {
    const dc = d as Color | null;
    const ac = a as Color | null;
    return {
      attr: spec.attr,
      design: dc ? toHex(dc) : null,
      actual: ac ? toHex(ac) : null,
      delta: null,
      deltaE: dc && ac ? deltaE(dc, ac) : null,
    };
  }

  if (spec.kind === 'number') {
    const dn = d as number | null;
    const an = a as number | null;
    return {
      attr: spec.attr,
      design: dn,
      actual: an,
      delta: dn != null && an != null ? an - dn : null,
      deltaE: null,
    };
  }

  return {
    attr: spec.attr,
    design: d as string | null,
    actual: a as string | null,
    delta: null,
    deltaE: null,
  };
}

export interface DiffAttrOptions {
  /** 圆角钳到盒短边一半后再比，消化"超完全圆角阈值"的等价（999≈9999）。缺省关。 */
  clampRoundedRadius?: boolean;
}

/** 逐样式族属性比对两节点，产出纯客观差异表。双方皆缺失的属性跳过。 */
export function diffAttributes(
  design: StyleNode,
  actual: StyleNode,
  opts: DiffAttrOptions = {},
): AttributeDiff[] {
  const out: AttributeDiff[] = [];
  for (const spec of SPECS) {
    const d = diffOne(spec, design, actual, opts);
    if (d) out.push(d);
  }
  return out;
}
