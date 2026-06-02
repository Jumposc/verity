/**
 * 合成 gold set 的加载 + 工具运行器（design.md 12）。
 * gold 一条 = 共享 figma 设计树 + 各自 dom 树 + 已知偏差标注。
 * runSample 用某组确定性 config 跑 computeDiff + cropForJudge，把 notable findings 当工具输出，
 * 供 evaluate 与人工标注比 F1。两端都是 StyleTree fixture，纯函数、毫秒级，可被 selfIterate 跑几百轮。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { computeDiff, DEFAULT_TOLERANCE, type StyleTree } from '@solvir/verity-core';
import { cropForJudge } from '@solvir/verity-agent';
import type { GoldSample, SampleRunner, ToolOutput } from './types';
import { selfIterate, type SelfIterateResult } from './self-iterate';

/** 可被 eval 自迭代调整的确定性旋钮。 */
export interface TuneConfig {
  /** 圆角钳到完全圆角阈值后再比（消化 999≈9999 假阳性）。 */
  clampRoundedRadius: boolean;
  /** 颜色 ΔE 容差。 */
  colorDeltaE: number;
  /** 数值 / 几何 px 容差。 */
  pixel: number;
}

export const NAIVE_CONFIG: TuneConfig = { clampRoundedRadius: false, colorDeltaE: 2, pixel: 0.5 };

export interface GoldEntry {
  sample: GoldSample;
  figma: StyleTree;
  dom: StyleTree;
}

/**
 * 从目录加载 gold：每个子目录是一条样本，含 figma.tree.json + dom.tree.json + expected.json。
 * 每样本带自己的 figma 设计树，支持多组件（真实写回的案例各不相同）。
 */
export function loadGold(dir: string): GoldEntry[] {
  return readdirSync(dir)
    .filter((name) => statSync(join(dir, name)).isDirectory())
    .map((name) => {
      const figma = JSON.parse(readFileSync(join(dir, name, 'figma.tree.json'), 'utf8')) as StyleTree;
      const dom = JSON.parse(readFileSync(join(dir, name, 'dom.tree.json'), 'utf8')) as StyleTree;
      const exp = JSON.parse(readFileSync(join(dir, name, 'expected.json'), 'utf8')) as {
        fidelityScore: number;
        criticalFindings: string[];
      };
      const sample: GoldSample = {
        id: name,
        figmaFileKey: 'synthetic',
        figmaNodeId: figma.rootId,
        url: name,
        expected: { fidelityScore: exp.fidelityScore, criticalFindings: exp.criticalFindings },
      };
      return { sample, figma, dom };
    });
}

/** 用某组 config 跑确定性链路，产出工具结论（findings = 超容差属性/几何名）。 */
export function runSample(figma: StyleTree, dom: StyleTree, config: TuneConfig): ToolOutput {
  const report = computeDiff(figma, dom, DEFAULT_TOLERANCE, {
    diff: { clampRoundedRadius: config.clampRoundedRadius },
  });
  const cropped = cropForJudge(report, { colorDeltaE: config.colorDeltaE, pixel: config.pixel });
  const findings = [
    ...cropped.attributes.map((a) => a.attr),
    ...cropped.geometry.map((g) => g.relation),
  ];
  return { fidelityScore: Math.round(report.baseline.attributeMatchRate * 100), findings };
}

/** 由 config 构造跑整个 gold 的 runner（按 sample.id 取对应树）。 */
export function makeRunner(entries: GoldEntry[], config: TuneConfig): SampleRunner {
  const byId = new Map(entries.map((e) => [e.sample.id, e]));
  return {
    run: async (s) => {
      const e = byId.get(s.id);
      if (!e) throw new Error(`gold 样本缺失：${s.id}`);
      return runSample(e.figma, e.dom, config);
    },
  };
}

/** 候选配置（坐标式枚举）：从朴素基线起，逐步加规则 / 调容差。 */
export const CANDIDATES: TuneConfig[] = [
  { clampRoundedRadius: false, colorDeltaE: 2, pixel: 0.5 }, // 朴素基线
  { clampRoundedRadius: true, colorDeltaE: 2, pixel: 0.5 }, // + 圆角完全等价
  { clampRoundedRadius: true, colorDeltaE: 5, pixel: 0.5 }, // 放宽颜色容差
  { clampRoundedRadius: true, colorDeltaE: 2, pixel: 2 }, // 放宽像素容差
];

/**
 * 自迭代实跑：用 selfIterate 作harness，逐个评估候选配置，按 meanF1 取最佳，达标即停。
 * tune 这里是确定性候选调度（无 API key 的 judge prompt 调由 Claude Code 另行做）。
 */
export async function tuneOnGold(dir: string): Promise<SelfIterateResult<TuneConfig>> {
  const entries = loadGold(dir);
  const samples = entries.map((e) => e.sample);
  return selfIterate<TuneConfig>(samples, {
    initialConfig: CANDIDATES[0]!,
    makeRunner: (config) => makeRunner(entries, config),
    tune: (ctx) => CANDIDATES[Math.min(ctx.iteration + 1, CANDIDATES.length - 1)]!,
    targetF1: 1,
    maxIterations: CANDIDATES.length,
  });
}
