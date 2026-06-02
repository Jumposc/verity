import { describe, expect, test } from 'vitest';
import { evaluate } from './evaluate';
import type { GoldSample, SampleRunner, ToolOutput } from './types';

const sample = (id: string, score: number, findings: string[]): GoldSample => ({
  id,
  figmaFileKey: 'k',
  figmaNodeId: '1:2',
  url: 'http://x',
  expected: { fidelityScore: score, criticalFindings: findings },
});

const runnerOf = (out: Record<string, ToolOutput>): SampleRunner => ({
  run: async (s) => out[s.id]!,
});

describe('evaluate', () => {
  test('perfect agreement scores F1 1 and zero score delta', async () => {
    const samples = [sample('a', 80, ['padding 偏小', '字色偏深'])];
    const runner = runnerOf({ a: { fidelityScore: 80, findings: ['padding 偏小', '字色偏深'] } });
    const [r] = await evaluate(samples, runner);
    expect(r!.findingF1).toBe(1);
    expect(r!.scoreDelta).toBe(0);
    expect(r!.truePositives).toBe(2);
    expect(r!.falsePositives).toBe(0);
    expect(r!.falseNegatives).toBe(0);
  });

  test('counts false positive when tool reports an extra finding', async () => {
    const samples = [sample('a', 80, ['padding 偏小'])];
    const runner = runnerOf({ a: { fidelityScore: 75, findings: ['padding 偏小', '多报的问题'] } });
    const [r] = await evaluate(samples, runner);
    expect(r!.truePositives).toBe(1);
    expect(r!.falsePositives).toBe(1);
    expect(r!.falseNegatives).toBe(0);
    expect(r!.scoreDelta).toBe(-5);
  });

  test('counts false negative when tool misses a gold finding', async () => {
    const samples = [sample('a', 80, ['padding 偏小', '圆角不对'])];
    const runner = runnerOf({ a: { fidelityScore: 90, findings: ['padding 偏小'] } });
    const [r] = await evaluate(samples, runner);
    expect(r!.truePositives).toBe(1);
    expect(r!.falseNegatives).toBe(1);
  });

  test('matches findings by substring, not exact equality', async () => {
    const samples = [sample('a', 80, ['padding'])];
    const runner = runnerOf({ a: { fidelityScore: 80, findings: ['padding-left 实际偏小 4px'] } });
    const [r] = await evaluate(samples, runner);
    expect(r!.truePositives).toBe(1);
    expect(r!.falsePositives).toBe(0);
  });

  test('empty gold and empty tool findings count as full agreement', async () => {
    const samples = [sample('a', 100, [])];
    const runner = runnerOf({ a: { fidelityScore: 100, findings: [] } });
    const [r] = await evaluate(samples, runner);
    expect(r!.findingF1).toBe(1);
  });
});
