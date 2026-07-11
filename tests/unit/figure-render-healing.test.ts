import assert from "node:assert/strict";
import { test } from "node:test";
import { parseFigurePlaceholders } from "../../src/lib/figures";
import { postRepairMarkdown } from "../../src/lib/prompts/formatGuard";
import { prepareMarkdownForRender } from "../../src/lib/renderMarkdown";

test("recovers a figure payload incorrectly wrapped in a code fence", () => {
  const content = [
    "```text",
    "caption: 专家数据到策略更新",
    "prompt: draw a textbook flowchart",
    "diagramSpec: expert data -> policy",
    "textLabelsAllowed: true",
    "```",
  ].join("\n");

  const blocks = parseFigurePlaceholders(content);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.placeholder.caption, "专家数据到策略更新");

  const rendered = prepareMarkdownForRender(content);
  assert.doesNotMatch(rendered, /prompt:|diagramSpec:|```/u);
  assert.match(rendered, /图示尚未生成：专家数据到策略更新/u);
});

test("hides internal failed-figure markers from the reader", () => {
  const input = [
    "> 图示暂未生成（模型生图）：DQN 目标网络。",
    '<!--learnbyai-figure-failed {"caption":"DQN 目标网络","prompt":"draw"}-->',
  ].join("\n");
  const output = prepareMarkdownForRender(input);
  assert.match(output, /图示暂未生成/u);
  assert.doesNotMatch(output, /learnbyai-figure-failed|caption":"DQN/u);
});

test("unwraps prose with inline math that was accidentally fenced as code", () => {
  const input = ["```text", "若 $s$ 为终止状态，则备份目标为 $r$。", "```"].join("\n");
  const output = postRepairMarkdown(input);
  assert.equal(output, "若 $s$ 为终止状态，则备份目标为 $r$。");
  assert.equal(postRepairMarkdown(output), output);
});
