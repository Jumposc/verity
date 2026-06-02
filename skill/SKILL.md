---
name: verity
description: 用结构化样式数据验收设计还原度——Figma 设计真值 vs 前端实现，属性级 + 几何级 diff，AI 只判定需要判断的部分。当用户要"验收 UI 还原度 / 对比 Figma 和实现 / 跑 verity / 还原度评估"时使用。
---

# Verity Skill（Claude Code 入口）

确定性测量由 `verity` CLI 做（Figma REST + Playwright → 配对 → 纯客观 diff），**AI judge 由你（Claude Code）在此完成**：读裁剪后的 top-risk JSON，按场景打还原度分、列严重问题，必要时改实现代码重跑。无需 ANTHROPIC_API_KEY。

**验收和修复统一走 `verity-acceptance` subagent**（`.claude/agents/verity-acceptance.md`）：派它跑下面的闭环。它还会在真实验收时按 [prompts/self-iterate.md](prompts/self-iterate.md) 把可泛化的判断经验写回项目（gold 样本 + tolerance/judge.md，eval 验证后沉淀，记 [../LEARNINGS.md](../LEARNINGS.md)）。

## 何时触发

- 用户要对照 Figma 验收前端还原度
- "跑 verity" / "对一下设计稿" / "还原度评估"

## 前置（一次性）

```bash
cd <verity 仓库>
pnpm install && pnpm -r build
pnpm --filter @solvir/verity-agent exec playwright install chromium
# Figma 令牌（Security 页生成，需 file_content:read）：
test -f .env || echo 'FIGMA_TOKEN=figd_xxx' > .env
```

需要用户给：Figma `fileKey` + 组件 `node-id`（Figma 选中组件 → Copy link 取）、实现页面 URL、对应组件根元素的 CSS `--selector`。缺哪个就先问。

## Runbook

### 1. 跑确定性测量

```bash
node packages/agent/dist/cli.js \
  --figma-file <fileKey> --node <nodeId> \
  --url <实现页面> --selector <css 选择器> \
  --out .verity/report.html --judge-out .verity/judge-input.json
```

输出基线（配对数 / 未配对 / 属性匹配率 / 几何 MAE）、HTML 报告路径、裁剪后的 `.verity/judge-input.json`。

### 2. 配对消歧（按需）

`judge-input.json` 的 `ambiguousPairs` 非空时，按 [prompts/disambiguate.md](prompts/disambiguate.md) 逐个判断正确配对。多数情况为空，跳过。

### 3. AI judge（你来做）

`Read` `.verity/judge-input.json`（已是裁剪后的 top-risk：超容差属性差 + 几何差 + baseline），按 [prompts/judge.md](prompts/judge.md)：

- 按场景动态加权（按钮重 padding/圆角/字色；标题/营销图权重不同）
- 用给定数值，**不要重新测量**；ΔE<2、容差内的不报
- 产出 `Judgment`：`fidelityScore`（0-100）+ `findings`（每条 `{nodeId, severity, attr, message, fixHint?}`）

把评分和 findings 报告给用户。

### 4. 修复（可选）

用户要修复时，按 [prompts/fix.md](prompts/fix.md)，派 `ui-acceptance` subagent 或直接动手：一次改一条（critical 优先）→ 重跑步骤 1 → 确认对应 delta 收敛 → 下一条。

## AI 介入点 → prompt

| 步骤 | prompt | 输入 |
|---|---|---|
| 配对消歧 | `prompts/disambiguate.md` | `judge-input.json` 的 `ambiguousPairs` |
| 严重度 + 打分 | `prompts/judge.md` | `judge-input.json`（裁剪后的 top-risk diff + scenario） |
| 修复 | `prompts/fix.md` | 你产出的 `findings` |
| 自迭代写回 | `prompts/self-iterate.md` | 可泛化判断 → gold + tolerance/judge.md（eval 验证后沉淀） |

## 与独立运行的差异

- 浏览器自动化：独立 CLI 走 Playwright（本 skill 即用它）；纯交互排查也可用 chrome-devtools MCP
- 两条路共用 `@solvir/verity-capture` 的 `captureDom` + `CAPTURE_PROPS`

## 状态

端到端可用：`verity` CLI 出确定性报告 + `--judge-out` 裁剪 JSON；AI judge 走本 skill（读裁剪 JSON → judge.md 打分 → fix.md 修复）。
已知精修点：matcher 已折叠重合 wrapper；tolerance 待处理"超完全圆角阈值的 radius 等价"。gold set + eval 自迭代待补。
