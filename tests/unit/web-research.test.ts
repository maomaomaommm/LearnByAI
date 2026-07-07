import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { buildCourseResearchPrompt } from "../../src/lib/prompts/courseResearch";

test("course research prompt requires live search and primary sources", () => {
  const prompt = buildCourseResearchPrompt({
    topic: "大模型安全对齐",
    goal: "掌握最新方法",
    background: "了解 Transformer",
  }, new Date("2026-06-16T00:00:00.000Z"));

  assert.match(prompt, /今天是 2026-06-16/u);
  assert.match(prompt, /适合 arXiv/u);
  assert.match(prompt, /英文检索词/u);
  assert.match(prompt, /"query"/u);
});

test("web research uses Kimi for keywords and arXiv for live papers", () => {
  const source = fs.readFileSync(new URL("../../src/lib/webResearch.ts", import.meta.url), "utf8");

  assert.match(source, /agent: "ARCHITECT"/u);
  assert.match(source, /overrides/u);
  assert.match(source, /export\.arxiv\.org\/api\/query/u);
  assert.doesNotMatch(source, /web_search/u);
});
