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
  test('loads all six synthetic samples', () => {
    expect(entries.map((e) => e.sample.id).sort()).toEqual([
      'faithful',
      'instance-decor-noise',
      'instance-interior',
      'knob-misplaced',
      'wrong-color',
      'wrong-radius',
    ]);
  });

  test('instance-decor-noise: 实例内部装饰矢量不抢配真实节点，无假阳性', () => {
    // figma 端组件实例内有一层装饰矢量（白底/直角，DOM 端被 CSS 吸收无对应节点）。
    // 类型兼容度生效后该矢量落入 unmatched，不再抢配文本节点产假的 backgroundColor。
    const e = get('instance-decor-noise');
    expect(runSample(e.figma, e.dom, clamp).findings).toEqual([]);
  });

  test('instance-interior: 折叠实例内部装饰层、保留内部文本，无假阳性', () => {
    // figma 组件实例内有装饰 container（蓝条）+ 装饰 vector（icon）+ 内部文本（标题）。
    // collapseComponentInterior 折叠两个装饰层（DOM 端无对应、本会产假阳性），保留标题文本
    // 与 DOM 同构比对。装饰是 container（类型兼容度救不了）——必须靠折叠才无假阳性。
    const e = get('instance-interior');
    expect(runSample(e.figma, e.dom, clamp).findings).toEqual([]);
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
