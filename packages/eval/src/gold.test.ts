import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, test } from 'vitest';
import { loadGold, runSample, tuneOnGold, type GoldEntry, type TuneConfig } from './gold';

const GOLD_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'gold');
const clamp: TuneConfig = { clampRoundedRadius: true, colorDeltaE: 2, pixel: 0.5 };
const naive: TuneConfig = { clampRoundedRadius: false, colorDeltaE: 2, pixel: 0.5 };

let entries: GoldEntry[];
const get = (id: string): GoldEntry => entries.find((e) => e.sample.id === id)!;

beforeAll(() => {
  entries = loadGold(GOLD_DIR);
});

describe('gold runSample', () => {
  test('loads all four synthetic samples', () => {
    expect(entries.map((e) => e.sample.id).sort()).toEqual([
      'faithful',
      'knob-misplaced',
      'wrong-color',
      'wrong-radius',
    ]);
  });

  test('faithful with clampRoundedRadius reports no findings', () => {
    const e = get('faithful');
    expect(runSample(e.figma, e.dom, clamp).findings).toEqual([]);
  });

  test('faithful without the rule false-positives on radius', () => {
    const e = get('faithful');
    expect(runSample(e.figma, e.dom, naive).findings.some((f) => f.startsWith('borderRadius'))).toBe(true);
  });

  test('wrong-color is caught', () => {
    const e = get('wrong-color');
    expect(runSample(e.figma, e.dom, clamp).findings).toContain('backgroundColor');
  });

  test('wrong-radius (4px) stays a real finding even with the rule on', () => {
    const e = get('wrong-radius');
    expect(runSample(e.figma, e.dom, clamp).findings.some((f) => f.startsWith('borderRadius'))).toBe(true);
  });

  test('knob-misplaced is caught geometrically', () => {
    const e = get('knob-misplaced');
    expect(runSample(e.figma, e.dom, clamp).findings).toContain('content-left');
  });
});

describe('tuneOnGold (self-iteration)', () => {
  test('converges to clampRoundedRadius=true at F1 1.0', async () => {
    const res = await tuneOnGold(GOLD_DIR);
    expect(res.bestMeanF1).toBe(1);
    expect(res.bestConfig.clampRoundedRadius).toBe(true);
    // 朴素基线（首轮）未达标，加圆角规则后达标
    expect(res.history[0]!.meanF1).toBeLessThan(1);
  });
});
