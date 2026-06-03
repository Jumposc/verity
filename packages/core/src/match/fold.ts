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

/**
 * 折叠组件实例内部的装饰/结构层（design.md 11：对齐"视觉块"）。
 *
 * 实例内部 kind ∈ {container, vector} 的纯结构层（无文本内容），在实现端被组件封装吸收、
 * 不渲染成独立 DOM 节点——逐图元结构化 diff 必然错位（白底配蓝底、圆角配反、把真实偏差挤出榜）。
 * 移除这些层，把内部 text/image 内容层 reparent 到最近的留存祖先（= 实例根），并给实例根标
 * weakCoverage 提示内部交截图兜底。保留内部文案/图片，不漏其真实差异。
 *
 * 与 foldWrappers 互补、顺序在其后：foldWrappers 先把"实例根 + 同尺寸单背景子"合并（把背景提到根），
 * 此处再清掉剩余的并列装饰层。实例根自身（insideComponent=false）与页面布局节点不受影响。
 */
export function collapseComponentInterior(tree: StyleTree): StyleTree {
  const nodes = tree.nodes.map((n) => ({ ...n }));
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const removed = new Set<string>();
  for (const n of nodes) {
    if (n.insideComponent && (n.kind === 'container' || n.kind === 'vector') && !n.text) {
      removed.add(n.id);
    }
  }
  if (removed.size === 0) return tree;

  // 往上找第一个未被移除的祖先（被移除的中间装饰层洞补上）。
  const liveAncestor = (startParentId: string | null): string | null => {
    let p = startParentId;
    while (p && removed.has(p)) p = byId.get(p)?.parentId ?? null;
    return p;
  };

  // 丢了内部装饰层的实例根（留存宿主）标 weakCoverage：内部细节交截图兜底。
  for (const id of removed) {
    const host = liveAncestor(byId.get(id)!.parentId);
    const h = host ? byId.get(host) : undefined;
    if (h) h.weakCoverage = true;
  }

  // 留存节点：parentId 重指向最近留存祖先，childIds 按新父子关系重建。
  const kept = nodes.filter((n) => !removed.has(n.id));
  for (const n of kept) {
    n.parentId = liveAncestor(n.parentId);
    n.childIds = [];
  }
  for (const n of kept) {
    if (n.parentId) byId.get(n.parentId)?.childIds.push(n.id);
  }

  return {
    ...tree,
    nodes: kept,
    rootId: removed.has(tree.rootId) ? (kept[0]?.id ?? tree.rootId) : tree.rootId,
  };
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
