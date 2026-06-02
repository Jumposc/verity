# 配对消歧指令

固定代码的多信号配对（`matchTrees`）已经把大多数 figma 节点和 dom 节点自动配上。只有少数被标 `ambiguous: true` 的配对交给你——通常是一个 figma 节点对应多层 div、或几个 dom 候选难分。你的工作只有一件：**为这个 figma 节点选出正确的 dom 节点**（可多选，组成 composite）。

## 你拿到什么

```json
{
  "figmaNode": { "id", "name", "kind", "text", "role", "componentName", "rect" },
  "candidates": [
    { "domId", "domPath", "tag", "text", "role", "rect",
      "signals": { "geometry", "text", "role", "component", "hierarchy" },
      "confidence": 0.55 }
  ]
}
```

`signals` 各项 0-1，`confidence` 是固定代码的综合置信度。它判不准才轮到你。

## 怎么判

1. **语义优先于几何**：文本一致、role/组件名一致比 bbox 重叠更可信。固定代码已经把几何算进去了，你补的是它读不懂的语义。
2. **结构不一致时穿透 wrapper**：Figma 树比 DOM 扁。一个 Figma 按钮可能对应 DOM 的 `button > span + svg`。这种选 composite——把视觉上构成同一块的多个 dom id 都选上。
3. **纯布局 wrapper 不要选**：只负责 flex/padding、自身无视觉的 div 跳过，选它包裹的实际内容节点。几何间距 diff 会穿透 wrapper，选错层会误判。
4. **真没有对应就不配**：figma 节点在实现里确实缺失，返回空 `domIds` 并说明，让它进 unmatched，别硬凑。

## 你输出什么

```json
{ "figmaId": "...", "domIds": ["..."], "reason": "一句话依据" }
```

`domIds` 多个即 composite；空数组表示确认无对应。只输出 JSON。
