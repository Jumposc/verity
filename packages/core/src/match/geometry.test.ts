import { describe, expect, test } from 'vitest';
import { makeNode, makeTree } from '../test-fixtures';
import { matchTrees } from './geometry';

describe('matchTrees', () => {
  test('pairs a clean 1-1 match with high confidence', () => {
    const figma = makeTree('figma', [
      makeNode({ id: 'f1', rect: { x: 100, y: 100, w: 200, h: 50 }, text: 'Hi' }),
    ]);
    const dom = makeTree('dom', [
      makeNode({ id: 'd1', source: 'dom', rect: { x: 100, y: 100, w: 200, h: 50 }, text: 'Hi' }),
    ]);
    const res = matchTrees(figma, dom);

    expect(res.pairs).toHaveLength(1);
    expect(res.pairs[0]!.figmaIds).toEqual(['f1']);
    expect(res.pairs[0]!.domIds).toEqual(['d1']);
    expect(res.pairs[0]!.confidence).toBeGreaterThan(0.9);
    expect(res.pairs[0]!.signals.geometry).toBeCloseTo(1, 5);
    expect(res.pairs[0]!.signals.text).toBe(1);
    expect(res.pairs[0]!.ambiguous).toBe(false);
    expect(res.unmatchedFigma).toEqual([]);
    expect(res.unmatchedDom).toEqual([]);
  });

  test('text content breaks a geometric tie', () => {
    const r = { x: 0, y: 0, w: 100, h: 40 };
    const figma = makeTree('figma', [makeNode({ id: 'f1', rect: r, text: 'Submit' })]);
    const dom = makeTree('dom', [
      makeNode({ id: 'd1', source: 'dom', rect: r, text: 'Submit' }),
      makeNode({ id: 'd2', source: 'dom', rect: r, text: 'Cancel' }),
    ]);
    const res = matchTrees(figma, dom);

    expect(res.pairs).toHaveLength(1);
    expect(res.pairs[0]!.domIds).toEqual(['d1']);
    expect(res.pairs[0]!.ambiguous).toBe(false);
    expect(res.unmatchedDom).toEqual(['d2']);
  });

  test('leaves far-apart nodes unmatched below confidence floor', () => {
    const figma = makeTree('figma', [makeNode({ id: 'f1', rect: { x: 0, y: 0, w: 10, h: 10 } })]);
    const dom = makeTree('dom', [
      makeNode({ id: 'd1', source: 'dom', rect: { x: 1400, y: 880, w: 10, h: 10 } }),
    ]);
    const res = matchTrees(figma, dom);

    expect(res.pairs).toEqual([]);
    expect(res.unmatchedFigma).toEqual(['f1']);
    expect(res.unmatchedDom).toEqual(['d1']);
  });

  test('flags ambiguous when two candidates are indistinguishable', () => {
    const r = { x: 10, y: 10, w: 80, h: 30 };
    const figma = makeTree('figma', [makeNode({ id: 'f1', rect: r, text: 'X' })]);
    const dom = makeTree('dom', [
      makeNode({ id: 'd1', source: 'dom', rect: r, text: 'X' }),
      makeNode({ id: 'd2', source: 'dom', rect: r, text: 'X' }),
    ]);
    const res = matchTrees(figma, dom);

    expect(res.pairs).toHaveLength(1);
    expect(res.pairs[0]!.ambiguous).toBe(true);
  });
});
