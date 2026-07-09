import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareMarkdownForRender } from "../../src/lib/renderMarkdown";

test("prepareMarkdownForRender hides escaped-newline figure placeholders", () => {
  const input = String.raw`before

:::learnbyai-figure\ncaption: 两状态天气马尔可夫链\nprompt: draw a simple transition diagram\ndiagramSpec: sunny -> rainy\ntextLabelsAllowed: true :::

after`;
  const output = prepareMarkdownForRender(input);
  assert.doesNotMatch(output, /learnbyai-figure/u);
  assert.match(output, /图示尚未生成：两状态天气马尔可夫链/u);
  assert.match(output, /before/u);
  assert.match(output, /after/u);
});

test("prepareMarkdownForRender hides normal unresolved figure placeholders", () => {
  const input = [
    ":::learnbyai-figure",
    "caption: 策略迭代循环",
    "prompt: draw the loop",
    ":::",
  ].join("\n");
  const output = prepareMarkdownForRender(input);
  assert.equal(output, "> 图示尚未生成：策略迭代循环。请稍后重试本章生成。");
});
