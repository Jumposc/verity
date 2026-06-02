/**
 * 完整流程编排（design.md 第 7 节数据流）。面向 types.ts 的接口编程：
 * 并发拉两端 StyleTree → core.computeDiff 出纯客观 diff → 可选 AI judge → 可选报告。
 * judge / reporter 缺省时只跑确定性链路，即 core 的边界契约。
 */
import { computeDiff } from '@solvir/verity-core';
import type { VerityDeps, VerityResult, VerityRunOptions } from './types';

export async function run(opts: VerityRunOptions, deps: VerityDeps): Promise<VerityResult> {
  const [figmaTree, domTree] = await Promise.all([
    deps.figma.fetchTree(opts.figma, opts.scenario),
    deps.dom.capture(opts.url, opts.scenario),
  ]);

  // clampRoundedRadius：eval 在合成 gold 上验证的规则（packages/eval/gold），
  // 消化"超完全圆角阈值的 radius 等价"假阳性（999≈9999），meanF1 0.35→1.0。
  const diff = computeDiff(figmaTree, domTree, deps.tolerance, {
    diff: { clampRoundedRadius: true },
  });
  const judgment = deps.judge ? await deps.judge.judge(diff, opts.scenario) : null;
  const reportPath = deps.reporter ? await deps.reporter.write(diff, judgment) : null;

  return { diff, judgment, reportPath, figmaTree, domTree };
}
