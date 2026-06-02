/**
 * FigmaSource 真实驱动：Figma REST /v1/files/:key/nodes（design.md 10.1 主真值）。
 * fetchFn 可注入便于测试；token 缺省取 process.env.FIGMA_TOKEN。
 */
import { figmaToStyleTree, type FigmaApiNode, type StyleTree } from '@solvir/verity-core';
import type { FigmaSource, FigmaTarget, Scenario } from '../types';

interface FetchResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}
export type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<FetchResponse>;

export interface FigmaRestOptions {
  /** 缺省 process.env.FIGMA_TOKEN。 */
  token?: string;
  /** 缺省全局 fetch。 */
  fetchFn?: FetchLike;
  /** 缺省 https://api.figma.com。 */
  baseUrl?: string;
}

/** URL 形 node-id（309-1578）转 REST/响应键用的冒号形（309:1578）。 */
function normalizeNodeId(id: string): string {
  return id.replace(/-/g, ':');
}

export class FigmaRestSource implements FigmaSource {
  constructor(private readonly opts: FigmaRestOptions = {}) {}

  async fetchTree(target: FigmaTarget, _scenario?: Scenario): Promise<StyleTree> {
    const token = this.opts.token ?? process.env['FIGMA_TOKEN'];
    if (!token) {
      throw new Error('缺少 Figma token：设置 FIGMA_TOKEN 环境变量或构造时传入 token');
    }
    const fetchFn = this.opts.fetchFn ?? (fetch as unknown as FetchLike);
    const base = this.opts.baseUrl ?? 'https://api.figma.com';
    const nodeId = normalizeNodeId(target.nodeId);
    const url = `${base}/v1/files/${target.fileKey}/nodes?ids=${encodeURIComponent(nodeId)}`;

    const res = await fetchFn(url, { headers: { 'X-Figma-Token': token } });
    if (!res.ok) throw new Error(`Figma REST 请求失败：HTTP ${res.status}`);

    const data = (await res.json()) as { nodes?: Record<string, { document?: FigmaApiNode }> };
    const document = data?.nodes?.[nodeId]?.document;
    if (!document) {
      throw new Error(
        `Figma 节点 ${nodeId} 无 document（确认 node-id 正确、token 有 file_content:read 权限）`,
      );
    }
    return figmaToStyleTree(document);
  }
}
