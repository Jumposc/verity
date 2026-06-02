/**
 * Verity 统一数据契约。
 *
 * 两端 adapter（figma / dom）都归一化输出 StyleTree；
 * match / diff / report 全部基于本文件的类型。
 * 对应 docs/design.md 第 5、10、11 节。
 */

/** 节点来源端 */
export type NodeSource = 'figma' | 'dom';

/** 归一化到 root frame 坐标系的盒子（单位 px）。见 design.md 10.1 坐标系规范。 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 颜色统一存为 sRGB 通道 + alpha，便于算 ΔE（CIEDE2000）。 */
export interface Color {
  r: number; // 0-255
  g: number; // 0-255
  b: number; // 0-255
  a: number; // 0-1
}

/** 布局族（auto-layout / flex）。Figma layoutMode 映射到此。 */
export interface LayoutStyle {
  display: string | null; // flex / block / grid / none ...
  flexDirection: string | null; // row / column
  justifyContent: string | null;
  alignItems: string | null;
  gap: number | null; // px
}

/** 盒模型声明值，仅作参考；间距比对走几何族（见 design.md 11）。 */
export interface BoxStyle {
  padding: [number, number, number, number]; // T R B L
  margin: [number, number, number, number]; // T R B L
}

export interface TypographyStyle {
  fontFamily: string | null;
  fontSize: number | null; // px
  fontWeight: number | null;
  lineHeight: number | null; // px
  letterSpacing: number | null; // px
  textAlign: string | null;
  color: Color | null;
}

export interface FillStyle {
  backgroundColor: Color | null;
  /** 复杂 paint（渐变 / 图片）标记为弱覆盖，见 design.md 10.1。 */
  backgroundKind: 'solid' | 'gradient' | 'image' | 'none';
  imageRef: string | null; // figma IMAGE fill 的 ref / dom 的 url
}

export interface BorderStyle {
  width: number | null; // px
  style: string | null;
  color: Color | null;
  radius: [number, number, number, number]; // TL TR BR BL
}

export interface EffectStyle {
  boxShadow: string | null; // 原始 shadow 描述
  opacity: number; // 0-1
}

/** 节点类型，决定哪些属性有意义。 */
export type NodeKind = 'container' | 'text' | 'image' | 'vector' | 'unknown';

/**
 * 统一节点。全量抽取（design.md 5.1）：能拿的字段都填，拿不到留 null。
 * 几何族比对用 rect，样式族比对用各 *Style。
 */
export interface StyleNode {
  id: string; // figma node id 或 dom path
  source: NodeSource;
  kind: NodeKind;
  name: string; // 图层名 / 标签+class
  text: string | null; // 文本内容，多信号配对用
  role: string | null; // ARIA role，多信号配对用（design.md 10.1）
  componentName: string | null; // figma 组件名 / dom 组件标识
  domPath: string | null; // dom 端路径，配对用
  rect: Rect;

  layout: LayoutStyle;
  box: BoxStyle;
  typography: TypographyStyle;
  fill: FillStyle;
  border: BorderStyle;
  effect: EffectStyle;

  parentId: string | null;
  childIds: string[];

  /** 纯布局 wrapper 标记，配对时可折叠 / 穿透（design.md 11）。 */
  isLayoutWrapper: boolean;
  /** 结构化弱覆盖（图片 / svg / canvas / 渐变），需截图兜底（design.md 10.1）。 */
  weakCoverage: boolean;
}

/** 一端的完整抽取结果。 */
export interface StyleTree {
  source: NodeSource;
  /** root frame 尺寸，用于坐标归一化。 */
  frame: Rect;
  nodes: StyleNode[];
  rootId: string;
}

// ---------- 配对 ----------

/** 配对信号分项得分（0-1），用于多信号加权。design.md 10.1。 */
export interface MatchSignals {
  geometry: number; // bbox IoU
  text: number;
  role: number;
  component: number;
  hierarchy: number;
}

/**
 * 一个配对：figma 侧与 dom 侧。支持一对多 / 多对一（composite），
 * 故两侧都用数组。design.md 10.1 / 11。
 */
export interface NodePair {
  figmaIds: string[];
  domIds: string[];
  confidence: number; // 0-1 综合置信度
  signals: MatchSignals;
  /** 低于阈值，待 AI 消歧。 */
  ambiguous: boolean;
}

export interface MatchResult {
  pairs: NodePair[];
  unmatchedFigma: string[];
  unmatchedDom: string[];
}

// ---------- diff ----------

/** 样式族单属性差（颜色用 deltaE，其余用 delta）。design.md 5.2。 */
export interface AttributeDiff {
  attr: string; // 'fontSize' | 'color' | 'borderRadius.tl' ...
  design: number | string | null;
  actual: number | string | null;
  delta: number | null; // 数值差
  deltaE: number | null; // 颜色差（CIEDE2000）
}

/** 几何族边界距离差。比派生距离而非声明 padding。design.md 11。 */
export interface GeometryDiff {
  /** 语义距离名：'content-top' | 'sibling-gap' | 'icon-text' ... */
  relation: string;
  design: number; // px
  actual: number; // px
  delta: number;
}

export interface NodeDiff {
  pair: NodePair;
  attributes: AttributeDiff[];
  geometry: GeometryDiff[];
}

/** 固定代码产出的纯客观 diff（不含价值判断）。design.md 5.2。 */
export interface DiffReport {
  source: { figma: string; dom: string };
  nodes: NodeDiff[];
  /** 确定性基线分：属性匹配率等纯算术指标（design.md 决策 B）。 */
  baseline: BaselineMetrics;
}

/** 可复现的基线指标，纯算术。design.md 决策 B。 */
export interface BaselineMetrics {
  matchedPairs: number;
  unmatchedCount: number;
  attributeMatchRate: number; // 0-1，容差内属性占比
  geometryMae: number; // 几何距离平均绝对误差 px
}

// ---------- 容差（可被 eval 框架迭代调整，design.md 12） ----------

export interface Tolerance {
  /** 颜色 ΔE 阈值，低于视为等价。 */
  colorDeltaE: number;
  /** 数值（px）默认容差。 */
  pixel: number;
  /** 按属性名覆盖的容差。 */
  perAttribute: Record<string, number>;
}

export const DEFAULT_TOLERANCE: Tolerance = {
  colorDeltaE: 2,
  pixel: 1,
  perAttribute: {},
};
