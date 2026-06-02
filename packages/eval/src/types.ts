/**
 * 自迭代评测框架契约（design.md 12）。评测器与比对指标是确定性逻辑；
 * 产出工具结论的 runner、调参的 tuner 走注入，真实实现（包 agent.run / AI 调参）后补。
 */

/** 一条 gold 样本：输入 + 人工标注的期望结论。 */
export interface GoldSample {
  id: string;
  figmaFileKey: string;
  figmaNodeId: string;
  url: string;
  expected: {
    /** 人工还原度分 0-100。 */
    fidelityScore: number;
    /** 人工认定的严重问题（自由文本，按子串吻合比对）。 */
    criticalFindings: string[];
  };
}

/** 工具对单样本的产出（later: 由 agent.run + judge 提供）。 */
export interface ToolOutput {
  fidelityScore: number;
  findings: string[];
}

/** 注入：跑工具产出结论。 */
export interface SampleRunner {
  run(sample: GoldSample): Promise<ToolOutput>;
}

/** 单样本评测：工具结论与 gold 的吻合度。 */
export interface EvalResult {
  sampleId: string;
  toolScore: number;
  expectedScore: number;
  /** toolScore − expectedScore。 */
  scoreDelta: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  /** findings 的 F1，0-1。 */
  findingF1: number;
}
