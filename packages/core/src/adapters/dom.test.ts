import { describe, expect, test } from 'vitest';
import { domToStyleTree, type RawDomCapture, type RawDomNode } from './dom';
import type { StyleNode } from '../schema';

const byId = (nodes: StyleNode[], id: string): StyleNode | undefined => nodes.find((n) => n.id === id);

const rawNode = (over: Partial<RawDomNode> & Pick<RawDomNode, 'domPath'>): RawDomNode => ({
  parentPath: null,
  tag: 'div',
  role: null,
  ariaLabel: null,
  text: null,
  rect: { x: 0, y: 0, width: 10, height: 10 },
  computed: {},
  ...over,
});

const capture = (nodes: RawDomNode[]): RawDomCapture => ({
  viewport: { width: 1440, height: 900, dpr: 2 },
  scrollX: 0,
  scrollY: 0,
  fonts: [],
  nodes,
});

// DOM 版 Switch：button(track) > span(knob)，对应 figma Switch Off 的几何
function switchCapture() {
  return capture([
    rawNode({
      domPath: 'button',
      tag: 'button',
      role: 'switch',
      rect: { x: 192, y: 592, width: 32, height: 16 },
      computed: {
        'background-color': 'rgb(212, 212, 212)',
        'border-top-left-radius': '9999px',
        'border-top-right-radius': '9999px',
        'border-bottom-right-radius': '9999px',
        'border-bottom-left-radius': '9999px',
        'border-top-width': '0px',
        'border-style': 'none',
        opacity: '1',
        display: 'flex',
      },
    }),
    rawNode({
      domPath: 'button>span',
      parentPath: 'button',
      tag: 'span',
      rect: { x: 193, y: 593, width: 14, height: 14 },
      computed: { 'background-color': 'rgb(255, 255, 255)', 'border-top-left-radius': '9999px' },
    }),
  ]);
}

describe('domToStyleTree — switch-like capture', () => {
  const tree = domToStyleTree(switchCapture());

  test('translates rects to root-frame coordinates', () => {
    expect(tree.rootId).toBe('button');
    expect(tree.frame).toEqual({ x: 0, y: 0, w: 32, h: 16 });
    expect(byId(tree.nodes, 'button')!.rect).toEqual({ x: 0, y: 0, w: 32, h: 16 });
    expect(byId(tree.nodes, 'button>span')!.rect).toEqual({ x: 1, y: 1, w: 14, h: 14 });
  });

  test('parses rgb background to 0-255 solid', () => {
    expect(byId(tree.nodes, 'button')!.fill).toMatchObject({
      backgroundColor: { r: 212, g: 212, b: 212, a: 1 },
      backgroundKind: 'solid',
    });
  });

  test('parses border radius px to four corners', () => {
    expect(byId(tree.nodes, 'button')!.border.radius).toEqual([9999, 9999, 9999, 9999]);
  });

  test('zero border width maps to null', () => {
    expect(byId(tree.nodes, 'button')!.border.width).toBeNull();
  });

  test('maps ARIA role and wires tree links', () => {
    expect(byId(tree.nodes, 'button')!.role).toBe('switch');
    expect(byId(tree.nodes, 'button')!.childIds).toEqual(['button>span']);
    expect(byId(tree.nodes, 'button>span')!.parentId).toBe('button');
  });
});

describe('domToStyleTree — field parsing', () => {
  test('transparent background is backgroundKind none', () => {
    const tree = domToStyleTree(capture([rawNode({ domPath: 'd', computed: { 'background-color': 'rgba(0, 0, 0, 0)' } })]));
    expect(tree.nodes[0]!.fill.backgroundKind).toBe('none');
    expect(tree.nodes[0]!.fill.backgroundColor).toBeNull();
  });

  test('text leaf populates typography', () => {
    const tree = domToStyleTree(
      capture([
        rawNode({
          domPath: 'p',
          tag: 'span',
          text: 'Buy now',
          computed: {
            'font-family': '"Inter", sans-serif',
            'font-size': '16px',
            'font-weight': '600',
            'line-height': '24px',
            'letter-spacing': 'normal',
            'text-align': 'center',
            color: 'rgb(255, 255, 255)',
          },
        }),
      ]),
    );
    const n = tree.nodes[0]!;
    expect(n.kind).toBe('text');
    expect(n.text).toBe('Buy now');
    expect(n.typography).toEqual({
      fontFamily: 'Inter',
      fontSize: 16,
      fontWeight: 600,
      lineHeight: 24,
      letterSpacing: 0,
      textAlign: 'center',
      color: { r: 255, g: 255, b: 255, a: 1 },
    });
  });

  test('flex container populates layout; block container does not', () => {
    const flex = domToStyleTree(
      capture([rawNode({ domPath: 'f', computed: { display: 'flex', 'flex-direction': 'row', 'justify-content': 'center', 'align-items': 'center', gap: '8px' } })]),
    );
    expect(flex.nodes[0]!.layout).toEqual({
      display: 'flex',
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      gap: 8,
    });
    const block = domToStyleTree(capture([rawNode({ domPath: 'b', computed: { display: 'block' } })]));
    expect(block.nodes[0]!.layout.display).toBeNull();
  });

  test('img is image + weak coverage; svg is vector + weak coverage', () => {
    const img = domToStyleTree(capture([rawNode({ domPath: 'i', tag: 'img' })]));
    expect(img.nodes[0]!.kind).toBe('image');
    expect(img.nodes[0]!.weakCoverage).toBe(true);
    const svg = domToStyleTree(capture([rawNode({ domPath: 's', tag: 'svg' })]));
    expect(svg.nodes[0]!.kind).toBe('vector');
    expect(svg.nodes[0]!.weakCoverage).toBe(true);
  });

  test('gradient and url backgrounds are weak coverage', () => {
    const grad = domToStyleTree(capture([rawNode({ domPath: 'g', computed: { 'background-image': 'linear-gradient(90deg, #fff, #000)' } })]));
    expect(grad.nodes[0]!.fill.backgroundKind).toBe('gradient');
    expect(grad.nodes[0]!.weakCoverage).toBe(true);
    const url = domToStyleTree(capture([rawNode({ domPath: 'u', computed: { 'background-image': 'url("https://x/y.png")' } })]));
    expect(url.nodes[0]!.fill.backgroundKind).toBe('image');
    expect(url.nodes[0]!.fill.imageRef).toBe('https://x/y.png');
  });
});
