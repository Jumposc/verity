# Verity 验收经验日志

真实验收中沉淀的、可泛化的判断规则。写回协议见 [skill/prompts/self-iterate.md](skill/prompts/self-iterate.md)。
每条：日期 / 案例 / 判断 / 规则类型 / eval 证据 / 沉淀位置。

由 `verity-acceptance` subagent 在验收时追加；动代码默认前必须用 `tuneOnGold` 验证 meanF1 不回退。

---

## 2026-06-02 · 圆角完全等价

- **案例**：shadcn Switch（node 309:1578）vs 实现。设计 `borderRadius 999`、实现 `9999`，diff 报 8 个 `borderRadius.* Δ9000`。
- **判断**：二者都远超元素短边一半（16 高 → 阈值 8），渲染都是完全药丸/圆形，**视觉等价**，非真实偏差。
- **规则类型**：等价/钳制（需节点尺寸）。
- **沉淀**：`diff/attributes.ts` 加 opt `clampRoundedRadius`（radius 钳到 `min(w,h)/2` 再比）；`run()` 默认开启。
- **eval 证据**：合成 gold（4 样本）`tuneOnGold` —— 关规则 meanF1 0.35、scoreMAE 40.8；开规则 meanF1 1.0、scoreMAE 14.5。faithful 样本的 4 个假阳性消失，wrong-radius(4px) 仍正确报出。
- **影响**：CLI 对 faithful Switch 从「8 个假阳性」变为「100% 匹配、零 finding」。
