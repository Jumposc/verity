import { describe, expect, test } from 'vitest';
import { makeNode, makeTree } from '../test-fixtures';
import { collapseComponentInterior, foldWrappers } from './fold';
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

describe('collapseComponentInterior', () => {
  test('removes interior decoration layers, keeps text content, reparents to instance root', () => {
    const tree = makeTree('figma', [
      makeNode({ id: 'inst', rect: { x: 0, y: 0, w: 200, h: 80 }, componentName: 'Card', childIds: ['bar', 'icon', 'title'] }),
      makeNode({ id: 'bar', kind: 'container', rect: { x: 0, y: 0, w: 200, h: 4 }, parentId: 'inst', insideComponent: true, fill: { backgroundColor: { r: 45, g: 95, b: 240, a: 1 }, backgroundKind: 'solid' } }),
      makeNode({ id: 'icon', kind: 'vector', rect: { x: 16, y: 44, w: 24, h: 24 }, parentId: 'inst', insideComponent: true }),
      makeNode({ id: 'title', kind: 'text', rect: { x: 16, y: 16, w: 100, h: 20 }, parentId: 'inst', insideComponent: true, text: 'Hello' }),
    ]);
    const out = collapseComponentInterior(tree);

    expect(byId(out.nodes, 'bar')).toBeUndefined(); // 装饰 container 移除
    expect(byId(out.nodes, 'icon')).toBeUndefined(); // 装饰 vector 移除
    expect(byId(out.nodes, 'title')).toBeDefined(); // 内部文本保留
    expect(byId(out.nodes, 'title')!.parentId).toBe('inst'); // reparent 到实例根
    expect(byId(out.nodes, 'inst')!.childIds).toEqual(['title']);
    expect(byId(out.nodes, 'inst')!.weakCoverage).toBe(true); // 实例根标弱覆盖（内部交截图兜底）
  });

  test('reparents interior text up through nested decoration wrappers', () => {
    const tree = makeTree('figma', [
      makeNode({ id: 'inst', rect: { x: 0, y: 0, w: 100, h: 40 }, componentName: 'Btn', childIds: ['wrap'] }),
      makeNode({ id: 'wrap', kind: 'container', rect: { x: 0, y: 0, w: 100, h: 40 }, parentId: 'inst', insideComponent: true, childIds: ['label'] }),
      makeNode({ id: 'label', kind: 'text', rect: { x: 20, y: 12, w: 60, h: 16 }, parentId: 'wrap', insideComponent: true, text: 'OK' }),
    ]);
    const out = collapseComponentInterior(tree);

    expect(byId(out.nodes, 'wrap')).toBeUndefined();
    expect(byId(out.nodes, 'label')!.parentId).toBe('inst');
    expect(byId(out.nodes, 'inst')!.childIds).toEqual(['label']);
  });

  test('leaves nodes without insideComponent untouched (page layout, not a component)', () => {
    const tree = makeTree('figma', [
      makeNode({ id: 'page', rect: { x: 0, y: 0, w: 100, h: 100 }, childIds: ['box'] }),
      makeNode({ id: 'box', kind: 'container', rect: { x: 10, y: 10, w: 50, h: 50 }, parentId: 'page' }),
    ]);
    expect(collapseComponentInterior(tree).nodes).toHaveLength(2);
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
