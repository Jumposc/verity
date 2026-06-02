/**
 * DomCapturer 真实驱动：Playwright 打开 url、注入 capture IIFE、抽 RawDomCapture，
 * 经 domToStyleTree 归一化为 StyleTree（design.md 13：独立框架用 Playwright）。
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chromium, type Browser } from 'playwright';
import { domToStyleTree, type RawDomCapture, type StyleTree } from '@solvir/verity-core';
import type { DomCapturer, Scenario } from '../types';

const require = createRequire(import.meta.url);

export interface PlaywrightCaptureOptions {
  /** 抽取的根元素选择器（对应 Figma 节点的实现元素）。缺省 'body'。 */
  rootSelector?: string;
  /** 复用已有 browser（缺省每次 launch+close）。 */
  browser?: Browser;
  headless?: boolean;
  /** goto 超时 ms，缺省 30000。 */
  timeout?: number;
}

/** 读取打包好的可注入 IIFE 源码（暴露 window.__verityCapture）。 */
function injectSource(): string {
  return readFileSync(require.resolve('@solvir/verity-capture/inject'), 'utf8');
}

interface CaptureGlobal {
  __verityCapture: { captureDom: (root: Element) => RawDomCapture };
}

export class PlaywrightCapturer implements DomCapturer {
  constructor(private readonly opts: PlaywrightCaptureOptions = {}) {}

  async capture(url: string, scenario?: Scenario): Promise<StyleTree> {
    const ownBrowser = !this.opts.browser;
    const browser = this.opts.browser ?? (await chromium.launch({ headless: this.opts.headless ?? true }));
    try {
      const page = await browser.newPage({
        viewport: scenario?.viewport
          ? { width: scenario.viewport.width, height: scenario.viewport.height }
          : { width: 1440, height: 900 },
        deviceScaleFactor: 1,
      });
      await page.goto(url, { waitUntil: 'load', timeout: this.opts.timeout ?? 30000 });
      // 字体就绪后再抽（design.md 10.1）
      await page.evaluate(async () => {
        const fonts = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts;
        if (fonts?.ready) await fonts.ready;
      });
      await page.addScriptTag({ content: injectSource() });

      const rootSelector = this.opts.rootSelector ?? 'body';
      const raw = (await page.evaluate((sel) => {
        const g = window as unknown as CaptureGlobal;
        const root = document.querySelector(sel) ?? document.body;
        return g.__verityCapture.captureDom(root);
      }, rootSelector)) as RawDomCapture;

      await page.close();
      return domToStyleTree(raw);
    } finally {
      if (ownBrowser) await browser.close();
    }
  }
}
