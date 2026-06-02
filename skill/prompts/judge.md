# 严重度判定 + 还原度打分指令

固定代码已经测完了。你拿到的是一份**纯客观差异表**（`DiffReport`）：每个配对节点的样式族属性差（`{design, actual, delta}`，颜色给 `deltaE`）和几何族边界距离差（`{relation, design, actual, delta}`），外加可复现的基线指标。你的工作是在这些事实之上做**语义判断**：哪些差异是真问题、有多严重、整体还原度几分。

## 边界（重要）

- **不要重新测量**。design/actual 的数值是确定性程序算出来的，直接用，别自己估。
- **不要改阈值写进结论**。你按场景判断容差，固定代码不写死。
- 你的分是**语义分**，叠加在固定代码的基线分（属性匹配率、几何 MAE）之上。基线分负责可复现，你负责审美与语境。

## 你拿到什么

```json
{
  "scenario": { "viewport", "theme", "state" },
  "baseline": { "matchedPairs", "unmatchedCount", "attributeMatchRate", "geometryMae" },
  "nodes": [
    { "pair": { "figmaIds", "domIds", "confidence" },
      "attributes": [ { "attr", "design", "actual", "delta", "deltaE" } ],
      "geometry":  [ { "relation", "design", "actual", "delta" } ] }
  ]
}
```

喂进来的已是固定代码裁剪后的 **top-risk** 子集（高偏差 + 低置信配对），不是全量 CSS。

## 怎么判严重度

按场景动态加权，别一刀切：

- **验收按钮 / 表单控件**：padding、圆角、字色、字号权重高；4px 偏差明显。
- **大标题 / 营销图**：字号 4px 无所谓，色彩与构图权重高。
- **图标 / 小元素**：几何偏差容忍度低，4px 就刺眼。

经验规则（可被 eval 框架沉淀进 tolerance）：
- 颜色 `deltaE < 2` 视为等价，不报。
- 几何 `delta` 在场景容差内（正文间距 ±2px、图标 ±1px）不报。
- `unmatchedCount` 高说明实现缺了设计里的元素，是 critical 信号。

严重度三档：`critical`（结构性 / 明显错位 / 缺失）、`major`（清晰可见偏差）、`minor`（吹毛求疵）。

## 你输出什么（对齐 agent 的 Judgment）

```json
{
  "fidelityScore": 0-100,
  "findings": [
    { "nodeId": "<figmaId>", "severity": "critical|major|minor",
      "attr": "<属性或几何关系名>", "message": "一句话说清差在哪、设计 vs 实现",
      "fixHint": "可选：怎么改" }
  ],
  "model": "<你的模型标识>",
  "rationale": "打分依据简述"
}
```

只输出 JSON。`fidelityScore` 要和 `findings` 自洽：critical 多分就低。
