import { describe, expect, test } from 'vitest';
import type { DiffReport, StyleTree } from '@solvir/verity-core';
import { run } from './run';
import type { DomCapturer, FigmaSource, Judge, Judgment, Reporter } from './types';

const tree = (source: StyleTree['source'], rootId: string): StyleTree => ({
  source,
  frame: { x: 0, y: 0, w: 1440, h: 900 },
  nodes: [],
  rootId,
});

const figmaSource = (): FigmaSource => ({
  fetchTree: async () => tree('figma', 'F'),
});
const domCapturer = (): DomCapturer => ({
  capture: async () => tree('dom', 'D'),
});

const opts = { figma: { fileKey: 'k', nodeId: '1:2' }, url: 'http://localhost:3000' };

describe('run', () => {
  test('returns deterministic diff with no judge/reporter', async () => {
    const res = await run(opts, { figma: figmaSource(), dom: domCapturer() });
    expect(res.diff.source).toEqual({ figma: 'F', dom: 'D' });
    expect(res.judgment).toBeNull();
    expect(res.reportPath).toBeNull();
  });

  test('exposes both raw StyleTrees for gold snapshotting', async () => {
    const res = await run(opts, { figma: figmaSource(), dom: domCapturer() });
    expect(res.figmaTree.rootId).toBe('F');
    expect(res.domTree.rootId).toBe('D');
  });

  test('passes the computed diff to the judge and returns its judgment', async () => {
    let seen: DiffReport | null = null;
    const judgment: Judgment = { fidelityScore: 88, findings: [], model: 'fake' };
    const judge: Judge = {
      judge: async (report) => {
        seen = report;
        return judgment;
      },
    };
    const res = await run(opts, { figma: figmaSource(), dom: domCapturer(), judge });
    expect(res.judgment).toBe(judgment);
    expect(seen).not.toBeNull();
    expect(seen!.source.figma).toBe('F');
  });

  test('hands diff and judgment to the reporter and returns its path', async () => {
    const calls: Array<{ report: DiffReport; judgment: Judgment | null }> = [];
    const reporter: Reporter = {
      write: async (report, j) => {
        calls.push({ report, judgment: j });
        return '/tmp/report.html';
      },
    };
    const judgment: Judgment = { fidelityScore: 70, findings: [], model: 'fake' };
    const res = await run(opts, {
      figma: figmaSource(),
      dom: domCapturer(),
      judge: { judge: async () => judgment },
      reporter,
    });
    expect(res.reportPath).toBe('/tmp/report.html');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.judgment).toBe(judgment);
  });

  test('invokes both sources with their inputs', async () => {
    let figmaArg = '';
    let urlArg = '';
    const res = await run(opts, {
      figma: { fetchTree: async (t) => ((figmaArg = t.nodeId), tree('figma', 'F')) },
      dom: { capture: async (u) => ((urlArg = u), tree('dom', 'D')) },
    });
    expect(figmaArg).toBe('1:2');
    expect(urlArg).toBe('http://localhost:3000');
    expect(res.diff).toBeDefined();
  });
});
