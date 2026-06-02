import type { RawDomCapture, RawDomNode } from '@solvir/verity-core';

/**
 * 浏览器内要抽取的 computed style 属性集（宽集合，design.md 5.1：全量抽、判断让 AI 选）。
 * dom adapter 按这些 key 从 RawDomNode.computed 读值。
 */
export const CAPTURE_PROPS: readonly string[] = [
  'display',
  'flex-direction',
  'justify-content',
  'align-items',
  'gap',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  'text-align',
  'color',
  'background-color',
  'background-image',
  'border-top-width',
  'border-style',
  'border-color',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-right-radius',
  'border-bottom-left-radius',
  'box-shadow',
  'opacity',
];

/** 直接文本（仅本元素的文本子节点，不含后代），空白归一为 null。 */
function directText(el: Element): string | null {
  let s = '';
  el.childNodes.forEach((n) => {
    if (n.nodeType === 3) s += n.textContent ?? '';
  });
  const t = s.replace(/\s+/g, ' ').trim();
  return t === '' ? null : t;
}

/** 读取 CAPTURE_PROPS 的 computed 值，忽略空串。 */
function readComputed(el: Element): Record<string, string> {
  const cs = getComputedStyle(el);
  const out: Record<string, string> = {};
  for (const p of CAPTURE_PROPS) {
    const v = cs.getPropertyValue(p).trim();
    if (v !== '') out[p] = v;
  }
  return out;
}

/**
 * 在浏览器上下文执行的 DOM 抽取（Prism 式遍历），返回 RawDomCapture。
 * 由 driver（Playwright / Chrome DevTools MCP）注入页面执行；契约见 core 的 RawDomCapture。
 * 默认从 document.body 起，driver 可传入具体组件根元素。
 */
export function captureDom(root: Element = document.body): RawDomCapture {
  const nodes: RawDomNode[] = [];

  function walk(el: Element, domPath: string, parentPath: string | null): void {
    const r = el.getBoundingClientRect();
    nodes.push({
      domPath,
      parentPath,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role'),
      ariaLabel: el.getAttribute('aria-label'),
      text: directText(el),
      rect: { x: r.left, y: r.top, width: r.width, height: r.height },
      computed: readComputed(el),
    });
    Array.from(el.children).forEach((c, i) => {
      walk(c, `${domPath}>${c.tagName.toLowerCase()}:nth-child(${i + 1})`, domPath);
    });
  }

  walk(root, root.tagName.toLowerCase(), null);

  let fonts: string[] = [];
  try {
    if (document.fonts) fonts = Array.from(document.fonts as Iterable<FontFace>, (f) => f.family);
  } catch {
    fonts = [];
  }

  return {
    url: typeof location !== 'undefined' ? location.href : undefined,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      dpr: window.devicePixelRatio ?? 1,
    },
    scrollX: window.scrollX ?? 0,
    scrollY: window.scrollY ?? 0,
    fonts,
    nodes,
  };
}
