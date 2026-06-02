/**
 * 边界契约（design.md 5 / 决策 B）：固定代码独立产出一份纯数值还原度报告。
 * 串 match → 逐对样式族 + 几何族 diff → 可复现的 BaselineMetrics。零 AI、零 IO。
 */
import { diffAttributes, type DiffAttrOptions } from './diff/attributes';
import { diffGeometry } from './diff/geometry';
import { foldWrappers } from './match/fold';
import { matchTrees, type MatchOptions } from './match/geometry';
import {
  DEFAULT_TOLERANCE,
  type AttributeDiff,
  type BaselineMetrics,
  type DiffReport,
  type NodeDiff,
  type StyleNode,
  type StyleTree,
  type Tolerance,
} from './schema';

export interface ComputeOptions {
  tolerance?: Tolerance;
  match?: MatchOptions;
  diff?: DiffAttrOptions;
}

/** 单条属性差是否在容差内（用于可复现的 attributeMatchRate）。 */
function attrMatched(d: AttributeDiff, tol: Tolerance): boolean {
  if (d.deltaE != null) return d.deltaE <= tol.colorDeltaE;
  if (d.delta != null) {
    const t = tol.perAttribute[d.attr] ?? tol.pixel;
    return Math.abs(d.delta) <= t;
  }
  // 字符串属性，或一侧缺失（delta/deltaE 皆 null）：相等才算匹配。
  return d.design === d.actual;
}

export function computeDiff(
  figma: StyleTree,
  dom: StyleTree,
  tolerance: Tolerance = DEFAULT_TOLERANCE,
  opts: ComputeOptions = {},
): DiffReport {
  // 折叠几何重合的 wrapper 链，对齐视觉块后再配对（design.md 11）
  const ff = foldWrappers(figma);
  const fd = foldWrappers(dom);

  const match = matchTrees(ff, fd, opts.match);
  const geom = diffGeometry(ff, fd, match.pairs);

  const figmaById = new Map(ff.nodes.map((n) => [n.id, n]));
  const domById = new Map(fd.nodes.map((n) => [n.id, n]));

  const nodes: NodeDiff[] = match.pairs.map((pair, i) => {
    const design = pair.figmaIds[0] ? figmaById.get(pair.figmaIds[0]) : undefined;
    const actual = pair.domIds[0] ? domById.get(pair.domIds[0]) : undefined;
    const attributes =
      design && actual ? diffAttributes(design as StyleNode, actual as StyleNode, opts.diff) : [];
    return { pair, attributes, geometry: geom[i] ?? [] };
  });

  const allAttrs = nodes.flatMap((n) => n.attributes);
  const matchedAttrs = allAttrs.filter((d) => attrMatched(d, tolerance)).length;
  const allGeo = nodes.flatMap((n) => n.geometry);

  const baseline: BaselineMetrics = {
    matchedPairs: match.pairs.length,
    unmatchedCount: match.unmatchedFigma.length + match.unmatchedDom.length,
    attributeMatchRate: allAttrs.length ? matchedAttrs / allAttrs.length : 1,
    geometryMae: allGeo.length
      ? allGeo.reduce((s, g) => s + Math.abs(g.delta), 0) / allGeo.length
      : 0,
  };

  return {
    source: { figma: figma.rootId, dom: dom.rootId },
    nodes,
    baseline,
  };
}
