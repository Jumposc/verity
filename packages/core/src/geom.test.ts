import { describe, expect, test } from 'vitest';
import { gapX, gapY, iou, scaleRect } from './geom';
import type { Rect } from './schema';

const r = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

describe('iou', () => {
  test('is 1 for identical rects', () => {
    expect(iou(r(0, 0, 10, 10), r(0, 0, 10, 10))).toBe(1);
  });

  test('is 0 for disjoint rects', () => {
    expect(iou(r(0, 0, 10, 10), r(100, 100, 10, 10))).toBe(0);
  });

  test('computes partial overlap', () => {
    // a∩b = 5*10 = 50, a∪b = 100 + 100 - 50 = 150
    expect(iou(r(0, 0, 10, 10), r(5, 0, 10, 10))).toBeCloseTo(1 / 3, 5);
  });

  test('is 0 when a degenerate rect has zero area', () => {
    expect(iou(r(0, 0, 0, 10), r(0, 0, 10, 10))).toBe(0);
  });
});

describe('scaleRect', () => {
  test('scales position and size per axis', () => {
    expect(scaleRect(r(10, 20, 30, 40), 2, 0.5)).toEqual(r(20, 10, 60, 20));
  });
});

describe('gapX / gapY', () => {
  test('positive gap when b is right of a', () => {
    expect(gapX(r(0, 0, 10, 10), r(20, 0, 10, 10))).toBe(10);
  });

  test('symmetric when b is left of a', () => {
    expect(gapX(r(20, 0, 10, 10), r(0, 0, 10, 10))).toBe(10);
  });

  test('negative gap when boxes overlap on x', () => {
    expect(gapX(r(0, 0, 10, 10), r(5, 0, 10, 10))).toBe(-5);
  });

  test('positive gap when b is below a', () => {
    expect(gapY(r(0, 0, 10, 10), r(0, 25, 10, 10))).toBe(15);
  });
});
