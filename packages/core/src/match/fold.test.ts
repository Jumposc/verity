import { describe, expect, test } from 'vitest';
import { makeNode, makeTree } from '../test-fixtures';
import { foldWrappers } from './fold';
import { computeDiff } from '../compute';
import type { StyleNode } from '../schema';

const byId = (nodes: StyleNode[], id: string): StyleNode | undefined => nodes.find((n) => n.id === id);
const gray = { r: 200, g: 200, b: 200, a: 1 };

describe('foldWrappers', () => {
  test('folds a coincident single-child wrapper and merges styles', () => {
    const tree = makeTree('figma', [
      makeNode({ id: 'c', rect: { x: 0, y: 0, w: 32, h: 16 }, componentName: 'Sw', childIds: ['t'] }),
      makeNode({
        id: 't',
        rect: { x: 0, y: 0, w: 32, h: 16 },
        parentId: 'c',
        fill: { backgroundColor: gray, backgroundKind: 'solid' },
        border: { radius: [9, 9, 9, 9] },
        childIds: ['k'],
      }),
      makeNode({ id: 'k', rect: { x: 1, y: 1, w: 14, h: 14 }, parentId: 't' }),
    ]);
    const folded = foldWrappers(tree);

    expect(folded.nodes).toHaveLength(2);
    expect(byId(folded.nodes, 't')).toBeUndefined();
    const c = byId(folded.nodes, 'c')!;
    expect(c.fill.backgroundColor).toEqual(gray); // 子节点的视觉样式合并上来
    expect(c.border.radius).toEqual([9, 9, 9, 9]);
    expect(c.componentName).toBe('Sw'); // 外层身份保留
    expect(c.childIds).toEqual(['k']); // 孙节点上提
    expect(byId(folded.nodes, 'k')!.parentId).toBe('c'); // 并 reparent
  });

  test('does not fold when child rect differs', () => {
    const tree = makeTree('dom', [
      makeNode({ id: 'p', source: 'dom', rect: { x: 0, y: 0, w: 32, h: 16 }, childIds: ['q'] }),
      makeNode({ id: 'q', source: 'dom', rect: { x: 1, y: 1, w: 14, h: 14 }, parentId: 'p' }),
    ]);
    expect(foldWrappers(tree).nodes).toHaveLength(2);
  });

  test('does not fold a node with multiple children', () => {
    const tree = makeTree('figma', [
      makeNode({ id: 'p', rect: { x: 0, y: 0, w: 10, h: 10 }, childIds: ['a', 'b'] }),
      makeNode({ id: 'a', rect: { x: 0, y: 0, w: 10, h: 10 }, parentId: 'p' }),
      makeNode({ id: 'b', rect: { x: 0, y: 0, w: 10, h: 10 }, parentId: 'p' }),
    ]);
    expect(foldWrappers(tree).nodes).toHaveLength(3);
  });

  test('collapses a transitive coincident chain into one node', () => {
    const tree = makeTree('figma', [
      makeNode({ id: 'a', rect: { x: 0, y: 0, w: 20, h: 20 }, childIds: ['b'] }),
      makeNode({ id: 'b', rect: { x: 0, y: 0, w: 20, h: 20 }, parentId: 'a', childIds: ['c'] }),
      makeNode({ id: 'c', rect: { x: 0, y: 0, w: 20, h: 20 }, parentId: 'b', childIds: ['leaf'] }),
      makeNode({ id: 'leaf', rect: { x: 2, y: 2, w: 5, h: 5 }, parentId: 'c' }),
    ]);
    const folded = foldWrappers(tree);
    expect(folded.nodes).toHaveLength(2);
    expect(byId(folded.nodes, 'a')!.childIds).toEqual(['leaf']);
    expect(byId(folded.nodes, 'leaf')!.parentId).toBe('a');
  });
});

describe('computeDiff folds wrappers before matching', () => {
  test('figma COMPONENT shell no longer scrambles matching', () => {
    // figma：component 壳套同尺寸 track，再套 knob（3 层）
    const figma = makeTree('figma', [
      makeNode({ id: 'comp', rect: { x: 0, y: 0, w: 32, h: 16 }, componentName: 'Switch', childIds: ['track'] }),
      makeNode({ id: 'track', rect: { x: 0, y: 0, w: 32, h: 16 }, parentId: 'comp', fill: { backgroundColor: gray, backgroundKind: 'solid' }, childIds: ['knob'] }),
      makeNode({ id: 'knob', rect: { x: 1, y: 1, w: 14, h: 14 }, parentId: 'track', fill: { backgroundColor: { r: 255, g: 255, b: 255, a: 1 }, backgroundKind: 'solid' } }),
    ]);
    // dom：button > span（2 层）
    const dom = makeTree('dom', [
      makeNode({ id: 'button', source: 'dom', rect: { x: 0, y: 0, w: 32, h: 16 }, fill: { backgroundColor: gray, backgroundKind: 'solid' }, childIds: ['span'] }),
      makeNode({ id: 'span', source: 'dom', rect: { x: 1, y: 1, w: 14, h: 14 }, parentId: 'button', fill: { backgroundColor: { r: 255, g: 255, b: 255, a: 1 }, backgroundKind: 'solid' } }),
    ]);
    const report = computeDiff(figma, dom);
    expect(report.baseline.matchedPairs).toBe(2);
    expect(report.baseline.unmatchedCount).toBe(0);
    expect(report.baseline.geometryMae).toBe(0);
  });
});
