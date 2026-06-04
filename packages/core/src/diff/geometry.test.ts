import { describe, expect, test } from 'vitest';
import { makeNode, makeTree } from '../test-fixtures';
import { diffGeometry } from './geometry';
import type { GeometryDiff, NodePair } from '../schema';

const pair = (figmaIds: string[], domIds: string[]): NodePair => ({
  figmaIds,
  domIds,
  confidence: 1,
  signals: { geometry: 1, text: 0, role: 0, component: 0, hierarchy: 0 },
  ambiguous: false,
});

const rel = (diffs: GeometryDiff[], relation: string): GeometryDiff | undefined =>
  diffs.find((d) => d.relation === relation);

describe('diffGeometry — parent-child inset', () => {
  // figma: card(0,0,200,100) > content(24,24,...)  —— 设计端一层画 24px inset
  // dom:   card(0,0,200,100) > wrap(20,20,..) > content(24,24,..) —— 20+4 嵌套
  // 配对穿透 wrap，content 相对最近已配对祖先 card 的 inset 两端都是 24。
  const figma = makeTree('figma', [
    makeNode({ id: 'f-card', rect: { x: 0, y: 0, w: 200, h: 100 }, childIds: ['f-content'] }),
    makeNode({ id: 'f-content', rect: { x: 24, y: 24, w: 152, h: 52 }, parentId: 'f-card' }),
  ]);

  function domTree(contentInset: number) {
    return makeTree('dom', [
      makeNode({ id: 'd-card', source: 'dom', rect: { x: 0, y: 0, w: 200, h: 100 }, childIds: ['d-wrap'] }),
      makeNode({
        id: 'd-wrap',
        source: 'dom',
        rect: { x: 20, y: 20, w: 160, h: 60 },
        parentId: 'd-card',
        childIds: ['d-content'],
        isLayoutWrapper: true,
      }),
      makeNode({
        id: 'd-content',
        source: 'dom',
        rect: { x: contentInset, y: contentInset, w: 152, h: 52 },
        parentId: 'd-wrap',
      }),
    ]);
  }

  const pairs = [pair(['f-card'], ['d-card']), pair(['f-content'], ['d-content'])];

  test('inset absorbs intermediate wrapper padding (delta 0)', () => {
    const out = diffGeometry(figma, domTree(24), pairs);
    expect(rel(out[1]!, 'content-top')).toEqual({ relation: 'content-top', design: 24, actual: 24, delta: 0 });
    expect(rel(out[1]!, 'content-left')).toEqual({ relation: 'content-left', design: 24, actual: 24, delta: 0 });
  });

  test('reports delta when actual inset differs', () => {
    const out = diffGeometry(figma, domTree(20), pairs);
    expect(rel(out[1]!, 'content-top')).toEqual({ relation: 'content-top', design: 24, actual: 20, delta: -4 });
  });

  test('root pair (no matched ancestor) has no inset relation', () => {
    const out = diffGeometry(figma, domTree(24), pairs);
    expect(rel(out[0]!, 'content-top')).toBeUndefined();
  });
});

describe('diffGeometry — scale to design space', () => {
  test('scales actual distances by frame width ratio', () => {
    const figma = makeTree(
      'figma',
      [
        makeNode({ id: 'f-card', rect: { x: 0, y: 0, w: 400, h: 200 }, childIds: ['f-c'] }),
        makeNode({ id: 'f-c', rect: { x: 24, y: 24, w: 100, h: 100 }, parentId: 'f-card' }),
      ],
      { w: 1440 },
    );
    // dom 渲染在半宽 720，inset 实测 12px → 换算到 design 空间应为 24
    const dom = makeTree(
      'dom',
      [
        makeNode({ id: 'd-card', source: 'dom', rect: { x: 0, y: 0, w: 200, h: 100 }, childIds: ['d-c'] }),
        makeNode({ id: 'd-c', source: 'dom', rect: { x: 12, y: 12, w: 50, h: 50 }, parentId: 'd-card' }),
      ],
      { w: 720 },
    );
    const pairs = [pair(['f-card'], ['d-card']), pair(['f-c'], ['d-c'])];
    expect(rel(diffGeometry(figma, dom, pairs)[1]!, 'content-top')?.actual).toBe(24);
  });
});

describe('diffGeometry — 内部图元跳过几何', () => {
  // 折叠后内部文本 reparent 到实例根，其 inset 参考系（远祖）与 DOM 实际解析的最近祖先不同构，
  // content-*/sibling-gap 会产出系统性虚差。insideComponent 的节点只留 attribute diff，不评判几何。
  test('insideComponent 节点不产 content-* / sibling-gap，顶层兄弟照常', () => {
    const figma = makeTree('figma', [
      makeNode({ id: 'root', rect: { x: 0, y: 0, w: 200, h: 100 }, childIds: ['inst', 'sib'] }),
      // 实例根（非 insideComponent）下挂被 reparent 上来的内部文本（insideComponent），x=48 远离根
      makeNode({ id: 'inst', rect: { x: 0, y: 0, w: 120, h: 40 }, parentId: 'root', childIds: ['inner'] }),
      makeNode({ id: 'inner', kind: 'text', rect: { x: 48, y: 20, w: 60, h: 16 }, parentId: 'inst', insideComponent: true, text: 'X' }),
      // 顶层兄弟（非 insideComponent）
      makeNode({ id: 'sib', rect: { x: 0, y: 60, w: 120, h: 30 }, parentId: 'root' }),
    ]);
    const dom = makeTree('dom', [
      makeNode({ id: 'd-root', source: 'dom', rect: { x: 0, y: 0, w: 200, h: 100 }, childIds: ['d-inst', 'd-sib'] }),
      makeNode({ id: 'd-inst', source: 'dom', rect: { x: 0, y: 0, w: 120, h: 40 }, parentId: 'd-root', childIds: ['d-inner'] }),
      makeNode({ id: 'd-inner', source: 'dom', kind: 'text', rect: { x: 30, y: 18, w: 60, h: 16 }, parentId: 'd-inst', text: 'X' }),
      makeNode({ id: 'd-sib', source: 'dom', rect: { x: 0, y: 60, w: 120, h: 30 }, parentId: 'd-root' }),
    ]);
    const pairs = [
      pair(['root'], ['d-root']),
      pair(['inst'], ['d-inst']),
      pair(['inner'], ['d-inner']),
      pair(['sib'], ['d-sib']),
    ];
    const out = diffGeometry(figma, dom, pairs);
    // 内部文本（index 2）：content-* 全部跳过（否则会报 48 vs 30 的参考系虚差）
    expect(out[2]!).toEqual([]);
    // 顶层节点照常产 inset（inst index 1 相对 root；sib index 3 相对 root）
    expect(rel(out[1]!, 'content-top')).toBeDefined();
    expect(rel(out[3]!, 'content-top')).toBeDefined();
  });
});

describe('diffGeometry — sibling gap', () => {
  test('measures gap between adjacent row siblings', () => {
    const figma = makeTree('figma', [
      makeNode({
        id: 'f-row',
        rect: { x: 0, y: 0, w: 200, h: 40 },
        childIds: ['f-a', 'f-b'],
        layout: { flexDirection: 'row' },
      }),
      makeNode({ id: 'f-a', rect: { x: 0, y: 0, w: 50, h: 40 }, parentId: 'f-row' }),
      makeNode({ id: 'f-b', rect: { x: 74, y: 0, w: 50, h: 40 }, parentId: 'f-row' }), // gap 24
    ]);
    const dom = makeTree('dom', [
      makeNode({ id: 'd-row', source: 'dom', rect: { x: 0, y: 0, w: 200, h: 40 }, childIds: ['d-a', 'd-b'], layout: { flexDirection: 'row' } }),
      makeNode({ id: 'd-a', source: 'dom', rect: { x: 0, y: 0, w: 50, h: 40 }, parentId: 'd-row' }),
      makeNode({ id: 'd-b', source: 'dom', rect: { x: 70, y: 0, w: 50, h: 40 }, parentId: 'd-row' }), // gap 20
    ]);
    const pairs = [
      pair(['f-row'], ['d-row']),
      pair(['f-a'], ['d-a']),
      pair(['f-b'], ['d-b']),
    ];
    const out = diffGeometry(figma, dom, pairs);
    // 间隙归属后一个兄弟（f-b / index 2）
    expect(rel(out[2]!, 'sibling-gap')).toEqual({ relation: 'sibling-gap', design: 24, actual: 20, delta: -4 });
  });
});
