#!/usr/bin/env node
/**
 * verity CLI：一条命令端到端跑设计-实现还原度验收。
 * 参数：--figma-file <key> --node <id> --url <实现页面> [--selector <css>] [--viewport WxH] [--out <文件>] [--max-items <n>] [--ready-script <jsfile>]
 * 真值源走 Figma REST（需 FIGMA_TOKEN，可放 .env），实现端走 Playwright。
 */
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnv } from './env';
import { run } from './run';
import { FigmaRestSource } from './drivers/figma-rest';
import { PlaywrightCapturer } from './drivers/playwright-capturer';
import { HtmlReporter } from './drivers/html-reporter';
import { cropForJudge } from './judge/crop';
import type { VerityRunOptions } from './types';

export function getFlag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

export function parseArgs(argv: string[]): VerityRunOptions {
  const fileKey = getFlag(argv, 'figma-file');
  const nodeId = getFlag(argv, 'node');
  const url = getFlag(argv, 'url');
  const viewport = getFlag(argv, 'viewport');

  if (!fileKey) throw new Error('缺少 --figma-file <fileKey>');
  if (!nodeId) throw new Error('缺少 --node <nodeId>');
  if (!url) throw new Error('缺少 --url <实现页面 URL>');

  const opts: VerityRunOptions = { figma: { fileKey, nodeId }, url };

  if (viewport) {
    const m = /^(\d+)x(\d+)$/.exec(viewport);
    if (!m) throw new Error(`--viewport 格式应为 WxH（如 1440x900），收到：${viewport}`);
    opts.scenario = { viewport: { width: Number(m[1]), height: Number(m[2]) } };
  }

  return opts;
}

export async function main(argv: string[]): Promise<void> {
  loadEnv();
  const opts = parseArgs(argv);
  const selector = getFlag(argv, 'selector');
  const out = getFlag(argv, 'out');
  const judgeOut = getFlag(argv, 'judge-out');
  // 多状态复现：--ready-script 指向一个 JS 文件（async 函数体），抽取前在页面执行把它操作到目标状态。
  const readyScriptFile = getFlag(argv, 'ready-script');
  const readyScript = readyScriptFile ? readFileSync(resolve(readyScriptFile), 'utf8') : undefined;

  // judge 裁剪预算：缺省走 cropForJudge 内置 60。预算偏小时真实差多了会把次要项（如某条间距偏移）挤出榜，
  // 调大可让更长尾的真实偏差进 judge 视野（代价是 prompt 更长）。
  const maxItemsFlag = getFlag(argv, 'max-items');
  const maxItems = maxItemsFlag != null ? Number(maxItemsFlag) : undefined;
  if (maxItemsFlag != null && (!Number.isInteger(maxItems) || (maxItems as number) <= 0)) {
    throw new Error(`--max-items 应为正整数，收到：${maxItemsFlag}`);
  }

  const result = await run(opts, {
    figma: new FigmaRestSource(),
    dom: new PlaywrightCapturer({ rootSelector: selector, readyScript }),
    reporter: new HtmlReporter({ outPath: out }),
  });

  const b = result.diff.baseline;
  console.log(`配对 ${b.matchedPairs} | 未配对 ${b.unmatchedCount} | 属性匹配率 ${(b.attributeMatchRate * 100).toFixed(1)}% | 几何 MAE ${b.geometryMae.toFixed(2)}px`);
  console.log(`报告：${result.reportPath ?? '(未生成)'}`);

  // 裁剪后的 top-risk JSON，供 Claude Code skill 读取做 AI judge
  if (judgeOut) {
    const judgeInput = cropForJudge(result.diff, { scenario: opts.scenario, maxItems });
    const judgePath = resolve(judgeOut);
    await writeFile(judgePath, JSON.stringify(judgeInput, null, 2), 'utf8');
    console.log(`judge 输入：${judgePath}`);
  }

  // 两棵 StyleTree + expected 模板，供把真实案例快照成 gold 样本做自迭代
  const treesOut = getFlag(argv, 'trees-out');
  if (treesOut) {
    const dir = resolve(treesOut);
    await mkdir(dir, { recursive: true });
    await writeFile(`${dir}/figma.tree.json`, JSON.stringify(result.figmaTree, null, 2), 'utf8');
    await writeFile(`${dir}/dom.tree.json`, JSON.stringify(result.domTree, null, 2), 'utf8');
    await writeFile(
      `${dir}/expected.json`,
      JSON.stringify({ fidelityScore: null, criticalFindings: [] }, null, 2),
      'utf8',
    );
    console.log(`树快照：${dir}/{figma,dom}.tree.json（填 expected.json 后可入 gold）`);
  }
}

const invokedDirectly =
  typeof process !== 'undefined' && process.argv[1] === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
