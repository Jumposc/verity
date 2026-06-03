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
  /** 等抽取根元素挂载出尺寸的超时 ms，缺省 15000。qiankun/SPA 在 load 后异步 mount，否则抓到 bootstrap 空壳。 */
  mountTimeout?: number;
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
      // dev server（qiankun/vite）的 load 事件常因长连接/HMR 永不触发，30s 必超时。
      // 改等 domcontentloaded，真正的"渲染完成"由下面的 waitForFunction(根元素高度>0) 保证。
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.opts.timeout ?? 30000 });
      const rootSelector = this.opts.rootSelector ?? 'body';
      // qiankun/SPA 在 load 后异步 mount：等抽取根元素真正渲染出尺寸再抽，否则抓到 bootstrap 空壳。
      // 超时则放行（按现状抽，不硬失败），便于诊断真正的空页面。
      await page
        .waitForFunction(
          (sel) => {
            const el = document.querySelector(sel);
            return !!el && el.getBoundingClientRect().height > 0;
          },
          rootSelector,
          { timeout: this.opts.mountTimeout ?? 15000 },
        )
        .catch(() => {});
      // 字体就绪后再抽（design.md 10.1）
      await page.evaluate(async () => {
        const fonts = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts;
        if (fonts?.ready) await fonts.ready;
      });
      await page.addScriptTag({ content: injectSource() });

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
