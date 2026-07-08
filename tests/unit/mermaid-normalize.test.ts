import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeMermaidCode } from "../../src/lib/mermaid";

test("converts the U+27F6 long arrow (the reported bug) to a flowchart edge", () => {
  const input = "graph TD\n  A[多智能体系统] ⟶ B[分布式感知与行动]\n  A ⟶ C[异构性]";
  const out = normalizeMermaidCode(input);
  assert.match(out, /A\[多智能体系统\] --> B\[分布式感知与行动\]/u);
  assert.match(out, /A --> C\[异构性\]/u);
  assert.doesNotMatch(out, /⟶/u);
});

test("injects a default flowchart header when the diagram type is missing", () => {
  // The second reported case: quoted labels + <br>, but no `flowchart TD` first
  // line, so Mermaid failed to parse the whole diagram.
  const input = 'A["多智能体系统关键性质"] ⟶ B["分布式感知与行动<br>局部观测"]\nA ⟶ C["异构性"]';
  const out = normalizeMermaidCode(input);
  assert.match(out, /^flowchart TD\n/u);
  assert.match(out, /A\["多智能体系统关键性质"\] --> B\["分布式感知与行动<br>局部观测"\]/u);
  assert.doesNotMatch(out, /⟶/u);
});

test("does not inject a header when one already exists", () => {
  const out = normalizeMermaidCode("graph LR\n  A --> B");
  assert.match(out, /^graph LR\n/u);
  assert.doesNotMatch(out, /flowchart TD/u);
});

test("treats a %%{init}%% directive before the type as a valid header", () => {
  const input = '%%{init: {"theme":"dark"}}%%\nflowchart TD\n  A --> B';
  const out = normalizeMermaidCode(input);
  assert.equal((out.match(/flowchart TD/gu) ?? []).length, 1);
});

test("adds a header and converts arrows with no surrounding spaces", () => {
  const out = normalizeMermaidCode("A→B");
  assert.match(out, /^flowchart TD\n/u);
  assert.match(out, /A --> B/u);
});

test("maps Unicode arrows to ->> inside a sequenceDiagram", () => {
  const out = normalizeMermaidCode("sequenceDiagram\n  Alice → Bob: Hello");
  assert.match(out, /Alice ->> Bob: Hello/u);
  assert.doesNotMatch(out, /-->/u);
});

test("covers several Unicode arrow glyphs", () => {
  for (const glyph of ["→", "⟶", "⇒", "⇨", "➜", "➡"]) {
    assert.match(normalizeMermaidCode(`graph TD\nA ${glyph} B`), /A --> B/u);
  }
});

test("leaves already-valid Mermaid untouched", () => {
  const valid = "flowchart TD\n  A -->|是| B\n  A -.-> C\n  B ==> D";
  assert.equal(normalizeMermaidCode(valid), valid);
});

test("does not collapse distinct edges that merely share a line", () => {
  assert.match(normalizeMermaidCode("graph TD\nA --> B --> C"), /A --> B --> C/u);
});

test("is a no-op on empty input", () => {
  assert.equal(normalizeMermaidCode(""), "");
});

test("strips LaTeX math left in node labels to readable plain text", () => {
  const out = normalizeMermaidCode(
    'flowchart LR\n  A["预训练策略 $\\pi_{\\text{ref}}$"] --> B["奖励模型 $r_{\\phi}$"]',
  );
  assert.match(out, /预训练策略 π_ref/u);
  assert.match(out, /奖励模型 r_φ/u);
  assert.doesNotMatch(out, /\$/u);
  assert.doesNotMatch(out, /\\pi|\\text|\\phi/u);
});

test("flattens sub/superscript braces in edge labels", () => {
  const out = normalizeMermaidCode('flowchart LR\n  A -->|"状态 S_{t+1}, 奖励 R_{t+1}"| B');
  assert.match(out, /状态 S_t\+1, 奖励 R_t\+1/u);
  assert.doesNotMatch(out, /\{|\}/u);
});

test("keeps bare underscores in node ids (they are not LaTeX)", () => {
  const out = normalizeMermaidCode("flowchart TD\n  state_1 --> state_2");
  assert.match(out, /state_1 --> state_2/u);
});
