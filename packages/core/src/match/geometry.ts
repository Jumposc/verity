/**
 * 多信号几何配对（design.md 4 决策 3 / 10.1）。
 * 信号：几何 IoU + 文本 + ARIA role + 组件名 + 层级深度，加权求综合置信度。
 * 贪心 1-1 指派；低置信度或与次优难分者标 ambiguous，留给 AI 消歧。
 *
 * 坐标：两端各按自身 frame 归一到 [0,1]，IoU 与绝对尺寸无关。
 * v1 只产单 id 配对；composite（一对多）由后续迭代或 AI 消歧补。
 */
import { iou } from '../geom';
import type { MatchResult, MatchSignals, NodePair, Rect, StyleNode, StyleTree } from '../schema';

export interface MatchOptions {
  weights?: Partial<MatchSignals>;
  /** 低于此置信度不配对。缺省 0.2。 */
  minConfidence?: number;
  /** 低于此置信度即便配上也标 ambiguous。缺省 0.6。 */
  ambiguousThreshold?: number;
  /** 与次优候选差距小于此也标 ambiguous。缺省 0.1。 */
  ambiguousMargin?: number;
}

const DEFAULT_WEIGHTS: MatchSignals = {
  geometry: 0.5,
  text: 0.25,
  role: 0.1,
  component: 0.1,
  hierarchy: 0.05,
};

function normRect(rect: Rect, frame: Rect): Rect {
  const w = frame.w || 1;
  const h = frame.h || 1;
  return { x: rect.x / w, y: rect.y / h, w: rect.w / w, h: rect.h / h };
}

function normText(t: string | null): string {
  return (t ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** 文本相似：相等 1，互为子串 0.6，否则 0。 */
function textSim(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.6;
  return 0;
}

function depth(node: StyleNode, byId: Map<string, StyleNode>): number {
  let d = 0;
  let cur: StyleNode | undefined = node;
  while (cur?.parentId) {
    cur = byId.get(cur.parentId);
    if (!cur) break;
    d += 1;
  }
  return d;
}

export function matchTrees(figma: StyleTree, dom: StyleTree, opts: MatchOptions = {}): MatchResult {
  const W = { ...DEFAULT_WEIGHTS, ...opts.weights };
  const minConfidence = opts.minConfidence ?? 0.2;
  const ambiguousThreshold = opts.ambiguousThreshold ?? 0.6;
  const ambiguousMargin = opts.ambiguousMargin ?? 0.1;

  const figmaById = new Map(figma.nodes.map((n) => [n.id, n]));
  const domById = new Map(dom.nodes.map((n) => [n.id, n]));

  function score(f: StyleNode, d: StyleNode): { confidence: number; signals: MatchSignals } {
    const geometry = iou(normRect(f.rect, figma.frame), normRect(d.rect, dom.frame));

    const ft = normText(f.text);
    const dt = normText(d.text);
    const textApplicable = ft !== '' && dt !== '';
    const text = textApplicable ? textSim(ft, dt) : 0;

    const roleApplicable = f.role != null && d.role != null;
    const role = roleApplicable ? (f.role === d.role ? 1 : 0) : 0;

    const compApplicable = f.componentName != null && d.componentName != null;
    const component = compApplicable
      ? f.componentName!.toLowerCase() === d.componentName!.toLowerCase()
        ? 1
        : 0
      : 0;

    const hierarchy = 1 - Math.min(1, Math.abs(depth(f, figmaById) - depth(d, domById)) / 4);

    let num = 0;
    let den = 0;
    const add = (w: number, v: number, applicable: boolean) => {
      if (applicable) {
        num += w * v;
        den += w;
      }
    };
    add(W.geometry, geometry, true);
    add(W.text, text, textApplicable);
    add(W.role, role, roleApplicable);
    add(W.component, component, compApplicable);
    add(W.hierarchy, hierarchy, true);

    return {
      confidence: den > 0 ? num / den : 0,
      signals: { geometry, text, role, component, hierarchy },
    };
  }

  // dom 后代集合（缓存）：把子节点候选限制在已配对父的子树内
  const domDescCache = new Map<string, string[]>();
  function domDescendants(domId: string): string[] {
    const cached = domDescCache.get(domId);
    if (cached) return cached;
    const out: string[] = [];
    const stack = [...(domById.get(domId)?.childIds ?? [])];
    while (stack.length) {
      const id = stack.pop()!;
      const n = domById.get(id);
      if (!n) continue;
      out.push(id);
      for (const c of n.childIds) stack.push(c);
    }
    domDescCache.set(domId, out);
    return out;
  }

  // figma 自顶向下层级序（root 先）：配父时父已定，可据父约束子的候选域
  function figmaTopDownOrder(): string[] {
    const order: string[] = [];
    const seen = new Set<string>();
    const q: string[] = [figma.rootId];
    while (q.length) {
      const id = q.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const n = figmaById.get(id);
      if (!n) continue;
      order.push(id);
      for (const c of n.childIds) q.push(c);
    }
    for (const n of figma.nodes) if (!seen.has(n.id)) order.push(n.id);
    return order;
  }

  const allDomIds = dom.nodes.map((n) => n.id);
  const usedDom = new Set<string>();
  const figmaToDom = new Map<string, string>();
  const matchedFigma = new Set<string>();
  const pairs: NodePair[] = [];

  // 层级感知贪心：每个 figma 节点优先在「已配对父对应的 DOM 子树」内找配对，
  // 杜绝跨子树错配（无文本容器节点在粒度差下几何信号弱、易被全局贪心配到相距千 px 的节点）。
  // 父未配 / 子树内无可用候选时回退全局，再以 minConfidence 兜底过滤弱配。
  for (const fId of figmaTopDownOrder()) {
    const fNode = figmaById.get(fId);
    if (!fNode) continue;

    const domParentId = fNode.parentId ? figmaToDom.get(fNode.parentId) : undefined;
    let candIds = domParentId
      ? domDescendants(domParentId).filter((id) => !usedDom.has(id))
      : allDomIds.filter((id) => !usedDom.has(id));
    if (candIds.length === 0) candIds = allDomIds.filter((id) => !usedDom.has(id));

    let bestId: string | null = null;
    let bestConf = 0;
    let bestSignals: MatchSignals | null = null;
    let secondConf = 0;
    for (const id of candIds) {
      const d = domById.get(id);
      if (!d) continue;
      const s = score(fNode, d);
      if (s.confidence > bestConf) {
        secondConf = bestConf;
        bestConf = s.confidence;
        bestId = id;
        bestSignals = s.signals;
      } else if (s.confidence > secondConf) {
        secondConf = s.confidence;
      }
    }
    if (bestId == null || bestConf < minConfidence) continue;

    usedDom.add(bestId);
    matchedFigma.add(fId);
    figmaToDom.set(fId, bestId);

    const margin = bestConf - secondConf;
    const ambiguous = bestConf < ambiguousThreshold || margin < ambiguousMargin;
    pairs.push({
      figmaIds: [fId],
      domIds: [bestId],
      confidence: bestConf,
      signals: bestSignals!,
      ambiguous,
    });
  }

  const unmatchedFigma = figma.nodes.filter((n) => !matchedFigma.has(n.id)).map((n) => n.id);
  const unmatchedDom = dom.nodes.filter((n) => !usedDom.has(n.id)).map((n) => n.id);

  return { pairs, unmatchedFigma, unmatchedDom };
}
