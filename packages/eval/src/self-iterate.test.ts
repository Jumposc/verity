import { describe, expect, test } from 'vitest';
import { selfIterate } from './self-iterate';
import type { GoldSample, SampleRunner } from './types';

const samples: GoldSample[] = [
  { id: 'a', figmaFileKey: 'k', figmaNodeId: '1', url: 'http://x', expected: { fidelityScore: 80, criticalFindings: ['x'] } },
];

// config = "调参档位"：>=2 时工具才能命中 gold finding。
const makeRunner = (level: number): SampleRunner => ({
  run: async () => ({ fidelityScore: 80, findings: level >= 2 ? ['x'] : [] }),
});

describe('selfIterate', () => {
  test('converges once tuned config reaches the target F1', async () => {
    const res = await selfIterate<number>(samples, {
      initialConfig: 0,
      makeRunner,
      tune: (ctx) => ctx.config + 1,
      targetF1: 0.9,
      maxIterations: 5,
    });
    expect(res.bestMeanF1).toBe(1);
    expect(res.bestConfig).toBe(2);
    expect(res.history).toHaveLength(3); // level 0,1 未达标，2 命中后停
  });

  test('stops at maxIterations when tuning never improves', async () => {
    const res = await selfIterate<number>(samples, {
      initialConfig: 0,
      makeRunner,
      tune: (ctx) => ctx.config, // 原地踏步
      targetF1: 0.9,
      maxIterations: 3,
    });
    expect(res.history).toHaveLength(3);
    expect(res.bestMeanF1).toBe(0);
  });
});
