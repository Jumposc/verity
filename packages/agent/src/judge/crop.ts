/**
 * 喂 AI judge 前的固定代码裁剪（design.md 10.1：聚合裁剪后的 top-risk diff，
 * 不把全量 CSS 进 prompt，防 token / 噪声膨胀）。纯函数，零 AI。
 */
import type { AttributeDiff, BaselineMetrics, DiffReport, GeometryDiff } from '@solvir/verity-core';
import type { Scenario } from '../types';

export type JudgeAttr = AttributeDiff & { nodeId: string };
export type JudgeGeo = GeometryDiff & { nodeId: string };

export interface JudgeInput {
  source: { figma: string; dom: string };
  scenario?: Scenario;
  baseline: BaselineMetrics;
  /** 超容差 / 缺失 / 枚举不等的属性差，按幅度降序。 */
  attributes: JudgeAttr[];
  /** 超容差的几何边界距离差，按幅度降序。 */
  geometry: JudgeGeo[];
  /** 低置信配对，待 AI 消歧。 */
  ambiguousPairs: Array<{ figmaIds: string[]; domIds: string[]; confidence: number }>;
  /** 因 maxItems 截断了部分项。 */
  truncated: boolean;
}

export interface CropOptions {
  scenario?: Scenario;
  /** 颜色 ΔE 容差，低于视为等价。缺省 2。 */
  colorDeltaE?: number;
  /** 数值 px 容差，低于视为等价。缺省 0.5。 */
  pixel?: number;
  /** 属性 + 几何合计最多保留项数。缺省 60。 */
  maxItems?: number;
}

/** 是否在容差内（在内则丢弃，不喂 judge）。 */
function withinTolerance(d: AttributeDiff, colorTol: number, pixel: number): boolean {
  if (d.deltaE != null) return d.deltaE <= colorTol;
  if (d.delta != null) return Math.abs(d.delta) <= pixel;
  return d.design === d.actual; // 字符串相等 / 一侧缺失（不等）
}

/** 排序幅度：颜色用 ΔE，数值用 |delta|，枚举不等 / 缺失给最高优先级。 */
function magnitude(d: AttributeDiff): number {
  if (d.deltaE != null) return d.deltaE;
  if (d.delta != null) return Math.abs(d.delta);
  return Number.MAX_SAFE_INTEGER;
}

export function cropForJudge(report: DiffReport, opts: CropOptions = {}): JudgeInput {
  const colorTol = opts.colorDeltaE ?? 2;
  const pixel = opts.pixel ?? 0.5;
  const maxItems = opts.maxItems ?? 60;

  const attributes: JudgeAttr[] = [];
  const geometry: JudgeGeo[] = [];
  const ambiguousPairs: JudgeInput['ambiguousPairs'] = [];

  for (const node of report.nodes) {
    const nodeId = node.pair.figmaIds[0] ?? node.pair.domIds[0] ?? '';
    for (const a of node.attributes) {
      if (!withinTolerance(a, colorTol, pixel)) attributes.push({ ...a, nodeId });
    }
    for (const g of node.geometry) {
      if (Math.abs(g.delta) > pixel) geometry.push({ ...g, nodeId });
    }
    if (node.pair.ambiguous) {
      ambiguousPairs.push({
        figmaIds: node.pair.figmaIds,
        domIds: node.pair.domIds,
        confidence: node.pair.confidence,
      });
    }
  }

  attributes.sort((a, b) => magnitude(b) - magnitude(a));
  geometry.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const total = attributes.length + geometry.length;
  let truncated = false;
  let keptAttrs = attributes;
  let keptGeo = geometry;
  if (total > maxItems) {
    truncated = true;
    // 属性优先占额度，剩余给几何
    keptAttrs = attributes.slice(0, maxItems);
    keptGeo = geometry.slice(0, Math.max(0, maxItems - keptAttrs.length));
  }

  return {
    source: report.source,
    scenario: opts.scenario,
    baseline: report.baseline,
    attributes: keptAttrs,
    geometry: keptGeo,
    ambiguousPairs,
    truncated,
  };
}
