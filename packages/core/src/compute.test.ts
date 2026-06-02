import { describe, expect, test } from 'vitest';
import { makeNode, makeTree } from './test-fixtures';
import { computeDiff } from './compute';
import type { GeometryDiff, Tolerance } from './schema';

const rel = (diffs: GeometryDiff[], relation: string) => diffs.find((d) => d.relation === relation);

// card > content 场景：content 顶部 inset 设计 20 / 实现 16，左侧两端均 20。
function scene() {
  const figma = makeTree('figma', [
    makeNode({ id: 'f-card', rect: { x: 0, y: 0, w: 200, h: 100 }, childIds: ['f-c'] }),
    makeNode({ id: 'f-c', rect: { x: 20, y: 20, w: 160, h: 60 }, parentId: 'f-card', text: 'Buy' }),
  ]);
  const dom = makeTree('dom', [
    makeNode({ id: 'd-card', source: 'dom', rect: { x: 0, y: 0, w: 200, h: 100 }, childIds: ['d-c'] }),
    makeNode({ id: 'd-c', source: 'dom', rect: { x: 20, y: 16, w: 160, h: 60 }, parentId: 'd-card', text: 'Buy' }),
  ]);
  return { figma, dom };
}

describe('computeDiff', () => {
  test('assembles one NodeDiff per pair with attributes and geometry', () => {
    const { figma, dom } = scene();
    const report = computeDiff(figma, dom);

    expect(report.nodes).toHaveLength(2);
    const content = report.nodes.find((n) => n.pair.figmaIds[0] === 'f-c');
    expect(content).toBeDefined();
    expect(rel(content!.geometry, 'content-top')).toEqual({
      relation: 'content-top',
      design: 20,
      actual: 16,
      delta: -4,
    });
  });

  test('baseline counts matched pairs and unmatched nodes', () => {
    const { figma, dom } = scene();
    // 加一个 figma 端无对应的孤立节点
    figma.nodes.push(makeNode({ id: 'f-orphan', rect: { x: 1400, y: 880, w: 10, h: 10 } }));
    const report = computeDiff(figma, dom);

    expect(report.baseline.matchedPairs).toBe(2);
    expect(report.baseline.unmatchedCount).toBe(1);
  });

  test('attributeMatchRate respects per-attribute tolerance', () => {
    const figma = makeTree('figma', [makeNode({ id: 'f1', rect: { x: 0, y: 0, w: 100, h: 40 }, typography: { fontSize: 16 } })]);
    const dom = makeTree('dom', [makeNode({ id: 'd1', source: 'dom', rect: { x: 0, y: 0, w: 100, h: 40 }, typography: { fontSize: 20 } })]);

    const strict = computeDiff(figma, dom); // pixel tol 1 → fontSize 差 4 算 mismatch
    const loose: Tolerance = { colorDeltaE: 2, pixel: 1, perAttribute: { fontSize: 10 } };
    const relaxed = computeDiff(figma, dom, loose);

    expect(strict.baseline.attributeMatchRate).toBeLessThan(1);
    expect(relaxed.baseline.attributeMatchRate).toBe(1);
  });

  test('geometryMae averages absolute geometry deltas', () => {
    const { figma, dom } = scene();
    // content-top |−4| = 4，content-left 0 → mae = 2
    expect(computeDiff(figma, dom).baseline.geometryMae).toBe(2);
  });

  test('source carries each tree root id', () => {
    const { figma, dom } = scene();
    const report = computeDiff(figma, dom);
    expect(report.source).toEqual({ figma: 'f-card', dom: 'd-card' });
  });
});
