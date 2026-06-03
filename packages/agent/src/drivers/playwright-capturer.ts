/**
 * DomCapturer 真实驱动：Playwright 打开 url、注入 capture IIFE、抽 RawDomCapture，
 * 经 domToStyleTree 归一化为 StyleTree（design.md 13：独立框架用 Playwright）。
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chromium, type Browser, type Page } from 'playwright';
import { domToStyleTree, type RawDomCapture, type StyleTree } from '@solvir/verity-core';
import type { DomCapturer, Scenario } from '../types';

const require = createRequire(import.meta.url);

/**
 * 等 DOM mutation 静默：连续 quietMs 无 DOM 变化才算稳定。
 * SPA（qiankun/React）初次挂载 + 数据加载 + tab 切换会连续重渲染，期间 DOM 不断重建——
 * 此时 readyScript 打的标记会被随后的重渲染冲掉、selector 也可能命中中间态节点。
 * 在操作前/抽取前 settle，确保在稳定 DOM 上标记与抽取。
 */
async function waitForDomSettle(page: Page, quietMs = 600, timeout = 8000): Promise<void> {
  await page
    .evaluate(
      ({ quietMs, timeout }) =>
        new Promise<void>((resolve) => {
          let last = performance.now();
          const obs = new MutationObserver(() => {
            last = performance.now();
          });
          obs.observe(document.documentElement, {
            subtree: true,
            childList: true,
            attributes: true,
            characterData: true,
          });
          const deadline = performance.now() + timeout;
          const tick = () => {
            const now = performance.now();
            if (now - last >= quietMs || now >= deadline) {
              obs.disconnect();
              resolve();
            } else {
              setTimeout(tick, 100);
            }
          };
          setTimeout(tick, 100);
        }),
      { quietMs, timeout },
    )
    .catch(() => {});
}

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
  /**
   * 抽取前在页面执行的脚本（async 函数体），把页面操作到目标状态再抽——多状态复现的手段
   * （切 tab/模板 radio、开关折叠区、切手机/桌面预览等）。在根元素挂载后、注入抽取 IIFE 前执行。
   * 脚本内可 await（点击后自行等 re-render 落定，如 `await new Promise(r=>setTimeout(r,400))`）。
   */
  readyScript?: string;
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
      const mountTimeout = this.opts.mountTimeout ?? 15000;
      // readyScript 要操作页面，得先等 SPA 把实质内容挂载出来（goto domcontentloaded 后 qiankun 仍在异步 mount）。
      // 这里等的是通用就绪信号（body 有文字），不是抽取根——因为根可能正是 readyScript 之后才标记/切出来的。
      if (this.opts.readyScript) {
        await page
          .waitForFunction(() => !!document.body && document.body.innerText.trim().length > 30, null, {
            timeout: mountTimeout,
          })
          .catch(() => {});
        // 先等初次挂载/重渲染静默，再让 readyScript 操作——否则标记会被随后的重渲染冲掉。
        await waitForDomSettle(page);
        // 多状态复现：把页面操作到目标态 + 可给抽取目标打标记（脚本自行轮询等元素、点击、等 re-render 落定）。
        await page.evaluate(
          (src) => new Function(`return (async () => { ${src} })()`)(),
          this.opts.readyScript,
        );
        // readyScript 触发的切态/重渲染再次静默，确保标记与目标态在抽取时仍在。
        await waitForDomSettle(page);
      }
      // qiankun/SPA 异步 mount：等抽取根元素真正渲染出尺寸再抽，否则抓到 bootstrap 空壳。
      // 超时则放行（按现状抽，不硬失败），便于诊断真正的空页面。
      await page
        .waitForFunction(
          (sel) => {
            const el = document.querySelector(sel);
            return !!el && el.getBoundingClientRect().height > 0;
          },
          rootSelector,
          { timeout: mountTimeout },
        )
        .catch(() => {});
      // 字体就绪后再抽（design.md 10.1）；readyScript 可能换了文案/触发重渲染，这里一并兜住。
      await page.evaluate(async () => {
        const fonts = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts;
        if (fonts?.ready) await fonts.ready;
      });
      // 抽取前最后一次静默：字体回流 / 图片加载 / 懒渲染落定，避免抽到中间态（无 readyScript 时也生效）。
      await waitForDomSettle(page);
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
