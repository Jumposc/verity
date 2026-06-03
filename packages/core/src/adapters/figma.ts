/**
 * Figma 端 adapter（design.md 10.1：主真值用 REST /v1/files/:key/nodes）。
 * 把 Figma 节点树归一化为 StyleTree：坐标换算到 root frame、字段映射到统一 schema。
 * 纯数据转换，零 IO。映射规则是 v1 基线，后续可由 eval 框架迭代。
 */
import { figmaColor } from '../color';
import type {
  Color,
  LayoutStyle,
  NodeKind,
  StyleNode,
  StyleTree,
  TypographyStyle,
} from '../schema';

interface FigmaColorRaw {
  r: number;
  g: number;
  b: number;
  a?: number;
}

interface FigmaPaint {
  type: string; // SOLID / GRADIENT_LINEAR / IMAGE ...
  visible?: boolean;
  opacity?: number;
  color?: FigmaColorRaw;
  imageRef?: string;
  scaleMode?: string;
  gradientStops?: unknown[];
}

interface FigmaEffect {
  type: string; // DROP_SHADOW / INNER_SHADOW / LAYER_BLUR ...
  visible?: boolean;
  radius?: number;
  offset?: { x: number; y: number };
  color?: FigmaColorRaw;
}

interface FigmaTextStyle {
  fontFamily?: string;
  fontWeight?: number;
  fontSize?: number;
  letterSpacing?: number;
  lineHeightPx?: number;
  textAlignHorizontal?: string;
}

/** Figma REST 节点子集。`[k]` 收口未映射字段。 */
export interface FigmaApiNode {
  id: string;
  name: string;
  type: string;
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number } | null;
  fills?: FigmaPaint[];
  strokes?: FigmaPaint[];
  strokeWeight?: number;
  cornerRadius?: number;
  rectangleCornerRadii?: number[];
  opacity?: number;
  effects?: FigmaEffect[];
  characters?: string;
  style?: FigmaTextStyle;
  layoutMode?: 'NONE' | 'HORIZONTAL' | 'VERTICAL';
  itemSpacing?: number;
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  children?: FigmaApiNode[];
  [k: string]: unknown;
}

export interface FigmaToTreeOptions {
  /** 作为 root frame 的节点 id（坐标归一化原点）。缺省取传入根。 */
  rootId?: string;
}

const VECTOR_TYPES = new Set(['VECTOR', 'LINE', 'STAR', 'REGULAR_POLYGON', 'BOOLEAN_OPERATION']);
const CONTAINER_TYPES = new Set([
  'FRAME',
  'COMPONENT',
  'INSTANCE',
  'COMPONENT_SET',
  'GROUP',
  'SECTION',
  'RECTANGLE',
  'ELLIPSE',
]);
const COMPONENT_TYPES = new Set(['COMPONENT', 'INSTANCE', 'COMPONENT_SET']);

const JUSTIFY: Record<string, string> = {
  MIN: 'flex-start',
  CENTER: 'center',
  MAX: 'flex-end',
  SPACE_BETWEEN: 'space-between',
};
const ALIGN: Record<string, string> = {
  MIN: 'flex-start',
  CENTER: 'center',
  MAX: 'flex-end',
  BASELINE: 'baseline',
};
const TEXT_ALIGN: Record<string, string> = {
  LEFT: 'left',
  CENTER: 'center',
  RIGHT: 'right',
  JUSTIFIED: 'justify',
};

function visiblePaint(paints: FigmaPaint[] | undefined): FigmaPaint | undefined {
  return paints?.find((p) => p.visible !== false);
}

function paintColor(p: FigmaPaint): Color | null {
  if (p.type !== 'SOLID' || !p.color) return null;
  const a = (p.color.a ?? 1) * (p.opacity ?? 1);
  return figmaColor({ r: p.color.r, g: p.color.g, b: p.color.b, a });
}

function mapKind(type: string, primaryFill: FigmaPaint | undefined): NodeKind {
  if (type === 'TEXT') return 'text';
  if (VECTOR_TYPES.has(type)) return 'vector';
  if (primaryFill?.type === 'IMAGE') return 'image';
  if (CONTAINER_TYPES.has(type)) return 'container';
  return 'unknown';
}

function mapLayout(n: FigmaApiNode): LayoutStyle {
  if (n.layoutMode === 'HORIZONTAL' || n.layoutMode === 'VERTICAL') {
    return {
      display: 'flex',
      flexDirection: n.layoutMode === 'HORIZONTAL' ? 'row' : 'column',
      justifyContent: n.primaryAxisAlignItems ? (JUSTIFY[n.primaryAxisAlignItems] ?? null) : null,
      alignItems: n.counterAxisAlignItems ? (ALIGN[n.counterAxisAlignItems] ?? null) : null,
      gap: n.itemSpacing ?? null,
    };
  }
  return { display: null, flexDirection: null, justifyContent: null, alignItems: null, gap: null };
}

function mapTypography(n: FigmaApiNode, primaryFill: FigmaPaint | undefined): TypographyStyle {
  if (n.type !== 'TEXT') {
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
  const s = n.style ?? {};
  return {
    fontFamily: s.fontFamily ?? null,
    fontSize: s.fontSize ?? null,
    fontWeight: s.fontWeight ?? null,
    lineHeight: s.lineHeightPx ?? null,
    letterSpacing: s.letterSpacing ?? null,
    textAlign: s.textAlignHorizontal ? (TEXT_ALIGN[s.textAlignHorizontal] ?? null) : null,
    color: primaryFill ? paintColor(primaryFill) : null,
  };
}

function mapRadius(n: FigmaApiNode): [number, number, number, number] {
  const r = n.rectangleCornerRadii;
  if (r && r.length === 4) return [r[0]!, r[1]!, r[2]!, r[3]!];
  const c = n.cornerRadius ?? 0;
  return [c, c, c, c];
}

function mapShadow(effects: FigmaEffect[] | undefined): string | null {
  const s = effects?.find((e) => e.type === 'DROP_SHADOW' && e.visible !== false);
  if (!s) return null;
  const o = s.offset ?? { x: 0, y: 0 };
  const c = s.color ? figmaColor({ r: s.color.r, g: s.color.g, b: s.color.b, a: s.color.a ?? 1 }) : null;
  const rgba = c ? `rgba(${c.r},${c.g},${c.b},${c.a})` : 'rgba(0,0,0,0.25)';
  return `${o.x}px ${o.y}px ${s.radius ?? 0}px ${rgba}`;
}

export function figmaToStyleTree(root: FigmaApiNode, opts: FigmaToTreeOptions = {}): StyleTree {
  const origin = root.absoluteBoundingBox ?? { x: 0, y: 0, width: 0, height: 0 };
  const nodes: StyleNode[] = [];

  function walk(n: FigmaApiNode, parentId: string | null, insideComponent: boolean): void {
    const bb = n.absoluteBoundingBox ?? { x: origin.x, y: origin.y, width: 0, height: 0 };
    const primaryFill = visiblePaint(n.fills);
    const kind = mapKind(n.type, primaryFill);
    const isText = n.type === 'TEXT';

    // fill：text 的 fill 是字色（进 typography），不当背景
    let backgroundColor: Color | null = null;
    let backgroundKind: StyleNode['fill']['backgroundKind'] = 'none';
    let imageRef: string | null = null;
    if (!isText && primaryFill) {
      if (primaryFill.type === 'SOLID') {
        backgroundColor = paintColor(primaryFill);
        backgroundKind = 'solid';
      } else if (primaryFill.type === 'IMAGE') {
        backgroundKind = 'image';
        imageRef = primaryFill.imageRef ?? null;
      } else if (primaryFill.type.startsWith('GRADIENT')) {
        backgroundKind = 'gradient';
      }
    }

    const stroke = visiblePaint(n.strokes);
    const hasBorder = !!stroke && (n.strokeWeight ?? 0) > 0;

    const childIds = (n.children ?? []).map((c) => c.id);

    nodes.push({
      id: n.id,
      source: 'figma',
      kind,
      name: n.name,
      text: n.characters ?? null,
      role: null,
      componentName: COMPONENT_TYPES.has(n.type) ? n.name : null,
      domPath: null,
      rect: { x: bb.x - origin.x, y: bb.y - origin.y, w: bb.width, h: bb.height },
      layout: mapLayout(n),
      box: {
        padding: [n.paddingTop ?? 0, n.paddingRight ?? 0, n.paddingBottom ?? 0, n.paddingLeft ?? 0],
        margin: [0, 0, 0, 0],
      },
      typography: mapTypography(n, primaryFill),
      fill: { backgroundColor, backgroundKind, imageRef },
      border: {
        width: hasBorder ? (n.strokeWeight ?? null) : null,
        style: hasBorder ? 'solid' : null,
        color: hasBorder && stroke ? paintColor(stroke) : null,
        radius: mapRadius(n),
      },
      effect: { boxShadow: mapShadow(n.effects), opacity: n.opacity ?? 1 },
      parentId,
      childIds,
      isLayoutWrapper: false,
      weakCoverage:
        kind === 'vector' || backgroundKind === 'image' || backgroundKind === 'gradient',
      insideComponent,
    });

    // INSTANCE 根本身位于页面里（insideComponent 用传入值）；其后代结构由组件定义，标记 inside。
    const childInside = insideComponent || n.type === 'INSTANCE';
    for (const c of n.children ?? []) walk(c, n.id, childInside);
  }

  walk(root, null, false);

  return {
    source: 'figma',
    frame: { x: 0, y: 0, w: origin.width, h: origin.height },
    nodes,
    rootId: opts.rootId ?? root.id,
  };
}
