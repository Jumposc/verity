/**
 * Reporter 默认实现：用 core.renderHtml 写出自包含 HTML 报告。
 */
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { renderHtml, type DiffReport } from '@solvir/verity-core';
import type { Judgment, Reporter } from '../types';

export interface HtmlReporterOptions {
  /** 输出路径，缺省 ./verity-report.html。 */
  outPath?: string;
}

export class HtmlReporter implements Reporter {
  constructor(private readonly opts: HtmlReporterOptions = {}) {}

  async write(report: DiffReport, _judgment: Judgment | null): Promise<string> {
    const out = resolve(this.opts.outPath ?? 'verity-report.html');
    await writeFile(out, renderHtml(report), 'utf8');
    return out;
  }
}
