/**
 * 自迭代闭环（design.md 12）：评测 → 注入的 tune 调字段/权重/容差/judge prompt
 * → 重跑 → 收敛。循环控制是确定性的；tune（AI 调参）与 makeRunner（跑工具）走注入。
 * 产物：收敛后的最佳配置，沉淀为 skill 的 prompt 与 config。
 */
import { evaluate, meanF1, scoreMae } from './evaluate';
import type { EvalResult, GoldSample, SampleRunner } from './types';

export interface TuneContext<C> {
  config: C;
  results: EvalResult[];
  meanF1: number;
  scoreMae: number;
  iteration: number;
}

export interface SelfIterateOptions<C> {
  initialConfig: C;
  /** 由配置构造 runner（later: 用 config 的 tolerance/weights/judgePrompt 跑 agent）。 */
  makeRunner: (config: C) => SampleRunner;
  /** 注入：读评测结果产出新配置（later: AI 调参）。 */
  tune: (ctx: TuneContext<C>) => C | Promise<C>;
  /** 缺省 5。 */
  maxIterations?: number;
  /** 平均 F1 达到即停，缺省 0.9。 */
  targetF1?: number;
}

export interface IterationRecord<C> {
  iteration: number;
  config: C;
  meanF1: number;
  scoreMae: number;
}

export interface SelfIterateResult<C> {
  bestConfig: C;
  bestMeanF1: number;
  history: IterationRecord<C>[];
}

export async function selfIterate<C>(
  samples: GoldSample[],
  opts: SelfIterateOptions<C>,
): Promise<SelfIterateResult<C>> {
  const maxIterations = opts.maxIterations ?? 5;
  const targetF1 = opts.targetF1 ?? 0.9;

  let config = opts.initialConfig;
  const history: IterationRecord<C>[] = [];
  let bestConfig = config;
  let bestMeanF1 = -1;

  for (let i = 0; i < maxIterations; i++) {
    const results = await evaluate(samples, opts.makeRunner(config));
    const mf1 = meanF1(results);
    const mae = scoreMae(results);
    history.push({ iteration: i, config, meanF1: mf1, scoreMae: mae });

    if (mf1 > bestMeanF1) {
      bestMeanF1 = mf1;
      bestConfig = config;
    }
    if (mf1 >= targetF1) break;
    if (i < maxIterations - 1) {
      config = await opts.tune({ config, results, meanF1: mf1, scoreMae: mae, iteration: i });
    }
  }

  return { bestConfig, bestMeanF1, history };
}
