// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from 'vitest';
import { captureDom } from './capture';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('captureDom — traversal & serialization (jsdom)', () => {
  // 注：jsdom 不做布局，getBoundingClientRect 恒为 0；几何精度靠真实浏览器集成验证。
  test('walks the element subtree, root first', () => {
    document.body.innerHTML = `
      <div id="root" style="display: flex; background-color: rgb(212, 212, 212)">
        <span role="img" style="color: rgb(255, 255, 255)">Hi</span>
      </div>`;
    const root = document.getElementById('root')!;
    const cap = captureDom(root);

    expect(cap.nodes).toHaveLength(2);
    expect(cap.nodes[0]!.domPath).toBe('div');
    expect(cap.nodes[0]!.tag).toBe('div');
  });

  test('extracts tag, role, aria-label and direct text', () => {
    document.body.innerHTML = `<div id="root"><span role="img" aria-label="avatar">Hi</span></div>`;
    const cap = captureDom(document.getElementById('root')!);
    const span = cap.nodes[1]!;
    expect(span.tag).toBe('span');
    expect(span.role).toBe('img');
    expect(span.ariaLabel).toBe('avatar');
    expect(span.text).toBe('Hi');
  });

  test('container with only element children has null direct text', () => {
    document.body.innerHTML = `<div id="root"><span>Hi</span></div>`;
    const cap = captureDom(document.getElementById('root')!);
    expect(cap.nodes[0]!.text).toBeNull();
  });

  test('wires parent/child via domPath', () => {
    document.body.innerHTML = `<div id="root"><span>a</span></div>`;
    const cap = captureDom(document.getElementById('root')!);
    expect(cap.nodes[1]!.parentPath).toBe('div');
    expect(cap.nodes[1]!.domPath).toBe('div>span:nth-child(1)');
  });

  test('reads computed style for CAPTURE_PROPS keys', () => {
    document.body.innerHTML = `<div id="root" style="display: flex; background-color: rgb(212, 212, 212)"></div>`;
    const cap = captureDom(document.getElementById('root')!);
    expect(cap.nodes[0]!.computed['display']).toBe('flex');
    expect(cap.nodes[0]!.computed['background-color']).toBe('rgb(212, 212, 212)');
  });

  test('includes a viewport and a rect shape on every node', () => {
    document.body.innerHTML = `<div id="root"></div>`;
    const cap = captureDom(document.getElementById('root')!);
    expect(cap.viewport).toMatchObject({ width: expect.any(Number), height: expect.any(Number), dpr: expect.any(Number) });
    expect(cap.nodes[0]!.rect).toMatchObject({ x: expect.any(Number), y: expect.any(Number), width: expect.any(Number), height: expect.any(Number) });
  });

  test('defaults the root to document.body when none is given', () => {
    document.body.innerHTML = `<p>x</p>`;
    const cap = captureDom();
    expect(cap.nodes[0]!.domPath).toBe('body');
    expect(cap.nodes.length).toBeGreaterThanOrEqual(2);
  });
});
