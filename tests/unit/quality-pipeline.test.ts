import assert from "node:assert/strict";
import { test } from "node:test";
import { preRepairMarkdown } from "../../src/lib/prompts/formatGuard";
import { runChapterQualityPipeline, runChapterQualityPipelineWithRepair } from "../../src/lib/quality/pipeline";
import { Chapter } from "../../src/lib/types";

function chapter(patch: Partial<Chapter> = {}): Chapter {
  return {
    id: "chapter-quality-test",
    title: "Quality Gate",
    description: "Quality test chapter",
    purpose: "Validate generated chapter quality.",
    connectionFromPrevious: "Connects from prior chapter.",
    setupForNext: "Prepares the next chapter.",
    time: {
      readingMinutes: 10,
      exerciseMinutes: 5,
      practiceMinutes: 5,
      extensionMinutes: 5,
    },
    ...patch,
  };
}

test("TQH blocks content missing required chapter structure", () => {
  const report = runChapterQualityPipeline(chapter(), "plain notes without a top-level heading");

  assert.equal(report.status, "failed");
  assert.ok(report.issues.some((issue) => issue.check === "structure.heading"));
});

test("TQH flags malformed markdown math/code format", () => {
  const report = runChapterQualityPipeline(
    chapter(),
    ["# Heading", "concept explanation", "exercise task", "$ orphan", "```js", "console.log(1)"].join("\n"),
  );

  assert.equal(report.status, "failed");
  assert.ok(report.issues.some((issue) => issue.check === "format.lonely_dollar"));
  assert.ok(report.issues.some((issue) => issue.check === "format.code_fence"));
});

test("TQH self-repair can recover deterministic format failures", () => {
  const content = ["# Heading", "概念解释", "练习 task", "```js", "console.log(1)"].join("\n");
  const result = runChapterQualityPipelineWithRepair(chapter(), content, (value) => `${value}\n\`\`\``);

  assert.equal(result.attempts, 1);
  assert.notEqual(result.report.status, "failed");
  assert.ok(result.report.issues.some((issue) => issue.check === "self_repair.attempts"));
});

test("format repair normalizes isolated dollar math blocks", () => {
  const content = ["# Heading", "概念解释", "练习 task", "$", "a = b", "$"].join("\n");
  const repaired = preRepairMarkdown(content);
  const result = runChapterQualityPipeline(chapter(), repaired);

  assert.match(repaired, /\$\$\na = b\n\$\$/);
  assert.notEqual(result.status, "failed");
});
