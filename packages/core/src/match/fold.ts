/**
 * 折叠几何重合的 wrapper 链（design.md 11：对齐"视觉块"而非 DOM/Figma 层级）。
 *
 * 一个节点若"恰有 1 个子节点，且子节点 bbox 与自身近乎重合"，则它是无独立视觉盒的
 * 包裹层（典型：Figma COMPONENT/INSTANCE 壳套同尺寸内容）。把这种链折叠成单节点，
 * 合并样式（壳/子各取非默认值）、reparent 孙节点。折叠后两端对齐到视觉块，配对不再错位。
 *
 * 仅折叠"重合"wrapper；带 padding/inset 的 wrapper（bbox 不重合）保留，由几何 diff 穿透。
 */
import type {
  BorderStyle,
  EffectStyle,
  FillStyle,
  LayoutStyle,
  Rect,
  StyleNode,
  StyleTree,
  TypographyStyle,
} from '../schema';

function rectClose(a: Rect, b: Rect, eps: number): boolean {
  return (
    Math.abs(a.x - b.x) <= eps &&
    Math.abs(a.y - b.y) <= eps &&
    Math.abs(a.w - b.w) <= eps &&
    Math.abs(a.h - b.h) <= eps
  );
}

/** 子节点（inner）的视觉样式优先，缺省回退到壳（outer）。 */
function mergeFill(outer: FillStyle, inner: FillStyle): FillStyle {
  return inner.backgroundKind !== 'none' ? inner : outer;
}

function mergeBorder(outer: BorderStyle, inner: BorderStyle): BorderStyle {
  const innerHasStroke = inner.width != null;
  const innerHasRadius = inner.radius.some((r) => r !== 0);
  return {
    width: innerHasStroke ? inner.width : outer.width,
    style: innerHasStroke ? inner.style : outer.style,
    color: innerHasStroke ? inner.color : outer.color,
    radius: innerHasRadius ? inner.radius : outer.radius,
  };
}

function mergeTypography(outer: TypographyStyle, inner: TypographyStyle): TypographyStyle {
  return {
    fontFamily: inner.fontFamily ?? outer.fontFamily,
    fontSize: inner.fontSize ?? outer.fontSize,
    fontWeight: inner.fontWeight ?? outer.fontWeight,
    lineHeight: inner.lineHeight ?? outer.lineHeight,
    letterSpacing: inner.letterSpacing ?? outer.letterSpacing,
    textAlign: inner.textAlign ?? outer.textAlign,
    color: inner.color ?? outer.color,
  };
}

function mergeLayout(outer: LayoutStyle, inner: LayoutStyle): LayoutStyle {
  return inner.display != null ? inner : outer;
}

function mergeEffect(outer: EffectStyle, inner: EffectStyle): EffectStyle {
  return {
    boxShadow: inner.boxShadow ?? outer.boxShadow,
    opacity: inner.opacity !== 1 ? inner.opacity : outer.opacity,
  };
}

/** 把子节点 c 合并进壳 p（就地改 p 的副本）。 */
function mergeInto(p: StyleNode, c: StyleNode): void {
  p.fill = mergeFill(p.fill, c.fill);
  p.border = mergeBorder(p.border, c.border);
  p.typography = mergeTypography(p.typography, c.typography);
  p.layout = mergeLayout(p.layout, c.layout);
  p.effect = mergeEffect(p.effect, c.effect);
  p.kind = c.kind !== 'container' ? c.kind : p.kind;
  p.text = p.text ?? c.text;
  p.role = p.role ?? c.role;
  p.componentName = p.componentName ?? c.componentName;
  p.weakCoverage = p.weakCoverage || c.weakCoverage;
}

export function foldWrappers(tree: StyleTree, eps = 1): StyleTree {
  // 浅拷贝每个节点（只改顶层字段，不动原树的嵌套对象引用）
  const nodes = tree.nodes.map((n) => ({ ...n }));
  const byId = new Map(nodes.map((n) => [n.id, n]));

  let changed = true;
  while (changed) {
    changed = false;
    for (const p of byId.values()) {
      if (p.childIds.length !== 1) continue;
      const childId = p.childIds[0]!;
      const c = byId.get(childId);
      if (!c || !rectClose(p.rect, c.rect, eps)) continue;

      mergeInto(p, c);
      for (const gcId of c.childIds) {
        const gc = byId.get(gcId);
        if (gc) gc.parentId = p.id;
      }
      p.childIds = c.childIds;
      byId.delete(c.id);
      changed = true;
      break; // 改动后重启扫描，保证链式折叠收敛
    }
  }

  const folded = [...byId.values()];
  return {
    ...tree,
    nodes: folded,
    rootId: byId.has(tree.rootId) ? tree.rootId : (folded[0]?.id ?? tree.rootId),
  };
}
