import { describe, expect, test } from 'vitest';
import { FigmaRestSource, type FetchLike } from './figma-rest';

const node = { id: '1:2', name: 'Box', type: 'FRAME', absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 } };

const fakeFetch = (body: unknown, ok = true, status = 200): FetchLike =>
  async () => ({ ok, status, json: async () => body });

describe('FigmaRestSource', () => {
  test('fetches a node and converts its document to a StyleTree', async () => {
    const src = new FigmaRestSource({ token: 't', fetchFn: fakeFetch({ nodes: { '1:2': { document: node } } }) });
    const tree = await src.fetchTree({ fileKey: 'k', nodeId: '1:2' });
    expect(tree.source).toBe('figma');
    expect(tree.rootId).toBe('1:2');
    expect(tree.nodes).toHaveLength(1);
  });

  test('normalizes dash node-id (URL form) to colon for the lookup', async () => {
    let calledUrl = '';
    const fetchFn: FetchLike = async (url) => {
      calledUrl = url;
      return { ok: true, status: 200, json: async () => ({ nodes: { '1:2': { document: node } } }) };
    };
    const src = new FigmaRestSource({ token: 't', fetchFn });
    const tree = await src.fetchTree({ fileKey: 'k', nodeId: '1-2' });
    expect(tree.rootId).toBe('1:2');
    expect(calledUrl).toContain('ids=1%3A2'); // 冒号被 encode
  });

  test('throws a clear error without a token', async () => {
    const src = new FigmaRestSource({ token: '', fetchFn: fakeFetch({}) });
    await expect(src.fetchTree({ fileKey: 'k', nodeId: '1:2' })).rejects.toThrow(/token/i);
  });

  test('throws on non-ok response', async () => {
    const src = new FigmaRestSource({ token: 't', fetchFn: fakeFetch({}, false, 403) });
    await expect(src.fetchTree({ fileKey: 'k', nodeId: '1:2' })).rejects.toThrow(/403/);
  });

  test('throws when the node has no document', async () => {
    const src = new FigmaRestSource({ token: 't', fetchFn: fakeFetch({ nodes: {} }) });
    await expect(src.fetchTree({ fileKey: 'k', nodeId: '1:2' })).rejects.toThrow(/document|node/i);
  });
});
