/**
 * 评测器（design.md 12）：跑工具产出，与 gold 比对，算 findings 的 TP/FP/FN/F1
 * 与还原度分偏差。findings 自由文本按子串双向吻合匹配。确定性、可单测。
 */
import type { EvalResult, GoldSample, SampleRunner } from './types';

function norm(s: string): string {
  return s.trim().toLowerCase();
}

/** 两条 finding 文本是否吻合：任一为另一子串。 */
function matches(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  return x.length > 0 && y.length > 0 && (x.includes(y) || y.includes(x));
}

function f1(precision: number, recall: number): number {
  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

function compare(gold: string[], tool: string[]): Pick<EvalResult, 'truePositives' | 'falsePositives' | 'falseNegatives' | 'findingF1'> {
  if (gold.length === 0 && tool.length === 0) {
    return { truePositives: 0, falsePositives: 0, falseNegatives: 0, findingF1: 1 };
  }
  const matchedGold = gold.filter((g) => tool.some((t) => matches(t, g))).length;
  const matchedTool = tool.filter((t) => gold.some((g) => matches(t, g))).length;
  const truePositives = matchedGold;
  const falseNegatives = gold.length - matchedGold;
  const falsePositives = tool.length - matchedTool;
  const precision = tool.length ? matchedTool / tool.length : 0;
  const recall = gold.length ? matchedGold / gold.length : 0;
  return { truePositives, falsePositives, falseNegatives, findingF1: f1(precision, recall) };
}

/** 跑一遍评测集，对比工具产出与 gold。 */
export async function evaluate(samples: GoldSample[], runner: SampleRunner): Promise<EvalResult[]> {
  const results: EvalResult[] = [];
  for (const sample of samples) {
    const out = await runner.run(sample);
    const cmp = compare(sample.expected.criticalFindings, out.findings);
    results.push({
      sampleId: sample.id,
      toolScore: out.fidelityScore,
      expectedScore: sample.expected.fidelityScore,
      scoreDelta: out.fidelityScore - sample.expected.fidelityScore,
      ...cmp,
    });
  }
  return results;
}

/** 评测集汇总指标，供自迭代判断收敛。 */
export function meanF1(results: EvalResult[]): number {
  if (results.length === 0) return 0;
  return results.reduce((s, r) => s + r.findingF1, 0) / results.length;
}

/** 还原度分平均绝对偏差。 */
export function scoreMae(results: EvalResult[]): number {
  if (results.length === 0) return 0;
  return results.reduce((s, r) => s + Math.abs(r.scoreDelta), 0) / results.length;
}
