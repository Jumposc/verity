import { describe, expect, test } from 'vitest';
import { renderHtml } from './html';
import type { DiffReport, NodePair } from '../schema';

const pair = (figmaIds: string[], domIds: string[]): NodePair => ({
  figmaIds,
  domIds,
  confidence: 0.9,
  signals: { geometry: 0.9, text: 1, role: 0, component: 0, hierarchy: 1 },
  ambiguous: false,
});

const report: DiffReport = {
  source: { figma: 'F', dom: 'D' },
  nodes: [
    {
      pair: pair(['f-c'], ['d-c']),
      attributes: [
        { attr: 'fontSize', design: 16, actual: 14, delta: -2, deltaE: null },
        { attr: 'backgroundColor', design: '#FFFFFF', actual: '#1A7BF0', delta: null, deltaE: 30 },
      ],
      geometry: [{ relation: 'content-top', design: 20, actual: 16, delta: -4 }],
    },
  ],
  baseline: { matchedPairs: 1, unmatchedCount: 0, attributeMatchRate: 0.5, geometryMae: 4 },
};

describe('renderHtml', () => {
  test('emits a self-contained html document', () => {
    const html = renderHtml(report).toLowerCase();
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('</html>');
  });

  test('renders baseline metrics including match rate', () => {
    const html = renderHtml(report);
    expect(html).toContain('50.0%'); // attributeMatchRate
    expect(html).toContain('content-top');
  });

  test('renders attribute rows with design, actual and delta', () => {
    const html = renderHtml(report);
    expect(html).toContain('fontSize');
    expect(html).toContain('-2');
    expect(html).toContain('#1A7BF0');
  });

  test('escapes html in node identifiers', () => {
    const evil: DiffReport = {
      ...report,
      nodes: [{ ...report.nodes[0]!, pair: pair(['<img src=x onerror=alert(1)>'], ['d']) }],
    };
    const html = renderHtml(evil);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });
});
