# Verity

**English** · [中文](README.zh-CN.md)

Structured **style-fidelity checker** for design-to-code. Verity extracts both the Figma design (source of truth) and the rendered front-end implementation into one unified structured-style representation, then diffs them **per-attribute + by geometric boundary distance**. The AI only steps in where judgment is actually needed (pair disambiguation / severity / fixing). It replaces slow, expensive screenshot-based visual comparison.

## Why: screenshot diff vs. structured-style diff

Existing design-fidelity acceptance — including the common `visual-validation` + `ui-acceptance` screenshot flow in Claude Code — mostly **feeds screenshots to an LLM to eyeball**. Verity takes a different route: **extract both sides into structured style data and let the AI compare data directly.**

| | Screenshot diff (traditional) | Verity (structured-style diff) |
|---|---|---|
| How it compares | Screenshot → whole image to an LLM | Both sides → structured styles → per-attribute + geometric boundary distance |
| Speed | Slow: screenshot + large-image inference each round | Fast: extraction is deterministic, diff is sub-millisecond |
| Cost | High: image tokens are expensive | Low: zero image tokens; only cropped top-risk text goes to the AI |
| Precision | Vague: "this looks a bit off" | Exact numbers: "padding design 24 / actual 20 / Δ−4" |
| Quantifiable | Hard: eyeballed scores are subjective and drift | Reproducible deterministic baseline (attribute match rate / geometry MAE) + AI semantic score |
| Where AI is used | Eyeballing throughout | Only where judgment is needed (disambiguation / severity / fix); all measurement is fixed code |
| Nested padding accumulation | Can't tell the source | Absorbed by geometric boundary distance (DOM's 20+4 and Figma's 24 measure the same visual gap) |
| Fixing | No precise, actionable conclusion | Pinpoints the exact attribute/geometry + numeric delta; fix one at a time, re-measure to confirm convergence |
| Self-calibration | None | gold set + eval self-iteration sediments recurring AI judgments into deterministic tolerances |
| Weak spots | Slow, costly, fuzzy conclusions | Gradients / images / canvas fall back to screenshots; depends on structured-extraction coverage |

Screenshot diff has the AI "look at a picture and say it's off"; Verity has the AI "compare data and say it's off by N px" — faster, cheaper on tokens, precise to the attribute, quantifiable, and able to locate, fix, and self-calibrate.

## Architecture

Fixed code measures; AI judges. See [docs/design.md](docs/design.md).

| Package | Role |
|---|---|
| `@solvir/verity-core` | Fixed code: schema / adapters / multi-signal matching / objective diff / report. Zero AI, zero IO |
| `@solvir/verity-capture` | In-browser DOM extraction script (injected by Playwright / Chrome DevTools MCP) |
| `@solvir/verity-agent` | Orchestration: Figma REST + Playwright drivers + the `verity` CLI; crops top-risk to feed the judge |
| `@solvir/verity-eval` | gold set + evaluator + self-iteration (tunes tolerance / weights / prompt) |
| `skill/` + `.claude/agents/` | Claude Code entry: the `verity-acceptance` subagent (acceptance + fix + self-iteration write-back); the AI judge runs via the skill (no API key needed) |

## Core design

- Source of truth: Figma REST API (MCP as a helper); implementation side via `getComputedStyle`.
- Spacing uses geometric boundary distance (Prism-redline-style box-to-box), absorbing multi-layer padding accumulation.
- Extract everything; fixed code crops/aggregates before anything reaches the AI.
- Diff is purely objective (design / actual / delta); the score = deterministic baseline + AI semantic score.
- Weak-coverage regions (images / SVG / canvas / gradients) fall back to local screenshots.

## Develop

```bash
pnpm install
pnpm -r build
pnpm -r test
```

## Usage (end-to-end CLI)

One-time setup:

```bash
pnpm install && pnpm -r build
pnpm --filter @solvir/verity-agent exec playwright install chromium   # headless browser
echo 'FIGMA_TOKEN=figd_xxx' > .env                                    # Figma token (Settings → Security, needs file_content:read)
```

Run an acceptance pass (the bundled Switch example against the community design file):

```bash
node packages/agent/dist/cli.js \
  --figma-file ApDX0UOArDb7rxRJPmKjnY \
  --node 309:1578 \
  --url "file://$PWD/examples/switch.html" \
  --selector "#sw" \
  --out .verity/report.html
# Output: pairs 2 | unmatched 0 | attribute match rate 100% | geometry MAE 0.00px
#         report: .../.verity/report.html
```

Flags: `--figma-file` Figma fileKey; `--node` node id (`309:1578` or `309-1578`); `--url` implementation page (http(s) or file://); `--selector` CSS selector for the component root (default `body`); `--viewport WxH` (default 1440x900); `--out` report path; `--judge-out` cropped top-risk JSON for the judge; `--trees-out` StyleTree snapshot for gold.

For your own design: in Figma, select the component → Copy link → take the `node-id`; point `--url` at your implementation (local dev server or live).

## Status

**End-to-end working** (121 tests; build + typecheck pass across all packages). The `verity` CLI runs the deterministic measurement in one command: Figma REST → adapter → fold wrappers → multi-signal matching → objective diff → Playwright captures the real page → adapter → HTML report + `--judge-out` cropped JSON. The AI judge runs via the Claude Code skill: read the cropped JSON, score fidelity by scenario, list issues, optionally edit code and re-run (no API key needed).

Deterministic measurement chain:

- `verity-core`: color ΔE (CIEDE2000), geometry primitives, multi-signal matching, `foldWrappers` (collapses geometrically-coincident COMPONENT shells), style-family / geometry-family diff, baseline metrics, HTML report. Both adapters `figmaToStyleTree` (validated against a real shadcn REST fixture) + `domToStyleTree` (getComputedStyle parsing). `computeDiff` produces a pure numeric report standalone (the boundary contract).
- `verity-capture`: `captureDom` in-browser traversal (jsdom unit tests + real Chrome validation) + injectable IIFE.
- `verity-agent`: `run` orchestration + real drivers `FigmaRestSource` / `PlaywrightCapturer` / `HtmlReporter` + `cropForJudge` (crops top-risk for the judge) + the `verity` CLI.
- `verity-eval`: `evaluate` (TP/FP/FN/F1 + score delta) + `selfIterate` convergence loop + a synthetic gold set (4 samples) + `runSample`/`tuneOnGold`. Already run for real: self-iteration discovered the "fully-rounded radius equivalence" rule, lifting meanF1 from 0.35 to 1.0; the rule is sedimented into `run()` defaults.
- `skill/` + `.claude/agents/`: the `verity-acceptance` subagent (acceptance + fix in one) follows an executable runbook (run CLI → read cropped JSON → score via judge.md → fix via fix.md); during real acceptance it writes generalizable judgments back into the project per self-iterate.md (gold samples + tolerance/judge.md, sedimented after eval validation, logged in LEARNINGS.md).

**Next**: grow the gold set (real human-labeled pairs + more components/scenarios), human-in-the-loop tuning of the judge prompt (quantify agreement with `evaluate`), and expand the matcher-weight search space.

See [docs/design.md](docs/design.md) (15-section design + codex review incorporated).

## License

[MIT](LICENSE)
