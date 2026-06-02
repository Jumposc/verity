# Verity

结构化样式还原度校验工具。把 Figma 设计真值和前端实现都抽成统一的结构化样式数据，逐属性 + 几何边界距离 diff，AI 只在需要判断的地方介入（配对消歧 / 严重度判定 / 修复）。取代慢而贵的截图视觉对比。

## 方案对比：截图视觉对比 vs 结构化样式 diff

现有的设计还原度验收（含 Claude Code 里常见的 `visual-validation` + `ui-acceptance` 截图流）主要靠**截图喂 LLM 目视**。Verity 走另一条路：**把两端抽成结构化样式数据，让 AI 直接比数据**。

| | 截图视觉对比（传统） | Verity（结构化样式 diff） |
|---|---|---|
| 怎么比 | 截图 → 整张图喂 LLM 看 | 两端抽成结构化样式 → 逐属性 + 几何边界距离比 |
| 速度 | 慢：每轮截图 + 大图推理 | 快：抽取是确定性程序，diff 毫秒级 |
| 成本 | 高：图像 token 贵 | 低：零图像 token，只把裁剪后的 top-risk 文本喂 AI |
| 精度 | 模糊："这里偏了点" | 精确到属性数值："padding 设计 24 / 实现 20 / 差 -4" |
| 可量化 | 难：看图打分主观、会漂移 | 确定性基线分（属性匹配率 / 几何 MAE）可复现 + AI 语义分 |
| AI 介入 | 全程看图判断 | 只在需判断处（配对消歧 / 严重度 / 修复），测量全是固定代码 |
| 多层 padding 累加 | 看不出来源 | 几何边界距离自然消化（DOM 的 20+4 与 Figma 的 24 测出同样视觉间距） |
| 修复 | 给不出精确可执行结论 | 定位到具体属性/几何 + 数值差，可一条条改、改完重测确认收敛 |
| 自校准 | 无 | gold set + eval 自迭代，把 AI 反复的判断沉淀成确定性容差 |
| 弱项 | 慢、贵、结论模糊 | 渐变/图片/canvas 等弱覆盖区需截图兜底；依赖结构化抽取覆盖度 |

截图对比让 AI「看图说偏了点」；Verity 让 AI「比数据说差了几 px」——更快、更省 token、精确到属性、可量化、能定位修复并自校准。

## 架构

固定代码负责测量，AI 负责判断。详见 [docs/design.md](docs/design.md)。

| 包 | 角色 |
|---|---|
| `@solvir/verity-core` | 固定代码：schema / adapters / 多信号配对 / 纯客观 diff / 报告。零 AI、零 IO |
| `@solvir/verity-capture` | 浏览器 DOM 抽取脚本（Playwright / Chrome DevTools MCP 注入） |
| `@solvir/verity-agent` | 编排完整流程：Figma REST + Playwright 驱动 + `verity` CLI；裁剪 top-risk 喂 judge |
| `@solvir/verity-eval` | gold set + 评测器 + 自迭代（调容差 / 权重 / prompt） |
| `skill/` + `.claude/agents/` | Claude Code 入口：`verity-acceptance` subagent（验收 + 修复 + 自迭代写回），AI judge 走 skill（无需 API key） |

## 核心设计

- 真值源：Figma REST API（MCP 辅助），实现端 `getComputedStyle`
- 间距走几何边界距离（Prism redline 式 box-to-box），消化多层 padding 累加
- 全量抽取，喂 AI 前由固定代码裁剪聚合
- diff 纯客观（design / actual / delta），评分 = 确定性基线分 + AI 语义分
- 图片 / SVG / canvas / 渐变等弱覆盖区用局部截图兜底

## 开发

```bash
pnpm install
pnpm -r build
pnpm -r test
```

## 用法（端到端 CLI）

一次性准备：

```bash
pnpm install && pnpm -r build
pnpm --filter @solvir/verity-agent exec playwright install chromium   # 装无头浏览器
echo 'FIGMA_TOKEN=figd_xxx' > .env                                    # Figma 令牌（Security 页生成，需 file_content:read）
```

跑一次验收（拿仓库自带的 Switch 样例对社区设计稿）：

```bash
node packages/agent/dist/cli.js \
  --figma-file ApDX0UOArDb7rxRJPmKjnY \
  --node 309:1578 \
  --url "file://$PWD/examples/switch.html" \
  --selector "#sw" \
  --out .verity/report.html
# 输出：配对 2 | 未配对 0 | 属性匹配率 42.9% | 几何 MAE 0.00px
#       报告：.../.verity/report.html
```

参数：`--figma-file` Figma fileKey；`--node` 节点 id（`309:1578` 或 `309-1578`）；`--url` 实现页面（http(s) 或 file://）；`--selector` 对应组件根元素的 CSS 选择器（缺省 body）；`--viewport WxH`（缺省 1440x900）；`--out` 报告路径。

换成你自己的稿子：从 Figma 选中组件 → 右键 Copy link，取 `node-id`；`--url` 指向你的实现页（本地 dev server 或线上）。

## 状态

**端到端可用**（110 测试，全包 build + typecheck 通过）。`verity` CLI 一条命令跑确定性测量：真实 Figma REST 拉设计 → adapter → 折叠 wrapper → 多信号配对 → 纯客观 diff → Playwright 抓真实页面 → adapter → HTML 报告 + `--judge-out` 裁剪 JSON。AI judge 走 Claude Code skill：读裁剪 JSON、按场景打还原度分 + 列问题、按需改代码重跑（无需 API key）。

确定性测量链路：

- `verity-core`：颜色 ΔE（CIEDE2000）、几何原语、多信号配对、`foldWrappers`（折叠几何重合的 COMPONENT 壳）、样式族 / 几何族 diff、基线指标、HTML 报告。两端 adapter `figmaToStyleTree`（真实 shadcn REST fixture 验证）+ `domToStyleTree`（getComputedStyle 解析）。`computeDiff` 独立产出纯数值报告（边界契约）。
- `verity-capture`：`captureDom` 浏览器内遍历（jsdom 单测 + 真实 Chrome 验证）+ 可注入 IIFE。
- `verity-agent`：`run` 编排 + 真实驱动 `FigmaRestSource` / `PlaywrightCapturer` / `HtmlReporter` + `cropForJudge`（裁 top-risk 喂 judge）+ `verity` CLI。
- `verity-eval`：`evaluate`（TP/FP/FN/F1 + 分偏差）+ `selfIterate` 收敛循环 + 合成 gold set（4 样本）+ `runSample`/`tuneOnGold`。已实跑：自迭代发现"圆角完全等价"规则把 meanF1 从 0.35 拉到 1.0，规则沉淀进 `run()` 默认。
- `skill/` + `.claude/agents/`：`verity-acceptance` subagent（验收 + 修复一体）走可执行 runbook（跑 CLI → 读裁剪 JSON → judge.md 打分 → fix.md 修复）；真实验收时按 self-iterate.md 把可泛化判断写回项目（gold 样本 + tolerance/judge.md，eval 验证后沉淀，记 LEARNINGS.md）。

**待补**：扩 gold set（真实人工标注对 + 更多组件/场景）、judge prompt 的人在环细调（用 `evaluate` 量化吻合度）、配对权重的搜索空间扩展。

设计见 [docs/design.md](docs/design.md)（15 节设计 + codex 审查纳入）。
