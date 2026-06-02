/**
 * 几何边界距离 diff（design.md 11）。比配对节点对之间的派生距离，不读声明 padding/margin，
 * 故多层嵌套 wrapper 累加的间距会被实际渲染几何自然消化。
 *
 * 两类关系：
 * - content-top / content-left：节点相对"最近已配对祖先"的 inset（穿透未配对 wrapper）。
 * - sibling-gap：同一祖先下相邻兄弟沿主轴的边界间隙，归属后一个兄弟。
 *
 * dom 距离按 frame 宽度比缩放到 design px 空间再比较。
 * 返回与 pairs 对齐的二维数组：out[i] 是 pairs[i] 拥有的关系。
 */
import { gapX, gapY } from '../geom';
import type { GeometryDiff, NodePair, Rect, StyleNode, StyleTree } from '../schema';

export interface GeometryOptions {
  /** dom 距离换算到 design px 的缩放因子；缺省按 frame 宽度比 figma.w / dom.w。 */
  scale?: number;
}

/** 去除浮点噪声并消解 -0。 */
function round(v: number): number {
  const r = Math.round(v * 100) / 100;
  return r === 0 ? 0 : r;
}

/** 一组 id 的并集包围盒；空集返回 null。 */
function unionRect(ids: string[], byId: Map<string, StyleNode>): Rect | null {
  let r: Rect | null = null;
  for (const id of ids) {
    const n = byId.get(id);
    if (!n) continue;
    if (!r) {
      r = { ...n.rect };
    } else {
      const x = Math.min(r.x, n.rect.x);
      const y = Math.min(r.y, n.rect.y);
      const right = Math.max(r.x + r.w, n.rect.x + n.rect.w);
      const bottom = Math.max(r.y + r.h, n.rect.y + n.rect.h);
      r = { x, y, w: right - x, h: bottom - y };
    }
  }
  return r;
}

/** 主轴方向：优先看父节点 flexDirection，否则按子中心点散布大的轴。 */
function mainAxis(parent: StyleNode | undefined, rects: Rect[]): 'x' | 'y' {
  const dir = parent?.layout.flexDirection;
  if (dir === 'row') return 'x';
  if (dir === 'column') return 'y';
  const spread = (vals: number[]) => Math.max(...vals) - Math.min(...vals);
  const cx = rects.map((r) => r.x + r.w / 2);
  const cy = rects.map((r) => r.y + r.h / 2);
  return spread(cx) >= spread(cy) ? 'x' : 'y';
}

export function diffGeometry(
  figma: StyleTree,
  dom: StyleTree,
  pairs: NodePair[],
  opts?: GeometryOptions,
): GeometryDiff[][] {
  const scale = opts?.scale ?? (dom.frame.w > 0 ? figma.frame.w / dom.frame.w : 1);
  const figmaById = new Map(figma.nodes.map((n) => [n.id, n]));
  const domById = new Map(dom.nodes.map((n) => [n.id, n]));

  const figmaIdToPair = new Map<string, number>();
  pairs.forEach((p, i) => p.figmaIds.forEach((id) => figmaIdToPair.set(id, i)));

  const repFigma = pairs.map((p) => unionRect(p.figmaIds, figmaById));
  const repDom = pairs.map((p) => unionRect(p.domIds, domById));

  // 沿 figma parentId 链找最近的、属于其他 pair 的祖先（穿透未配对 wrapper）。
  const ancestorPair: (number | null)[] = pairs.map((p, i) => {
    const start = p.figmaIds[0] ? figmaById.get(p.figmaIds[0]) : undefined;
    let cur = start?.parentId ? figmaById.get(start.parentId) : undefined;
    while (cur) {
      const pi = figmaIdToPair.get(cur.id);
      if (pi != null && pi !== i) return pi;
      cur = cur.parentId ? figmaById.get(cur.parentId) : undefined;
    }
    return null;
  });

  const out: GeometryDiff[][] = pairs.map(() => []);

  // content inset 相对最近已配对祖先
  pairs.forEach((_p, i) => {
    const ai = ancestorPair[i];
    if (ai == null) return;
    const cf = repFigma[i];
    const cd = repDom[i];
    const af = repFigma[ai];
    const ad = repDom[ai];
    if (!cf || !cd || !af || !ad) return;
    const dTop = cf.y - af.y;
    const aTop = (cd.y - ad.y) * scale;
    out[i]!.push({ relation: 'content-top', design: round(dTop), actual: round(aTop), delta: round(aTop - dTop) });
    const dLeft = cf.x - af.x;
    const aLeft = (cd.x - ad.x) * scale;
    out[i]!.push({ relation: 'content-left', design: round(dLeft), actual: round(aLeft), delta: round(aLeft - dLeft) });
  });

  // sibling gap：按祖先 pair 分组，相邻兄弟沿主轴
  const groups = new Map<number, number[]>();
  ancestorPair.forEach((ai, i) => {
    if (ai == null) return;
    const arr = groups.get(ai);
    if (arr) arr.push(i);
    else groups.set(ai, [i]);
  });

  for (const [ai, members] of groups) {
    if (members.length < 2) continue;
    const parent = pairs[ai]!.figmaIds[0] ? figmaById.get(pairs[ai]!.figmaIds[0]!) : undefined;
    const axis = mainAxis(parent, members.map((i) => repFigma[i]!));
    const sorted = members
      .slice()
      .sort((a, b) => (axis === 'x' ? repFigma[a]!.x - repFigma[b]!.x : repFigma[a]!.y - repFigma[b]!.y));
    for (let k = 1; k < sorted.length; k++) {
      const prev = sorted[k - 1]!;
      const cur = sorted[k]!;
      const gf = axis === 'x' ? gapX(repFigma[prev]!, repFigma[cur]!) : gapY(repFigma[prev]!, repFigma[cur]!);
      const gd =
        (axis === 'x' ? gapX(repDom[prev]!, repDom[cur]!) : gapY(repDom[prev]!, repDom[cur]!)) * scale;
      out[cur]!.push({ relation: 'sibling-gap', design: round(gf), actual: round(gd), delta: round(gd - gf) });
    }
  }

  return out;
}
