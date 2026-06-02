/**
 * DiffReport 转自包含 HTML（design.md 5 / 10.1）。固定代码只可视化客观数值，
 * 严重度判定与修复建议是 AI judge 的产物，不在此渲染。
 * 按 NodeDiff（可修复对象）聚合：每节点列样式族属性差与几何族距离差。
 */
import type { AttributeDiff, DiffReport, GeometryDiff, NodeDiff } from '../schema';

function esc(v: unknown): string {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 渲染单元格值，null 显示为破折号。 */
function cell(v: number | string | null): string {
  return v == null ? '—' : esc(v);
}

/** 差异强度配色（纯视觉提示，非 pass/fail 判定）。 */
function magClass(magnitude: number): string {
  if (magnitude === 0) return 'ok';
  if (magnitude < 4) return 'warn';
  return 'bad';
}

function attrRow(d: AttributeDiff): string {
  const isColor = d.deltaE != null;
  const mag = isColor ? d.deltaE! : Math.abs(d.delta ?? 0);
  const deltaText = isColor ? `ΔE ${d.deltaE!.toFixed(1)}` : d.delta == null ? '—' : String(d.delta);
  return `<tr class="${magClass(d.delta == null && !isColor ? 1 : mag)}">
    <td>${esc(d.attr)}</td><td>${cell(d.design)}</td><td>${cell(d.actual)}</td><td>${esc(deltaText)}</td>
  </tr>`;
}

function geoRow(g: GeometryDiff): string {
  return `<tr class="${magClass(Math.abs(g.delta))}">
    <td>${esc(g.relation)}</td><td>${g.design}</td><td>${g.actual}</td><td>${g.delta}</td>
  </tr>`;
}

function nodeSection(n: NodeDiff): string {
  const title = `${esc(n.pair.figmaIds.join(','))} → ${esc(n.pair.domIds.join(','))}`;
  const flag = n.pair.ambiguous ? ' <span class="amb">ambiguous</span>' : '';
  const attrs = n.attributes.length
    ? `<table><thead><tr><th>属性</th><th>设计</th><th>实现</th><th>Δ</th></tr></thead><tbody>${n.attributes.map(attrRow).join('')}</tbody></table>`
    : '';
  const geo = n.geometry.length
    ? `<table><thead><tr><th>几何关系</th><th>设计</th><th>实现</th><th>Δ</th></tr></thead><tbody>${n.geometry.map(geoRow).join('')}</tbody></table>`
    : '';
  return `<section class="node">
    <h3>${title}<span class="conf">conf ${n.pair.confidence.toFixed(2)}</span>${flag}</h3>
    ${attrs}${geo}
  </section>`;
}

export function renderHtml(report: DiffReport): string {
  const b = report.baseline;
  const rate = (b.attributeMatchRate * 100).toFixed(1);
  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<title>Verity 还原度报告</title>
<style>
  body { font: 14px/1.5 -apple-system, system-ui, sans-serif; margin: 24px; color: #1d1d1f; }
  h1 { font-size: 20px; }
  .metrics { display: flex; gap: 24px; margin: 16px 0 24px; }
  .metric { background: #f5f5f7; border-radius: 8px; padding: 12px 16px; }
  .metric .v { font-size: 20px; font-weight: 600; }
  .metric .k { color: #6e6e73; font-size: 12px; }
  .node { border: 1px solid #e5e5ea; border-radius: 8px; padding: 12px 16px; margin: 12px 0; }
  .node h3 { margin: 0 0 8px; font-size: 14px; font-family: ui-monospace, monospace; }
  .conf { color: #6e6e73; font-weight: 400; margin-left: 8px; }
  .amb { color: #b25000; background: #fff3e0; border-radius: 4px; padding: 1px 6px; font-size: 12px; }
  table { border-collapse: collapse; width: 100%; margin: 6px 0; }
  th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid #f0f0f2; font-size: 13px; }
  th { color: #6e6e73; font-weight: 500; }
  tr.ok td:last-child { color: #1a7f37; }
  tr.warn td:last-child { color: #b25000; }
  tr.bad td:last-child { color: #c4314b; font-weight: 600; }
</style>
</head>
<body>
<h1>Verity 还原度报告</h1>
<p>source: <code>${esc(report.source.figma)}</code> → <code>${esc(report.source.dom)}</code></p>
<div class="metrics">
  <div class="metric"><div class="v">${b.matchedPairs}</div><div class="k">配对节点</div></div>
  <div class="metric"><div class="v">${b.unmatchedCount}</div><div class="k">未配对</div></div>
  <div class="metric"><div class="v">${rate}%</div><div class="k">属性匹配率</div></div>
  <div class="metric"><div class="v">${b.geometryMae.toFixed(2)}px</div><div class="k">几何 MAE</div></div>
</div>
${report.nodes.map(nodeSection).join('\n')}
</body>
</html>`;
}
