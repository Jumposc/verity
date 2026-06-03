import { describe, expect, test } from 'vitest';
import switchOff from '../../test/fixtures/figma/switch-off.json';
import { figmaToStyleTree, type FigmaApiNode } from './figma';
import type { StyleNode } from '../schema';

const byId = (nodes: StyleNode[], id: string): StyleNode | undefined => nodes.find((n) => n.id === id);

const node = (over: Partial<FigmaApiNode>): FigmaApiNode => ({
  id: 'x',
  name: 'x',
  type: 'FRAME',
  absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 },
  ...over,
});

describe('figmaToStyleTree — real shadcn Switch fixture', () => {
  const tree = figmaToStyleTree(switchOff as unknown as FigmaApiNode);

  test('root node becomes the frame origin', () => {
    expect(tree.rootId).toBe('309:1578');
    expect(tree.frame).toEqual({ x: 0, y: 0, w: 32, h: 16 });
    expect(tree.nodes).toHaveLength(3);
  });

  test('rects are translated to root-frame coordinates', () => {
    expect(byId(tree.nodes, '309:1579')!.rect).toEqual({ x: 0, y: 0, w: 32, h: 16 }); // track
    expect(byId(tree.nodes, '309:1580')!.rect).toEqual({ x: 1, y: 1, w: 14, h: 14 }); // knob inset
  });

  test('SOLID fill maps to backgroundColor (0-255) + solid kind', () => {
    expect(byId(tree.nodes, '309:1579')!.fill).toMatchObject({
      backgroundColor: { r: 212, g: 212, b: 212, a: 1 },
      backgroundKind: 'solid',
    });
    expect(byId(tree.nodes, '309:1580')!.fill.backgroundColor).toEqual({ r: 255, g: 255, b: 255, a: 1 });
  });

  test('component with no fills is backgroundKind none', () => {
    expect(byId(tree.nodes, '309:1578')!.fill.backgroundKind).toBe('none');
  });

  test('cornerRadius maps to four-corner radius', () => {
    expect(byId(tree.nodes, '309:1579')!.border.radius).toEqual([999, 999, 999, 999]);
  });

  test('empty strokes means no border width even if strokeWeight is set', () => {
    expect(byId(tree.nodes, '309:1579')!.border.width).toBeNull();
  });

  test('COMPONENT carries componentName; plain FRAME does not', () => {
    expect(byId(tree.nodes, '309:1578')!.kind).toBe('container');
    expect(byId(tree.nodes, '309:1578')!.componentName).toBe('State=Off');
    expect(byId(tree.nodes, '309:1579')!.componentName).toBeNull();
  });

  test('parent/child links are wired', () => {
    expect(byId(tree.nodes, '309:1578')!.childIds).toEqual(['309:1579']);
    expect(byId(tree.nodes, '309:1579')!.parentId).toBe('309:1578');
    expect(byId(tree.nodes, '309:1580')!.parentId).toBe('309:1579');
  });
});

describe('figmaToStyleTree — field mapping (micro fixtures)', () => {
  test('TEXT maps to typography + text content, fill is not treated as background', () => {
    const tree = figmaToStyleTree(
      node({
        id: 't',
        name: 'Label',
        type: 'TEXT',
        absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 24 },
        characters: 'Buy now',
        style: {
          fontFamily: 'Inter',
          fontWeight: 600,
          fontSize: 16,
          letterSpacing: 0,
          lineHeightPx: 24,
          textAlignHorizontal: 'CENTER',
        },
        fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }],
      }),
    );
    const t = tree.nodes[0]!;
    expect(t.kind).toBe('text');
    expect(t.text).toBe('Buy now');
    expect(t.typography).toEqual({
      fontFamily: 'Inter',
      fontSize: 16,
      fontWeight: 600,
      lineHeight: 24,
      letterSpacing: 0,
      textAlign: 'center',
      color: { r: 255, g: 255, b: 255, a: 1 },
    });
    expect(t.fill.backgroundKind).toBe('none');
  });

  test('auto-layout maps to flex layout + padding box', () => {
    const tree = figmaToStyleTree(
      node({
        layoutMode: 'HORIZONTAL',
        itemSpacing: 8,
        primaryAxisAlignItems: 'CENTER',
        counterAxisAlignItems: 'MIN',
        paddingLeft: 24,
        paddingRight: 24,
        paddingTop: 16,
        paddingBottom: 16,
      }),
    );
    const n = tree.nodes[0]!;
    expect(n.layout).toEqual({
      display: 'flex',
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'flex-start',
      gap: 8,
    });
    expect(n.box.padding).toEqual([16, 24, 16, 24]); // T R B L
  });

  test('IMAGE fill is weak coverage with imageRef', () => {
    const tree = figmaToStyleTree(node({ fills: [{ type: 'IMAGE', imageRef: 'abc123', scaleMode: 'FILL' }] }));
    const n = tree.nodes[0]!;
    expect(n.fill.backgroundKind).toBe('image');
    expect(n.fill.imageRef).toBe('abc123');
    expect(n.weakCoverage).toBe(true);
  });

  test('GRADIENT fill is weak coverage', () => {
    const tree = figmaToStyleTree(node({ fills: [{ type: 'GRADIENT_LINEAR', gradientStops: [] }] }));
    expect(tree.nodes[0]!.fill.backgroundKind).toBe('gradient');
    expect(tree.nodes[0]!.weakCoverage).toBe(true);
  });

  test('VECTOR node is kind vector and weak coverage', () => {
    const tree = figmaToStyleTree(node({ type: 'VECTOR' }));
    expect(tree.nodes[0]!.kind).toBe('vector');
    expect(tree.nodes[0]!.weakCoverage).toBe(true);
  });

  test('INSTANCE marks descendants insideComponent; the instance root itself is not', () => {
    const tree = figmaToStyleTree(
      node({
        id: 'inst',
        type: 'INSTANCE',
        children: [
          node({ id: 'dot', type: 'RECTANGLE', children: [node({ id: 'glyph', type: 'VECTOR' })] }),
        ],
      }),
    );
    expect(byId(tree.nodes, 'inst')!.insideComponent).toBe(false); // 实例根位于页面里
    expect(byId(tree.nodes, 'dot')!.insideComponent).toBe(true); // 内部图元
    expect(byId(tree.nodes, 'glyph')!.insideComponent).toBe(true); // 内部图元（深层）
  });
});
