import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeIllustrationPlanItems } from "../../src/lib/illustration";

test("illustration plans can stay dynamic when no maximum is supplied", () => {
  const plan = Array.from({ length: 5 }, (_, index) => ({
    anchor: `唯一锚点段落 ${index}，用于解释一个不同的关键机制。`,
    caption: `图示 ${index}`,
    prompt: `Academic textbook diagram ${index}`,
  }));
  assert.equal(normalizeIllustrationPlanItems(plan).length, 5);
});

test("illustration plans still honor an explicit operational ceiling", () => {
  const plan = Array.from({ length: 5 }, (_, index) => ({
    anchor: `唯一锚点段落 ${index}，用于解释一个不同的关键机制。`,
    caption: `图示 ${index}`,
    prompt: `Academic textbook diagram ${index}`,
  }));
  assert.equal(normalizeIllustrationPlanItems(plan, 2).length, 2);
});
