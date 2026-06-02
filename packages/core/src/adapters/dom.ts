/**
 * DOM 端 adapter（design.md 5 / 10.1 / 11）。
 * 把浏览器原始抽取（capture 包产出的 RawDomCapture）归一化为 StyleTree。
 * 与 figma adapter 对称：typography 仅 text 节点、layout 仅 flex/grid 容器，
 * 避免 figma 容器（无显式 layout）与 dom 容器产生假 diff。纯数据转换，零 IO。
 */
import { parseColor } from '../color';
import type { Color, LayoutStyle, NodeKind, StyleNode, StyleTree, TypographyStyle } from '../schema';

/** getBoundingClientRect 结果（viewport 坐标，px）。 */
export interface RawDomRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 浏览器内单元素的原始抽取（归一化前）。 */
export interface RawDomNode {
  domPath: string;
  parentPath: string | null;
  tag: string;
  /** ARIA role，多信号配对用。 */
  role: string | null;
  ariaLabel: string | null;
  /** 直接文本内容，配对用。 */
  text: string | null;
  /** getBoundingClientRect，viewport 坐标。 */
  rect: RawDomRect;
  /** getComputedStyle 子集（CAPTURE_PROPS），原始字符串值。 */
  computed: Record<string, string>;
  /** 伪元素样式（design.md 10.1）。 */
  pseudo?: { before?: Record<string, string>; after?: Record<string, string> };
}

/** 一次完整 DOM 抽取（单 scenario）。 */
export interface RawDomCapture {
  url?: string;
  viewport: { width: number; height: number; dpr: number };
  scrollX: number;
  scrollY: number;
  /** document.fonts 实际加载字体（design.md 10.1）。 */
  fonts: string[];
  nodes: RawDomNode[];
}

const VECTOR_TAGS = new Set(['svg', 'canvas', 'video', 'path']);

/** "16px" → 16；"normal" / "auto" / undefined → null。 */
function parsePx(v: string | undefined): number | null {
  if (!v) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function firstFontFamily(v: string | undefined): string | null {
  if (!v) return null;
  const first = v.split(',')[0];
  return first ? first.replace(/["']/g, '').trim() : null;
}

function normTextAlign(v: string | undefined): string | null {
  if (!v) return null;
  if (v === 'start') return 'left';
  if (v === 'end') return 'right';
  return v;
}

/** 'normal' / 缺省视为无显式对齐。 */
function normAlign(v: string | undefined): string | null {
  return v && v !== 'normal' ? v : null;
}

function mapKind(tag: string, hasChildren: boolean, text: string | null): NodeKind {
  const t = tag.toLowerCase();
  if (t === 'img') return 'image';
  if (VECTOR_TAGS.has(t)) return 'vector';
  if (!hasChildren && text && text.trim() !== '') return 'text';
  return 'container';
}

function mapLayout(c: Record<string, string>): LayoutStyle {
  const d = c['display'];
  const isFlex = d === 'flex' || d === 'inline-flex';
  const isGrid = d === 'grid' || d === 'inline-grid';
  if (isFlex || isGrid) {
    return {
      display: isFlex ? 'flex' : 'grid',
      flexDirection: c['flex-direction'] ?? null,
      justifyContent: normAlign(c['justify-content']),
      alignItems: normAlign(c['align-items']),
      gap: parsePx(c['gap']),
    };
  }
  return { display: null, flexDirection: null, justifyContent: null, alignItems: null, gap: null };
}

function mapTypography(c: Record<string, string>, isText: boolean): TypographyStyle {
  if (!isText) {
    return {
      fontFamily: null,
      fontSize: null,
      fontWeight: null,
      lineHeight: null,
      letterSpacing: null,
      textAlign: null,
      color: null,
    };
  }
  return {
    fontFamily: firstFontFamily(c['font-family']),
    fontSize: parsePx(c['font-size']),
    fontWeight: parsePx(c['font-weight']),
    lineHeight: parsePx(c['line-height']), // 'normal' → null
    letterSpacing: c['letter-spacing'] === 'normal' ? 0 : parsePx(c['letter-spacing']),
    textAlign: normTextAlign(c['text-align']),
    color: c['color'] ? parseColor(c['color']) : null,
  };
}

function extractUrl(v: string): string | null {
  const m = /url\((["']?)([^"')]+)\1\)/.exec(v);
  return m ? (m[2] ?? null) : null;
}

interface FillResult {
  backgroundColor: Color | null;
  backgroundKind: StyleNode['fill']['backgroundKind'];
  imageRef: string | null;
}

function mapFill(c: Record<string, string>): FillResult {
  const bgImage = c['background-image'];
  if (bgImage && bgImage !== 'none') {
    if (bgImage.includes('gradient')) {
      return { backgroundColor: null, backgroundKind: 'gradient', imageRef: null };
    }
    const url = extractUrl(bgImage);
    if (url) return { backgroundColor: null, backgroundKind: 'image', imageRef: url };
  }
  const color = c['background-color'] ? parseColor(c['background-color']) : null;
  if (color && color.a > 0) return { backgroundColor: color, backgroundKind: 'solid', imageRef: null };
  return { backgroundColor: null, backgroundKind: 'none', imageRef: null };
}

export function domToStyleTree(raw: RawDomCapture): StyleTree {
  const root = raw.nodes[0];
  if (!root) {
    return { source: 'dom', frame: { x: 0, y: 0, w: 0, h: 0 }, nodes: [], rootId: '' };
  }
  const origin = root.rect;
  const pathSet = new Set(raw.nodes.map((n) => n.domPath));

  const childrenOf = new Map<string, string[]>();
  for (const n of raw.nodes) {
    if (n.parentPath && pathSet.has(n.parentPath)) {
      const arr = childrenOf.get(n.parentPath);
      if (arr) arr.push(n.domPath);
      else childrenOf.set(n.parentPath, [n.domPath]);
    }
  }

  const nodes: StyleNode[] = raw.nodes.map((n) => {
    const c = n.computed;
    const childIds = childrenOf.get(n.domPath) ?? [];
    const kind = mapKind(n.tag, childIds.length > 0, n.text);
    const isText = kind === 'text';
    const fill = mapFill(c);

    const borderWidth = parsePx(c['border-top-width']);
    const borderStyle = c['border-style'];
    const hasBorder = borderWidth != null && borderWidth > 0 && !!borderStyle && borderStyle !== 'none';
    const shadow = c['box-shadow'];

    return {
      id: n.domPath,
      source: 'dom',
      kind,
      name: n.tag + (n.role ? `[role=${n.role}]` : ''),
      text: n.text,
      role: n.role,
      componentName: null,
      domPath: n.domPath,
      rect: { x: n.rect.x - origin.x, y: n.rect.y - origin.y, w: n.rect.width, h: n.rect.height },
      layout: mapLayout(c),
      box: { padding: [0, 0, 0, 0], margin: [0, 0, 0, 0] },
      typography: mapTypography(c, isText),
      fill,
      border: {
        width: hasBorder ? borderWidth : null,
        style: hasBorder ? 'solid' : null,
        color: hasBorder && c['border-color'] ? parseColor(c['border-color']) : null,
        radius: [
          parsePx(c['border-top-left-radius']) ?? 0,
          parsePx(c['border-top-right-radius']) ?? 0,
          parsePx(c['border-bottom-right-radius']) ?? 0,
          parsePx(c['border-bottom-left-radius']) ?? 0,
        ],
      },
      effect: {
        boxShadow: shadow && shadow !== 'none' ? shadow : null,
        opacity: parsePx(c['opacity']) ?? 1,
      },
      parentId: n.parentPath && pathSet.has(n.parentPath) ? n.parentPath : null,
      childIds,
      isLayoutWrapper:
        kind === 'container' && fill.backgroundKind === 'none' && !hasBorder && !n.text && childIds.length > 0,
      weakCoverage:
        kind === 'vector' ||
        kind === 'image' ||
        fill.backgroundKind === 'image' ||
        fill.backgroundKind === 'gradient',
    };
  });

  return {
    source: 'dom',
    frame: { x: 0, y: 0, w: origin.width, h: origin.height },
    nodes,
    rootId: root.domPath,
  };
}
