/**
 * 仅供单测使用的 StyleNode / StyleTree 构造器。
 * 文件名不含 `.test.`/`.spec.`，不会被 vitest 当作测试套件，也不进 tsup 产物。
 */
import type { StyleNode, StyleTree } from './schema';

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends ReadonlyArray<unknown>
    ? T[K]
    : T[K] extends object
      ? Partial<T[K]>
      : T[K];
};

/** 构造一个全字段已填的 StyleNode，按需覆盖。 */
export function makeNode(o: DeepPartial<StyleNode> = {}): StyleNode {
  return {
    id: o.id ?? 'n',
    source: o.source ?? 'figma',
    kind: o.kind ?? 'container',
    name: o.name ?? '',
    text: o.text ?? null,
    role: o.role ?? null,
    componentName: o.componentName ?? null,
    domPath: o.domPath ?? null,
    rect: { x: 0, y: 0, w: 0, h: 0, ...o.rect },
    layout: {
      display: null,
      flexDirection: null,
      justifyContent: null,
      alignItems: null,
      gap: null,
      ...o.layout,
    },
    box: { padding: [0, 0, 0, 0], margin: [0, 0, 0, 0], ...o.box },
    typography: {
      fontFamily: null,
      fontSize: null,
      fontWeight: null,
      lineHeight: null,
      letterSpacing: null,
      textAlign: null,
      color: null,
      ...o.typography,
    },
    fill: { backgroundColor: null, backgroundKind: 'none', imageRef: null, ...o.fill },
    border: { width: null, style: null, color: null, radius: [0, 0, 0, 0], ...o.border },
    effect: { boxShadow: null, opacity: 1, ...o.effect },
    parentId: o.parentId ?? null,
    childIds: o.childIds ?? [],
    isLayoutWrapper: o.isLayoutWrapper ?? false,
    weakCoverage: o.weakCoverage ?? false,
  };
}

/** 构造一棵 StyleTree。frame 缺省 1440×900，root 取首个节点。 */
export function makeTree(source: StyleNode['source'], nodes: StyleNode[], frame?: Partial<StyleTree['frame']>): StyleTree {
  return {
    source,
    frame: { x: 0, y: 0, w: 1440, h: 900, ...frame },
    nodes,
    rootId: nodes[0]?.id ?? 'root',
  };
}
