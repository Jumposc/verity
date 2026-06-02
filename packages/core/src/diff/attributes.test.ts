import { describe, expect, test } from 'vitest';
import { makeNode } from '../test-fixtures';
import { diffAttributes } from './attributes';
import type { AttributeDiff } from '../schema';

const find = (diffs: AttributeDiff[], attr: string): AttributeDiff | undefined =>
  diffs.find((d) => d.attr === attr);

describe('diffAttributes', () => {
  test('numeric attribute reports signed delta', () => {
    const diffs = diffAttributes(
      makeNode({ typography: { fontSize: 16 } }),
      makeNode({ typography: { fontSize: 14 } }),
    );
    expect(find(diffs, 'fontSize')).toEqual({
      attr: 'fontSize',
      design: 16,
      actual: 14,
      delta: -2,
      deltaE: null,
    });
  });

  test('color attribute reports hex values and deltaE, no delta', () => {
    const diffs = diffAttributes(
      makeNode({ typography: { color: { r: 20, g: 115, b: 230, a: 1 } } }),
      makeNode({ typography: { color: { r: 26, g: 123, b: 240, a: 1 } } }),
    );
    const c = find(diffs, 'color');
    expect(c?.design).toBe('#1473E6');
    expect(c?.actual).toBe('#1A7BF0');
    expect(c?.delta).toBeNull();
    expect(c?.deltaE).toBeGreaterThan(1);
    expect(c?.deltaE).toBeLessThan(5);
  });

  test('identical background color has deltaE 0', () => {
    const bg = { r: 255, g: 255, b: 255, a: 1 };
    const diffs = diffAttributes(
      makeNode({ fill: { backgroundColor: bg } }),
      makeNode({ fill: { backgroundColor: bg } }),
    );
    expect(find(diffs, 'backgroundColor')?.deltaE).toBe(0);
  });

  test('per-corner border radius diff', () => {
    const diffs = diffAttributes(
      makeNode({ border: { radius: [8, 8, 8, 8] } }),
      makeNode({ border: { radius: [8, 8, 4, 8] } }),
    );
    expect(find(diffs, 'borderRadius.br')?.delta).toBe(-4);
    expect(find(diffs, 'borderRadius.tl')?.delta).toBe(0);
  });

  test('enum attribute compared as string, no delta/deltaE', () => {
    const diffs = diffAttributes(
      makeNode({ layout: { display: 'flex' } }),
      makeNode({ layout: { display: 'block' } }),
    );
    expect(find(diffs, 'display')).toEqual({
      attr: 'display',
      design: 'flex',
      actual: 'block',
      delta: null,
      deltaE: null,
    });
  });

  test('emits attribute when only one side is present', () => {
    const diffs = diffAttributes(
      makeNode({ typography: { fontSize: 16 } }),
      makeNode({ typography: { fontSize: null } }),
    );
    expect(find(diffs, 'fontSize')).toEqual({
      attr: 'fontSize',
      design: 16,
      actual: null,
      delta: null,
      deltaE: null,
    });
  });

  test('skips attribute absent on both sides', () => {
    const diffs = diffAttributes(makeNode(), makeNode());
    expect(find(diffs, 'fontSize')).toBeUndefined();
  });

  test('does not diff declared gap (geometry handles spacing)', () => {
    const diffs = diffAttributes(
      makeNode({ layout: { gap: 8 } }),
      makeNode({ layout: { gap: 16 } }),
    );
    expect(find(diffs, 'gap')).toBeUndefined();
  });
});

describe('diffAttributes — clampRoundedRadius', () => {
  const track = (radius: number) =>
    makeNode({ rect: { x: 0, y: 0, w: 32, h: 16 }, border: { radius: [radius, radius, radius, radius] } });

  test('off by default: raw radius delta', () => {
    const diffs = diffAttributes(track(999), track(9999));
    expect(find(diffs, 'borderRadius.tl')?.delta).toBe(9000);
  });

  test('on: radii above half-min-dimension are equivalent (both fully rounded)', () => {
    const diffs = diffAttributes(track(999), track(9999), { clampRoundedRadius: true });
    // 32x16 → 钳到 min(32,16)/2 = 8，两侧都 8 → delta 0
    expect(find(diffs, 'borderRadius.tl')?.delta).toBe(0);
    expect(find(diffs, 'borderRadius.tl')?.design).toBe(8);
  });

  test('on: a radius below the threshold stays a real diff', () => {
    const diffs = diffAttributes(track(999), track(4), { clampRoundedRadius: true });
    // design 钳到 8，actual 4 < 8 不钳 → delta -4
    expect(find(diffs, 'borderRadius.tl')?.delta).toBe(-4);
  });
});
