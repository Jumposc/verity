# 自迭代写回协议（真实验收 → 沉淀回项目）

真实验收时，你（judge）会反复做某些判断。当一个判断是**可泛化的规则**而非一次性的，按本协议把它写回项目，让工具下次自己就准——这是 design.md 5.1/12「AI 判断沉淀为确定性容差」的在线版。

**铁律：动代码默认值 / tolerance / judge.md 之前，必须用 eval 验证 meanF1 不回退。无验证不沉淀。**

## 何时触发

- 你反复判定某属性差「视觉等价」（如圆角 999≈9999、某 ΔE 阈值下的颜色）→ 该沉淀成确定性规则
- 某场景的容差 / 配对权重明显不合理 → 调 config 并验证
- matcher 把视觉块配错 → 记录待调权重 / fold 规则
- 不确定是否泛化 → **只记 LEARNINGS.md，不动代码**

## 步骤

### 1. 把真实案例快照成 gold 样本

验收时已用 `--trees-out .verity` 拿到两棵树。促成 gold：

```bash
name=<组件名-场景>            # 如 button-primary、card-hover
mkdir -p packages/eval/gold/$name
cp .verity/figma.tree.json packages/eval/gold/$name/figma.tree.json
cp .verity/dom.tree.json   packages/eval/gold/$name/dom.tree.json
```

写 `packages/eval/gold/$name/expected.json`：你的人工结论——
```json
{ "fidelityScore": <0-100>, "criticalFindings": ["backgroundColor", "content-left", ...] }
```
`criticalFindings` 用**规范属性 / 几何关系名**（`backgroundColor`、`borderRadius`、`content-left`…），与工具 findings 同词根，eval 才能子串匹配。

### 2. 判断规则类型

- **等价 / 钳制类**（像圆角）：需要节点尺寸 → 加在 `diff/attributes.ts`（仿 `clampRoundedRadius`，opt-in），并在 eval 的 `TuneConfig` + `CANDIDATES` 里加这个旋钮。
- **纯数值容差**（颜色 ΔE / px）：调 `cropForJudge` 的 `colorDeltaE`/`pixel`，或 `DEFAULT_TOLERANCE`。
- **配对权重 / fold**：调 `matchTrees` 权重或 `foldWrappers` 阈值。
- **纯语义、无法确定性化**：只改 `skill/prompts/judge.md` 的经验规则，不进代码。

### 3. 用 eval 验证（必须）

把新旋钮加入候选后，实跑：

```bash
node -e "import('./packages/eval/dist/index.js').then(async m=>{const r=await m.tuneOnGold('packages/eval/gold');console.log('best',JSON.stringify(r.bestConfig),'meanF1',r.bestMeanF1);r.history.forEach(h=>console.log(h.iteration,h.meanF1.toFixed(3),JSON.stringify(h.config)))})"
```

要求：新增样本后 `bestMeanF1` 不低于沉淀前；新规则要么提升 meanF1，要么不回退其它样本。回退就别沉淀，退回纯 judge 经验。

### 4. 沉淀

验证通过才改：
- 确定性规则 → 改 core 默认 / `run()` 的 `computeDiff` opts（仿圆角规则：`run.ts` 里 `diff:{clampRoundedRadius:true}`）
- 容差 → `DEFAULT_TOLERANCE` / `cropForJudge` 默认
- 语义 → `judge.md`
重跑全包 `pnpm -r build && pnpm -r test` 确认绿。

### 5. 记日志

往 `LEARNINGS.md` 追加一条：日期、案例、判断、规则类型、eval 证据（meanF1 前后）、沉淀到哪个文件。

## 边界

gold 样本和 LEARNINGS.md 进 git（是项目资产）；`.verity/` 不进。沉淀改的是默认值与 prompt，不破坏「diff 层纯客观」——等价/容差是 tolerance 层的事。
