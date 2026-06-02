# style-fidelity 设计方案（草案）

> 状态：草案 / 讨论中。本文件随讨论持续更新，未定稿。
> 最后更新：2026-05-29

## 1. 一句话定义

一个用结构化样式数据做"设计还原度验收"的开源工具：把 Figma 设计真值和前端实现都抽成统一的结构化样式 JSON，逐属性 diff，用 LLM 只在需要判断的地方介入（消歧 / 判严重度 / 修复），取代慢而贵的截图视觉对比。

## 2. 背景与痛点

现有的设计还原验收（含本地已装的 `visual-validation` skill + `ui-acceptance` subagent）主要靠截图视觉对比，三个硬伤：

- 慢：每轮要截图 + 把大图喂给 LLM。
- 贵：图像 token 成本高。
- 模糊：LLM 看图只能说"这里偏了点"，给不出"padding 设计 16px、实际 12px"这种精确到属性的结论。

## 3. 核心思路

把两端都转成结构化样式数据，让 LLM 直接比数据：

- 快：抽取是确定性程序，零图像 token。
- 精确：能定位到具体属性和数值差。
- 可量化：能算还原度分数。

灵感来源：Prism - Redline Tool 浏览器插件用 `getComputedStyle` 逐元素抽取页面样式。我们把"实现端抽取器"直接复用这套思路，"真值端"改用 Figma 官方 API 拿设计原文。

## 4. 已确定的三个核心决策

1. 比对方法：结构化样式 diff（LLM 比数据，截图退为辅助证据）。
2. 真值来源：Figma 走官方 API（Figma MCP：get_design_context / get_variable_defs / get_metadata）抽节点的尺寸/颜色/字体/间距/设计 token；实现端走 `getComputedStyle`。两端都不靠截图。
3. 元素配对：几何打底 + LLM 兜底。viewport 对齐 Figma frame 后，用 bbox 重叠度（IoU）+ 文本内容匹配自动配对大多数元素；只有低置信度 / 歧义的少数交给 LLM。无需在代码里埋点，任意手写代码可跑。

## 5. 固定代码 vs AI 的边界（项目最核心的划分）

原则：固定代码负责"测量"，AI 负责"判断和动手"。测量必须确定、可复现、零 token；只有需要语义理解或模糊判断处才花 AI。

| Pipeline 阶段 | 归属 | 理由 |
|---|---|---|
| Figma adapter（API JSON 转统一 schema） | 固定代码 | 纯数据转换 |
| DOM adapter（getComputedStyle 抽取转统一 schema） | 固定代码 | 确定性抽取，即 Prism 那段 JS |
| 几何配对（viewport 归一化 + IoU + 文本匹配） | 固定代码 | 纯几何 / 字符串计算 |
| 属性级 diff（数值差、颜色 ΔE） | 固定代码 | 纯数值比较 |
| HTML 报告渲染 | 固定代码 | 模板 |
| 低置信度配对消歧（一节点对多层 div） | AI | 结构不一致需语义判断 |
| 差异严重度判定 / 还原度打分 | AI | 需要审美 / 语境判断 |
| 修复（改 Tailwind / 组件代码） | AI | 需要理解代码上下文 |

边界契约：固定代码自己就能跑出一份"纯数值还原度报告"（多少元素配上、各属性偏差多少）。AI 只在它之上做三件做不到的事：消歧、判严重度、改代码。

### 5.1 抽取全量 / 判断让 AI 选（已定 2026-05-29）

属性的"抽"和"选"分两层：

- 抽取阶段：固定代码全量抽一个尽量宽的属性集合，diff 也全量计算。抽取确定、可缓存、零 token、很便宜，没有让 AI 介入的必要。
- 判断阶段：AI 按场景动态决定"关注哪些属性、容差多少、怎么加权打分"。验收按钮重点看 padding/圆角/字色，验收营销图权重又不同。

好处：schema 不纠结"属性集够不够"，漏报风险从"没抽到"转为"AI 没关注"，后者每次能按场景重新判断。AI 反复判定为可忽略的规则（如 ΔE<2 视为等价）可逐步沉淀进 tolerance.ts，把高频判断固化成确定性代码，长期省 token。

### 5.2 diff 输出纯客观差异 + AI 评分（已定 2026-05-29）

diff（固定代码）只做测量和相减：对每个配对元素逐属性给出 `{ design, actual, delta }`（颜色给 `deltaE`），陈述"设计值/实现值/差多少"的事实，不掺"算不算问题"的判断。这样 diff 层完全确定、可单测、零 token。

示例：

```json
{
  "nodeId": "btn-primary",
  "attributes": {
    "paddingLeft":     { "design": 24, "actual": 20, "delta": -4 },
    "fontSize":        { "design": 16, "actual": 16, "delta": 0 },
    "borderRadius":    { "design": 8,  "actual": 8,  "delta": 0 },
    "color":           { "design": "#FFFFFF", "actual": "#FFFFFF", "deltaE": 0 },
    "backgroundColor": { "design": "#1473E6", "actual": "#1A7BF0", "deltaE": 3.2 }
  }
}
```

要避免的做法：在 diff 里写死"delta > 3px 标红算 fail"。阈值是场景相关的（大标题差 4px 无所谓，图标差 4px 明显），写死会误判。

评分链（不考虑 CI，已砍掉客观指标门禁层）：

```
固定代码 diff（客观差异表）──> AI judge（按场景打还原度分 + 列严重问题清单）──> 报告
```

## 6. 项目结构

```
style-fidelity/
├── packages/
│   ├── core/                    # 固定代码：纯函数库，零 AI、零副作用，可独立 npm 发布 + 单测
│   │   ├── src/
│   │   │   ├── schema.ts        # StyleNode 统一 schema（两端 adapter 的输出契约）
│   │   │   ├── adapters/
│   │   │   │   ├── figma.ts     # Figma API JSON 转 StyleNode[]
│   │   │   │   └── dom.ts       # getComputedStyle 抽取转 StyleNode[]
│   │   │   ├── match/geometry.ts# viewport 归一化 + IoU + 文本匹配，输出 pair + 置信度
│   │   │   ├── diff/attributes.ts # 逐属性数值 diff
│   │   │   ├── diff/tolerance.ts  # 容差规则（颜色 ΔE、亚像素 round，可配）
│   │   │   └── report/html.ts   # diff.json 转 HTML
│   │   └── test/                # 快照 / 单元测试
│   ├── capture/                 # 固定代码：注入浏览器的抽取脚本，独立打包给 CLI + 未来插件复用
│   │   └── src/capture.js       # window.__STYLE_CAPTURE__()
│   └── cli/                     # 固定代码：串成 headless CLI（方案 C 种子，无 AI 也能出数值报告）
│       └── src/index.ts         # figma node + url 转 抽取 转 配对 转 diff 转 report
├── skill/                       # AI：Claude Code skill，薄编排层
│   ├── SKILL.md                 # 触发条件、怎么调 core/cli、AI 在哪几步介入
│   └── prompts/
│       ├── disambiguate.md      # 配对消歧指令
│       ├── judge.md             # 严重度判定 + 打分指令
│       └── fix.md               # 修复纪律（沿用 ui-acceptance）
├── agents/ui-acceptance.md      # 复用 / 改造现有 subagent
└── README.md
```

core 包不 import 任何 AI/Claude 东西，输入输出全是 JSON。它同时被三种形态 import：CLI、Claude skill、未来插件共用同一套测量内核，区别只在"谁来调它、谁来做判断"。

## 7. 数据流

```
Figma node ──(figma adapter)──┐
                              ├──> StyleNode[] 两份
浏览器渲染 ──(dom adapter)─────┘
                              │
                    (geometry match) ──> pairs + 低置信度清单
                              │                    │
                              │              (AI 消歧) 补齐 pairs
                              │
                    (attribute diff) ──> diff.json（纯数值）
                              │
                    (AI judge) ──> 严重度标注 + 还原度分
                              │
                    (AI fix，可选) ──> 改组件代码 ──> 重新抽取迭代
                              │
                    (html report) ──> 报告 + 分数
```

## 8. 三形态演进

- 形态 A：扩展现有 visual-validation（Claude skill + ui-acceptance）。落地最快，含自动修复。优先做。
- 形态 C：core + cli 进 CI，做视觉还原回归。当前暂缓（不考虑 CI），core 抽好后即得，需要时再加客观指标门禁。
- 形态 B：独立 Chrome 插件（Prism 进化版）。复用 capture 包，后期做。

## 9. 待讨论清单（open questions）

- [x] 属性集策略（已定 2026-05-29）：见 5.1，core 全量抽宽集合 + 全量 diff，关注/容差/权重交给 AI 在 judge 阶段动态选。
- [ ] StyleNode schema 字段表定稿：宽集合具体列哪些、怎么分组；Figma 与 CSS 映射（auto-layout 对 flex、fills 解析、weight 归一化、letterSpacing 单位），需拿真实 node 跑 Figma MCP 实测对齐。
- [ ] 几何配对算法细节：IoU 阈值、文本匹配权重、置信度公式、一对多 / 多对一怎么处理。
- [ ] 容差规则：颜色用 ΔE 多少算等价、字号 / 间距允许几 px、哪些属性零容差。
- [ ] 还原度评分公式：加权方式、是否分模块打分、PASS 阈值。
- [ ] 修复要不要做成确定性 codemod（减少 AI 依赖），还是全交给 AI。
- [ ] Figma 真值获取细节：嵌套帧、组件实例、变体、绝对坐标系换算。
- [ ] 技术栈与工程：TS 版本、构建工具、monorepo 工具（pnpm workspace）、测试框架。
- [ ] 项目名是否沿用 style-fidelity。

## 10. codex 审查发现与修订（2026-05-29）

codex 总判断：方向成立，病根是把"结构化抽取"当成了万能且确定的真值，低估三处现实摩擦——真值源不规整、结构化覆盖不全、规模会失控。

### 10.1 已采纳的修订

- 真值源：Figma 主真值改用 REST API file nodes（/v1/files/:key/nodes，需 personal access token）；MCP（get_design_context 偏 React/Tailwind 表示、get_metadata 稀疏）降为辅助。需做字段能力表 + fixture（Frame / Instance / Text / Vector / ImageFill / Variant / AutoLayout / Grid / Variable mode）。
- 截图定位：结构化为主路径；图像 / SVG / canvas / 渐变 / mask / blend / 字体抗锯齿列为"结构化弱覆盖区"，用局部截图 + asset hash 兜底。截图退为校准证据。
- getComputedStyle 边界：补伪元素单独采集（pseudo）、document.fonts.ready 后再抽、记录实际加载字体；canvas / 字体回退归入弱覆盖区。
- 配对升级为多信号：几何 IoU + 层级 + 文本 + ARIA role/name + 组件名 + DOM path；默认零埋点、可选 data-style-id 提准；配对模型支持一对多 / 多对一 / composite 组合节点（Figma 树 ≠ DOM 树，一个 Figma 按钮可能是 frame+text+icon，DOM 是 button>span+svg）。
- 坐标系规范：定义 root frame 原点、scale、scroll 快照、DPR、transform 矩阵、裁剪边界；absoluteBoundingBox（页面绝对坐标）到 viewport 坐标的换算要显式写，用截图锚点校准。
- 喂 AI 裁剪（对 5.1 的细化）：抽取仍全量落盘（确定、可复用），喂给 AI 的是固定代码聚合裁剪后的 top-risk diff + 低置信 pair，不把全量原始 CSS 进 prompt，防 token / 噪声膨胀。
- 验收输入定义为 scenario matrix：viewport / theme(暗色) / state(hover/focus/disabled) / route / mock data / scroll position。初期限定单 scenario，schema 与 CLI 预留多 scenario。
- 动态内容 / 虚拟列表 / 滚动：支持滚动脚本、区域分片、可见 vs 全量模式，scrollbar 纳入 schema。
- 报告按可修复对象聚合：组件级 + 严重度 + 截图定位 + 字段来源 + 修复入口，避免变成 diff 噪声列表。
- 隐私与成本：redaction / local-only 模式 / prompt 最小化 / 缓存 / MCP 速率预算。
- 运行契约待补：CLI 输入格式、认证、缓存、JSON schema、错误码、报告格式、浏览器矩阵（Playwright）。
- 表述勘误：第 4 节"两端都不靠截图""无需埋点任意代码可跑"以本节更克制的版本为准。

### 10.2 待拍板（与已定决策有张力）

- A 喂 AI 裁剪 vs 全量：倾向采纳裁剪（用户同意的是"全量抽"，未涉及"全量喂"）。
- B 评分可复现性：当前定为 AI 全包评分。codex 指出纯 AI 分不可复现、会漂移（同一 diff 今天 82 明天 76）。建议折中：固定代码出确定性基线分（属性匹配率，纯算术、可复现），AI 在其上做语义严重度 + 解释 + 修复建议，并记录 model / prompt / 输入摘要。A、B 已于 2026-05-29 确认采纳。

## 11. 累积 / 分散样式：间距走几何边界距离（已定 2026-05-29）

问题：实现端的视觉效果常由多层嵌套各自贡献样式累加而成，Figma 端结构更扁。典型：card padding 20px + 内容组件 padding 4px = 视觉 24px，而 Figma 直接画 24px 一层。逐元素逐属性比 padding 会误报"card 差 4px"，评分失真。这是逐属性比对的系统性硬伤。

解法：间距 / 位置类属性改用几何边界距离模型（即 Prism redline 测 box-to-box 距离的思路），不读单节点声明的 padding / margin。

- 实现端：用 getBoundingClientRect 的实际盒子边界算"语义距离"（内容块边到容器边、相邻兄弟间隙、图标到文字）。多层累加被实际渲染几何自然消化——20+4、24+0、24 测出的视觉间距都是 24。
- Figma 端：用对应两节点的 absoluteBoundingBox 同样算边界距离，也是 24。
- 两端比派生的几何距离，中间层的 4px padding 来自谁不进入比对。

属性分两族 diff：

- 几何族（间距 / 位置 / 尺寸）：比配对节点对之间的边界距离。
- 样式族（颜色 / 字体 / 圆角 / 阴影 / 边框 / 背景）：比单节点 computed 值。

前提：配对要把纯布局 wrapper 层折叠 / 穿透，对齐"视觉块"而非 DOM 层级（呼应 10.1 composite 组合节点）。配对正确则累加问题被几何法消化；配对错则仍会误判。配对（多信号 + composite）与几何间距模型绑定，共同构成工具技术核心。

## 12. 自迭代评测框架（已定 2026-05-29）

schema 字段集、评分权重、容差、judge prompt 这类靠经验调优的东西，不一次性人工定稿，改为评测驱动自迭代：

- gold set：一批标注样本（Figma node + 实现快照 + 人工还原度结论 / 严重问题清单）。
- 评测器：跑工具出分 + 问题清单，与 gold 比，算与人工判断的吻合度、漏报 / 误报率。
- 自迭代闭环：AI 读评测结果，调整字段集 / 权重 / 容差 / judge prompt，重跑，收敛。
- 产物：沉淀出 skill 的 prompt 与 config（judge.md、tolerance 配置、字段清单）。

影响：第 9 节的"schema 字段定稿""评分公式"从人工待定，转为由本框架迭代产出初版再人工把关。

## 13. 技术栈与工程（已定 2026-05-29）

两层 Node，monorepo（pnpm workspace）：

固定代码层
- @PKG/core：TS 纯库，抽取 / 配对 / diff / 报告；构建 tsup，测试 vitest；颜色 ΔE 用 culori，几何自写；零 AI、零 IO。
- @PKG/capture：注入浏览器的 DOM 抽取脚本，打成 IIFE，被 Playwright 与 Claude Code MCP 两种 driver 复用。

AI 框架层（负责完整流程）
- @PKG/agent：TS 编排，依赖 core，用 Claude Agent SDK 调 AI（消歧 / judge / fix），Playwright 跑 headless DOM 抽取 + 截图；串完整流程 + 自迭代评测。
- @PKG/eval：gold set + 评测器 + 自迭代循环。

入口
- skill/：Claude Code skill 薄入口（手动触发，复用 ui-acceptance subagent）。

浏览器自动化：独立框架用 Playwright；在 Claude Code 内用 chrome-devtools MCP。capture 包让两条路共用同一抽取逻辑。

## 14. 修复策略：codemod vs AI（建议）

codemod = 用程序对源码做结构化自动改写（jscodeshift / AST 变换 / Tailwind class 替换）。

- 简单数值类修复（改 padding / 颜色 / 字号 / 圆角的值、换 Tailwind class）：codemod 化，确定、可批量、可预览 diff、零 token。
- 复杂修复（布局结构错、要拆 / 重组组件、跨文件）：交给 AI。

建议：先做 AI 修复跑通闭环，把高频简单修复逐步固化成 codemod（呼应 5.1 "AI 判断沉淀为确定性代码"）。

## 15. 项目名（已定 2026-06-02）

定为 verity（"真实 / 真相"，读感优雅，对应"实现是否忠实于设计真值"）。

npm scope：用用户自有组织 @solvir（无需新注册）。项目名 / CLI / 项目目录用 verity。

占用核查（2026-06-02）：unscoped verity 已被占（0.8.2），故走 scope。GitHub 同名 repo 属其他领域（Android dm-verity、Evernym Verity SDK、形式化验证），自有 namespace 不冲突。

包名：@solvir/verity-core、@solvir/verity-capture、@solvir/verity-agent、@solvir/verity-eval。CLI：verity。第 13 节 @PKG/x 占位即 @solvir/verity-x。原工作名 style-fidelity 作废，项目目录将于建骨架时重命名为 verity。备选保留：fidelis、figdiff、parity。
```
