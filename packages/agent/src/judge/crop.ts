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
  /** 几何差的保底配额，防被结构性单侧差或大量数值差挤光。缺省 floor(maxItems/2)。 */
  geometryQuota?: number;
  /** 几何差幅度上限 px，超过视为错配/布局塌缩虚值丢弃。真实 padding/间距/位移偏差有物理上限。缺省 64。 */
  maxGeometryDelta?: number;
}

/** 是否在容差内（在内则丢弃，不喂 judge）。 */
function withinTolerance(d: AttributeDiff, colorTol: number, pixel: number): boolean {
  if (d.deltaE != null) return d.deltaE <= colorTol;
  if (d.delta != null) return Math.abs(d.delta) <= pixel;
  return d.design === d.actual; // 字符串相等 / 一侧缺失（不等）
}

/** 数值幅度（仅用于有 delta/deltaE 的真实偏差排序）：颜色用 ΔE，数值用 |delta|。 */
function magnitude(d: AttributeDiff): number {
  if (d.deltaE != null) return d.deltaE;
  if (d.delta != null) return Math.abs(d.delta);
  return 0;
}

/** 是否真实数值/颜色偏差（有可量化的 delta/deltaE）。否则视为结构性单侧差（粒度差噪声居多）。 */
function isNumericDiff(d: AttributeDiff): boolean {
  return d.delta != null || d.deltaE != null;
}

export function cropForJudge(report: DiffReport, opts: CropOptions = {}): JudgeInput {
  const colorTol = opts.colorDeltaE ?? 2;
  const pixel = opts.pixel ?? 0.5;
  const maxItems = opts.maxItems ?? 60;
  const geometryQuota = opts.geometryQuota ?? Math.floor(maxItems / 2);
  const maxGeometryDelta = opts.maxGeometryDelta ?? 64;

  // 真实数值/颜色差与结构性单侧差分桶：粒度差（figma/DOM 节点数不一致）会产生大量"单侧 null"，
  // 旧实现给它们最高优先级 → 占满预算把真实数值差和几何差全挤出 judge 视野（漏报真实偏差）。
  const numericAttrs: JudgeAttr[] = [];
  const structuralAttrs: JudgeAttr[] = [];
  const geometry: JudgeGeo[] = [];
  const ambiguousPairs: JudgeInput['ambiguousPairs'] = [];

  for (const node of report.nodes) {
    const nodeId = node.pair.figmaIds[0] ?? node.pair.domIds[0] ?? '';
    for (const a of node.attributes) {
      if (withinTolerance(a, colorTol, pixel)) continue;
      const item = { ...a, nodeId };
      (isNumericDiff(a) ? numericAttrs : structuralAttrs).push(item);
    }
    // 几何差信噪过滤：figma design 真值合理 + delta 不离谱，才算可评判的真实样式偏差。
    // 旧实现按 ambiguous 一刀切，但组件实例密集的页面里 90% 配对都低置信 → 把藏在 ambiguous
    // 配对里的真实小偏差（如 12px padding 塌缩）连同噪声一起误杀。改按「幅度 + 真值合理性」筛：
    // 错配/祖先穿透会产出负间距、frame 量级 inset、上千 px delta —— 这些是伪几何关系
    // （figma 真值本身就异常），不该拿来评判实现。content-top 受祖先链穿透累积影响最大，用更严上限。
    for (const g of node.geometry) {
      const mag = Math.abs(g.delta);
      const cap = g.relation === 'content-top' ? Math.min(maxGeometryDelta, 32) : maxGeometryDelta;
      if (mag <= pixel || mag > cap) continue;
      if (g.relation === 'sibling-gap' && (g.design < 0 || g.design > 96)) continue; // 负间距 = 错配伪关系
      if (g.design < 0 || g.design > 200) continue; // 超大 inset = 远祖先穿透噪声
      geometry.push({ ...g, nodeId });
    }
    if (node.pair.ambiguous) {
      ambiguousPairs.push({
        figmaIds: node.pair.figmaIds,
        domIds: node.pair.domIds,
        confidence: node.pair.confidence,
      });
    }
  }

  numericAttrs.sort((a, b) => magnitude(b) - magnitude(a));
  geometry.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  // 预算顺序：真实数值差占主额度（给几何留保底配额）→ 几何 → 结构性单侧差只吃最后剩余。
  const geoReserve = Math.min(geometry.length, geometryQuota);
  const keptNumeric = numericAttrs.slice(0, Math.max(0, maxItems - geoReserve));
  let rem = maxItems - keptNumeric.length;
  const keptGeo = geometry.slice(0, Math.min(geometry.length, rem));
  rem -= keptGeo.length;
  const keptStructural = structuralAttrs.slice(0, Math.max(0, rem));

  const truncated =
    keptNumeric.length < numericAttrs.length ||
    keptGeo.length < geometry.length ||
    keptStructural.length < structuralAttrs.length;

  return {
    source: report.source,
    scenario: opts.scenario,
    baseline: report.baseline,
    // 真实数值差排在结构性单侧差之前，judge 先看可量化偏差
    attributes: [...keptNumeric, ...keptStructural],
    geometry: keptGeo,
    ambiguousPairs,
    truncated,
  };
}
