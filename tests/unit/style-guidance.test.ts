import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildStyleGuidance,
  buildTeachingGuidance,
  LEARNING_MODE_GUIDE,
  LEARNING_MODE_STRUCTURE_RULE,
} from "../../src/lib/prompts/styleGuidance";

test("buildStyleGuidance: empty selection falls back to balanced", () => {
  const text = buildStyleGuidance([]);
  assert.match(text, /均衡/);
  assert.doesNotMatch(text, /侧重/);
});

test("buildStyleGuidance: all selected collapses to balanced (no fighting)", () => {
  const text = buildStyleGuidance(["intuition", "example", "rigor", "analogy", "code"]);
  assert.match(text, /均衡/);
  assert.doesNotMatch(text, /侧重/);
});

test("buildStyleGuidance: partial selection emphasizes + allows fusion", () => {
  const text = buildStyleGuidance(["rigor", "analogy"]);
  assert.match(text, /侧重/);
  assert.match(text, /严谨推导/);
  assert.match(text, /类比通俗/);
  // anti-conflict guidance present
  assert.match(text, /融合|优先服务理解/);
});

test("buildStyleGuidance: empty styles but legacy preference uses legacy text", () => {
  const text = buildStyleGuidance([], "直觉结合公式、代码和论文案例");
  assert.match(text, /直觉结合公式、代码和论文案例/);
  assert.doesNotMatch(text, /均衡/);
});

test("buildStyleGuidance: selected styles win over legacy preference", () => {
  const text = buildStyleGuidance(["example"], "should be ignored");
  assert.match(text, /例子说明/);
  assert.doesNotMatch(text, /should be ignored/);
});

test("buildTeachingGuidance: combines style + learning-mode lines", () => {
  const text = buildTeachingGuidance(["intuition"], "project", undefined);
  assert.match(text, /讲解风格/);
  assert.match(text, /直觉优先/);
  assert.equal(text.includes(LEARNING_MODE_GUIDE.project), true, "includes project learning-mode guide");
});

test("learning-mode structure rules differ per mode", () => {
  const modes = ["standard", "project", "exercise", "case"] as const;
  const rules = new Set(modes.map((m) => LEARNING_MODE_STRUCTURE_RULE[m]));
  assert.equal(rules.size, modes.length, "each mode has a distinct structure rule");
});
