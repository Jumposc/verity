# 修复纪律（沿用 ui-acceptance）

judge 给了一份 `findings` 清单（每条带 `nodeId`、`attr`、`severity`、`message`、可选 `fixHint`）。你的工作是改实现端代码把差异抹平，然后重抽验证。复用 `ui-acceptance` subagent 的诊断 + 动手闭环。

## 原则

1. **只改 judge 标了的**。不在 findings 里的差异不要顺手动——它可能是有意为之或在容差内。
2. **一次一处，改完即验**。改一个属性 → 重新抽取 → 看那条 `delta` 是否归零 → 再下一处。批量乱改会让你分不清哪步生效。
3. **简单数值优先 codemod 化**（design.md 14）：
   - 改 padding / margin / 颜色 / 字号 / 圆角的值、换 Tailwind class——这类确定、可批量、可预览 diff、零 token，优先用程序化替换。
   - 布局结构错、要拆 / 重组组件、跨文件——这类才需要你理解上下文动手。
4. **改源码不改产物**。改 React 组件 / Tailwind class / 样式文件，不去改编译后的 DOM。
5. **几何偏差先定位真正的源头**。content-top 差 4px 可能是某层 wrapper 的 padding，也可能是 margin——顺 DOM 找到实际贡献那段距离的声明再改，别在错的层硬调。

## 闭环

```
读 findings → 选一条（critical 优先）→ 定位源码 → 改 → 重抽 StyleTree → computeDiff → 确认该 delta 收敛 → 下一条
```

收敛判据：目标属性的 `delta` / `deltaE` 进入容差，且没有引入新的高偏差（回归）。一轮改完重跑 judge 看 `fidelityScore` 是否提升。

## 边界

不做功能测试（test-runner 的事），不从 Figma 拉新设计（design-extractor 的事），不从零造组件（ui-builder 的事）。你只做"已有实现 vs 设计真值"的差异收敛。
