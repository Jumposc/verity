/**
 * Agent 层契约。core 是零 AI / 零 IO 的纯测量内核；本层定义 IO（Figma REST、
 * 浏览器抽取）与 AI（judge）的接缝，编排逻辑（run）面向这些接口编程。
 * 真实驱动（Playwright / Figma REST / Claude Agent SDK）后续实现这些接口插入。
 */
import type { DiffReport, StyleTree, Tolerance } from '@solvir/verity-core';

export interface Viewport {
  width: number;
  height: number;
}

/**
 * 验收输入矩阵（design.md 10.1）。初期单 scenario，schema 预留多 scenario。
 */
export interface Scenario {
  viewport?: Viewport;
  theme?: 'light' | 'dark';
  /** hover / focus / disabled 等交互态。 */
  state?: string;
  /** 路由 / mock 数据 / 滚动位置等后续扩展。 */
  route?: string;
}

export interface FigmaTarget {
  fileKey: string;
  nodeId: string;
}

/** 真值源：拉 Figma 节点并归一化为 StyleTree。later: Figma REST adapter。 */
export interface FigmaSource {
  fetchTree(target: FigmaTarget, scenario?: Scenario): Promise<StyleTree>;
}

/** 实现端：打开 url、注入 capture、归一化为 StyleTree。later: Playwright + capture + dom adapter。 */
export interface DomCapturer {
  capture(url: string, scenario?: Scenario): Promise<StyleTree>;
}

export type Severity = 'critical' | 'major' | 'minor';

/** AI judge 在客观 diff 之上给出的一条语义问题（design.md 5.2 / 决策 B）。 */
export interface Finding {
  /** 关联的配对节点（figma id）。 */
  nodeId: string;
  severity: Severity;
  /** 涉及的属性 / 几何关系名，如 'fontSize' | 'content-top'。 */
  attr: string;
  message: string;
  /** 可选修复建议（沿用 ui-acceptance 修复纪律）。 */
  fixHint?: string;
}

/** judge 产物：语义还原度分 + 问题清单 + 可复现元数据。 */
export interface Judgment {
  /** 0-100 语义还原度分。 */
  fidelityScore: number;
  findings: Finding[];
  /** 记录 model 以支撑可复现性（design 决策 B：纯 AI 分会漂移）。 */
  model: string;
  rationale?: string;
}

/** AI judge：语义严重度判定 + 打分。later: Claude Agent SDK / Claude Code skill。 */
export interface Judge {
  judge(report: DiffReport, scenario?: Scenario): Promise<Judgment>;
}

/** 报告输出（默认实现用 core.renderHtml 落地）。 */
export interface Reporter {
  /** 写出报告，返回路径或标识。 */
  write(report: DiffReport, judgment: Judgment | null): Promise<string>;
}

/** run() 的注入依赖。judge / reporter 缺省则只跑确定性链路（边界契约）。 */
export interface VerityDeps {
  figma: FigmaSource;
  dom: DomCapturer;
  judge?: Judge;
  reporter?: Reporter;
  tolerance?: Tolerance;
}

export interface VerityRunOptions {
  figma: FigmaTarget;
  url: string;
  scenario?: Scenario;
}

export interface VerityResult {
  diff: DiffReport;
  judgment: Judgment | null;
  reportPath: string | null;
  /** 抽取归一化后的两棵树（原始，未折叠）。供快照成 gold 样本做自迭代。 */
  figmaTree: StyleTree;
  domTree: StyleTree;
}
