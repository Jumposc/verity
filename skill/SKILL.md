---
name: verity
description: 【还原度验收】用结构化样式数据验收设计还原度——Figma 设计真值 vs 前端实现，逐属性 + 几何边界距离 diff，得出"padding 设计 24／实际 20／Δ−4"这类精确数值，AI 只判定需要判断的部分（配对消歧／严重度／修复）。当用户说"还原度验收 / 跑 verity / verity 验收 / 按数值对设计稿 / 还原度评估"时使用。⚠️ 本 skill 走结构化样式 diff（数值化、低 token、精确到属性），区别于 visual-validation 的截图像素比对——要"对到 N px"而非"大概看看"的设计稿验收都走 verity。
---

# Verity Skill（Claude Code 入口）

确定性测量由 `verity` CLI 做（Figma REST + Playwright → 配对 → 纯客观 diff）。其上是**两段式 AI**：judge 做**初筛分类**（读裁剪 JSON → 过滤噪声 + 标 scope/状态/业务路径 + 初分），主 agent 做**终判**（剔组件库内部、复现多状态、结合业务定 severity 与修不修）。judge 不替主 agent 拍板。无需 ANTHROPIC_API_KEY。

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

### 3. AI judge 初筛（你来做）

`Read` `.verity/judge-input.json`（裁剪后的 top-risk：超容差属性差 + 几何差 + baseline），按 [prompts/judge.md](prompts/judge.md) 做**初筛 + 分类**（不是终判）：

- 过滤容差内噪声（ΔE<2、容差内间距）
- 每条 finding 标 `scope`（page-own / component-internal）、`suspectState`、`businessPath`（**查代码定位**：figma 节点名 / 文案 grep 命中的组件 + locale + 路由，严禁凭节点名臆测）
- 给 `severityHint` + `fidelityScore` 初分

产出的是**分类好的客观差距清单**，交下一步终判，先别报给用户。

### 4. 主 agent 终判 + 多状态复现

⚠️ **终判第一步是查代码，不是看图猜。** 每条 finding 先在代码库定位它的渲染处——用 figma 节点名 / 文案去 grep 命中的组件 + locale + className，落到真实「路由 › 组件 › 字段」。代码是判断的第一来源，据此同时定两件事：
1. **业务路径**：从命中的组件 / 文案 / 路由写出，figma 节点名只是 grep 线索，**不许凭它臆测**。
2. **真伪与归类**：对照实现真相判断它是真 bug，还是配置项差异 / 系统字体栈 / 组件库默认 / 几何缩放残差等噪声，并定 `scope`（page-own / component-internal）。代码里能看出"本就如此"的（链接本应蓝、helper 本就 `text-xs`、组件库默认值），直接判噪声 / 预期 / 组件库。

代码定位不到再退 chrome-devtools 目视。然后按 `scope` / `suspectState` 分流：

**A. `page-own` + `suspectState=false` → 页面待修清单**
直接收下。⚠️ **强制：每条必须业务路径化**——用步骤 4 的代码定位结果写成 `路由/页面 › 组件/卡片 › 字段（真实文案）` 的业务面包屑，附 design/actual/fixHint + **代码定位**（`文件:行` / className / locale key）。figma 节点 id 只能放在括注里作溯源，**不得当作定位主体**。
> 设置页 › 卡片区块 › 折叠面板标题 — 与内容间距 figma 16px / 当前 4px（figma 123:45）

**硬性门槛**：待修清单里只要有一条只甩 figma 节点 id（`[123:45]`）或抽象快照代号（如 `--out` 的快照名）而没有代码落地的业务路径，这份验收即**不合格**——补全前禁止报给用户。定不出归属时：先查代码（grep 文案 / 组件 / className），再退 chrome-devtools 打开页面定位，都定不了才标「待人工确认归属」，不要省略。

**B. `component-internal` → 组件库问题（只暴露不强制修）**
单独成栏（"需动组件库本体 / 全局样式覆盖"），不计入页面待修。除非用户明确要改组件库。

**C. `suspectState=true` → 多状态复现循环（可能跑多次）**
单次快照只代表一个状态，状态错位会误报。对这类 finding：
1. 识别状态维度（设计稿 variant 或业务：tab 切换 / 开关 / 选中 / 禁用…）。
2. 逐个相关状态：用 chrome-devtools 把页面操作到该状态（点 tab / 切开关 / 选中）→ **回到步骤 1 重跑 verity**，`--node` 指向该状态对应的 figma variant 节点 → 收集该状态 diff。
3. **同状态比同状态**：实现 active 比设计 active variant、default 比 default。状态对齐后仍有差才是真 bug；只是状态不同 → 不报。
4. 各状态分别评判，几个状态跑几轮。

终判后报给用户：页面待修清单（**业务路径化——强制，见步骤 4A 硬性门槛，不合格则重做后再报**）+ 组件库问题栏 + 多状态复现结论 + 校准后的还原度分。

### 5. 修复（可选）

用户要修复时，按 [prompts/fix.md](prompts/fix.md)，**只修 `page-own` 项**（`component-internal` 单独评估是否动组件库）：一次改一条（critical 优先）→ 重跑步骤 1 → 确认对应 delta 收敛 → 下一条。

## AI 介入点 → prompt

| 步骤 | prompt | 输入 |
|---|---|---|
| 配对消歧 | `prompts/disambiguate.md` | `judge-input.json` 的 `ambiguousPairs` |
| 差距初筛 + 分类 | `prompts/judge.md` | `judge-input.json`（裁剪后的 top-risk diff + scenario） |
| 主 agent 终判 + 多状态复现 | 本 SKILL「步骤 4」 | judge 初筛清单（scope / suspectState / businessPath） |
| 修复 | `prompts/fix.md` | 终判后的 page-own findings |
| 自迭代写回 | `prompts/self-iterate.md` | 可泛化判断 → gold + tolerance/judge.md（eval 验证后沉淀） |

## 与独立运行的差异

- 浏览器自动化：独立 CLI 走 Playwright（本 skill 即用它）；纯交互排查也可用 chrome-devtools MCP
- 两条路共用 `@solvir/verity-capture` 的 `captureDom` + `CAPTURE_PROPS`

## 状态

端到端可用：`verity` CLI 出确定性报告 + `--judge-out` 裁剪 JSON；AI judge 走本 skill（读裁剪 JSON → judge.md 打分 → fix.md 修复）。
已知精修点：matcher 已折叠重合 wrapper；tolerance 待处理"超完全圆角阈值的 radius 等价"。gold set + eval 自迭代待补。
