import { describe, expect, test } from 'vitest';
import type { DiffReport, NodePair } from '@solvir/verity-core';
import { cropForJudge } from './crop';

const pair = (figmaIds: string[], domIds: string[], ambiguous = false): NodePair => ({
  figmaIds,
  domIds,
  confidence: ambiguous ? 0.4 : 0.9,
  signals: { geometry: 0.9, text: 0, role: 0, component: 0, hierarchy: 1 },
  ambiguous,
});

const report: DiffReport = {
  source: { figma: 'F', dom: 'D' },
  baseline: { matchedPairs: 2, unmatchedCount: 1, attributeMatchRate: 0.5, geometryMae: 1.5 },
  nodes: [
    {
      pair: pair(['a'], ['da']),
      attributes: [
        { attr: 'fontSize', design: 16, actual: 16, delta: 0, deltaE: null }, // in-tol → drop
        { attr: 'backgroundColor', design: '#FFFFFF', actual: '#1A7BF0', delta: null, deltaE: 8 }, // notable
        { attr: 'borderRadius.tl', design: 8, actual: 4, delta: -4, deltaE: null }, // notable
      ],
      geometry: [
        { relation: 'content-top', design: 20, actual: 20, delta: 0 }, // in-tol → drop
        { relation: 'content-left', design: 24, actual: 21, delta: -3 }, // notable
      ],
    },
    {
      pair: pair(['b'], ['db'], true), // ambiguous
      attributes: [{ attr: 'color', design: '#000000', actual: '#000000', delta: null, deltaE: 0.5 }], // in-tol → drop
      geometry: [],
    },
  ],
};

describe('cropForJudge', () => {
  test('keeps notable attributes, drops in-tolerance ones, tags nodeId', () => {
    const out = cropForJudge(report);
    const attrs = out.attributes.map((a) => a.attr);
    expect(attrs).toContain('backgroundColor');
    expect(attrs).toContain('borderRadius.tl');
    expect(attrs).not.toContain('fontSize');
    expect(attrs).not.toContain('color'); // deltaE 0.5 within tolerance
    expect(out.attributes.every((a) => a.nodeId === 'a')).toBe(true);
  });

  test('sorts attributes by magnitude descending', () => {
    const out = cropForJudge(report);
    expect(out.attributes[0]!.attr).toBe('backgroundColor'); // ΔE 8 > |−4|
    expect(out.attributes[1]!.attr).toBe('borderRadius.tl');
  });

  test('keeps notable geometry with nodeId', () => {
    const out = cropForJudge(report);
    expect(out.geometry).toHaveLength(1);
    expect(out.geometry[0]).toMatchObject({ relation: 'content-left', delta: -3, nodeId: 'a' });
  });

  test('collects ambiguous pairs for disambiguation', () => {
    const out = cropForJudge(report);
    expect(out.ambiguousPairs).toHaveLength(1);
    expect(out.ambiguousPairs[0]!.figmaIds).toEqual(['b']);
  });

  test('carries baseline, source and scenario', () => {
    const out = cropForJudge(report, { scenario: { viewport: { width: 1440, height: 900 } } });
    expect(out.baseline).toEqual(report.baseline);
    expect(out.source).toEqual({ figma: 'F', dom: 'D' });
    expect(out.scenario?.viewport).toEqual({ width: 1440, height: 900 });
  });

  test('caps to maxItems and flags truncation', () => {
    const out = cropForJudge(report, { maxItems: 1 });
    expect(out.attributes).toHaveLength(1);
    expect(out.truncated).toBe(true);
  });

  test('not truncated when under the cap', () => {
    expect(cropForJudge(report).truncated).toBe(false);
  });
});
