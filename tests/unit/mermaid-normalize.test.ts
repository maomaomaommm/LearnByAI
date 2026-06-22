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

test("handles arrows with no surrounding spaces", () => {
  assert.equal(normalizeMermaidCode("A→B"), "A --> B");
});

test("maps Unicode arrows to ->> inside a sequenceDiagram", () => {
  const out = normalizeMermaidCode("sequenceDiagram\n  Alice → Bob: Hello");
  assert.match(out, /Alice ->> Bob: Hello/u);
  assert.doesNotMatch(out, /-->/u);
});

test("covers several Unicode arrow glyphs", () => {
  for (const glyph of ["→", "⟶", "⇒", "⇨", "➜", "➡"]) {
    assert.equal(normalizeMermaidCode(`A ${glyph} B`), "A --> B");
  }
});

test("leaves already-valid Mermaid untouched", () => {
  const valid = "flowchart TD\n  A -->|是| B\n  A -.-> C\n  B ==> D";
  assert.equal(normalizeMermaidCode(valid), valid);
});

test("does not collapse distinct edges that merely share a line", () => {
  assert.equal(normalizeMermaidCode("A --> B --> C"), "A --> B --> C");
});

test("is a no-op on empty input", () => {
  assert.equal(normalizeMermaidCode(""), "");
});
