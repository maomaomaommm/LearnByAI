import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildIllustrationMarkdown,
  insertIllustrationsIntoMarkdown,
  isValidIllustrationPath,
  parseIllustrationPlan,
  resolveIllustrationAnchor,
} from "../../src/lib/illustration";
import { postRepairMarkdown } from "../../src/lib/prompts/formatGuard";

const CHAPTER = [
  "# 第 1 章 强化学习概述",
  "",
  "强化学习研究智能体如何通过与环境交互来学习最优策略。",
  "",
  "## 1.1 基本框架",
  "",
  "在每个时刻，智能体观察状态并选择动作，环境返回奖励和下一个状态。这个循环是强化学习的核心。",
  "",
  "```python",
  "state = env.reset()",
  "```",
  "",
  "## 1.2 价值函数",
  "",
  "价值函数刻画了状态的长期回报。",
].join("\n");

test("parseIllustrationPlan keeps valid entries and caps at maxCount", () => {
  const raw = JSON.stringify({
    illustrations: [
      { anchor: "智能体观察状态并选择动作", caption: "交互循环", prompt: "agent-environment loop" },
      { anchor: "", caption: "空 anchor 应被丢弃", prompt: "x" },
      { anchor: "价值函数刻画了状态的长期回报", caption: "价值函数", prompt: "value function" },
      { anchor: "多余的第三条", caption: "超出上限", prompt: "y" },
    ],
  });
  const items = parseIllustrationPlan(raw, 2);
  assert.equal(items.length, 2);
  assert.equal(items[0].caption, "交互循环");
  assert.equal(items[1].caption, "价值函数");
});

test("parseIllustrationPlan tolerates a fenced JSON reply", () => {
  const raw = '```json\n{"illustrations":[{"anchor":"这个循环是强化学习的核心","caption":"闭环","prompt":"loop"}]}\n```';
  assert.equal(parseIllustrationPlan(raw, 3).length, 1);
});

test("resolveIllustrationAnchor finds the paragraph end after the anchor", () => {
  const resolved = resolveIllustrationAnchor(CHAPTER, "智能体观察状态并选择动作");
  assert.ok("offset" in resolved, JSON.stringify(resolved));
  const offset = (resolved as { offset: number }).offset;
  // Paragraph ends right after 这个循环是强化学习的核心。
  assert.equal(CHAPTER.slice(offset - 3, offset), "核心。");
});

test("resolveIllustrationAnchor rejects missing / duplicated / in-fence anchors", () => {
  assert.deepEqual(resolveIllustrationAnchor(CHAPTER, "这段文字并不存在于章节中"), {
    reason: "anchor not found in chapter",
  });
  const doubled = `${CHAPTER}\n\n价值函数刻画了状态的长期回报。`;
  const dup = resolveIllustrationAnchor(doubled, "价值函数刻画了状态的长期回报");
  assert.ok("reason" in dup && /unique/.test(dup.reason));
  const fenced = "前文。\n\n```python\nstate = env.reset()\n\nreward = env.step()\n```\n\n后文。";
  const inFence = resolveIllustrationAnchor(fenced, "state = env.reset()");
  assert.ok("reason" in inFence, JSON.stringify(inFence));
});

test("insertIllustrationsIntoMarkdown inserts after the anchor paragraph", () => {
  const markdown = buildIllustrationMarkdown("图 1-1", "智能体与环境的交互循环", "/api/illustrations/c/ch/00000000-0000-4000-8000-000000000000.png");
  const result = insertIllustrationsIntoMarkdown(CHAPTER, [
    { anchor: "智能体观察状态并选择动作", markdown },
  ]);
  assert.equal(result.inserted, 1);
  assert.equal(result.skipped.length, 0);
  const lines = result.content.split("\n");
  const captionIndex = lines.findIndex((line) => line.startsWith("*图 1-1"));
  const imageIndex = lines.findIndex((line) => line.startsWith("![图 1-1"));
  const anchorIndex = lines.findIndex((line) => line.includes("这个循环是强化学习的核心"));
  const fenceIndex = lines.findIndex((line) => line.startsWith("```python"));
  assert.ok(anchorIndex < imageIndex && imageIndex < captionIndex && captionIndex < fenceIndex, result.content);
  // The code fence must stay intact.
  assert.match(result.content, /```python\nstate = env\.reset\(\)\n```/u);
});

test("insertIllustrationsIntoMarkdown applies multiple inserts and keeps document order", () => {
  const result = insertIllustrationsIntoMarkdown(CHAPTER, [
    { anchor: "价值函数刻画了状态的长期回报", markdown: "![图 1-2　b](/api/illustrations/x/y/b.png)" },
    { anchor: "智能体观察状态并选择动作", markdown: "![图 1-1　a](/api/illustrations/x/y/a.png)" },
  ]);
  assert.equal(result.inserted, 2);
  const posA = result.content.indexOf("图 1-1　a");
  const posB = result.content.indexOf("图 1-2　b");
  assert.ok(posA !== -1 && posB !== -1 && posA < posB, result.content);
});

test("insertIllustrationsIntoMarkdown reports skips without touching content", () => {
  const result = insertIllustrationsIntoMarkdown(CHAPTER, [
    { anchor: "不存在的锚点文字很多字很多字", markdown: "![x](y)" },
  ]);
  assert.equal(result.inserted, 0);
  assert.equal(result.content, CHAPTER);
  assert.equal(result.skipped.length, 1);
});

test("buildIllustrationMarkdown sanitizes caption characters that break Markdown", () => {
  const markdown = buildIllustrationMarkdown("图 2-1", "贝尔曼[备份]图（示意）", "/api/illustrations/a/b/c.png");
  // ASCII brackets/parens would break ![alt](url) syntax and must be stripped;
  // full-width （） are harmless and stay.
  const alt = markdown.slice(2, markdown.indexOf("]("));
  assert.ok(!/[\[\]()]/u.test(alt), markdown);
  assert.match(markdown, /^!\[图 2-1　贝尔曼 备份 图（示意）\]\(\/api\/illustrations\/a\/b\/c\.png\)/u);
});

test("postRepairMarkdown leaves illustration markdown intact", () => {
  const markdown = buildIllustrationMarkdown("图 1-1", "智能体与环境的交互循环", "/api/illustrations/c/ch/00000000-0000-4000-8000-000000000000.png");
  const { content } = insertIllustrationsIntoMarkdown(CHAPTER, [
    { anchor: "智能体观察状态并选择动作", markdown },
  ]);
  const repaired = postRepairMarkdown(content);
  assert.ok(repaired.includes("![图 1-1"), repaired);
  assert.ok(repaired.includes("*图 1-1"), repaired);
  assert.ok(repaired.includes("/api/illustrations/c/ch/00000000-0000-4000-8000-000000000000.png"), repaired);
});

test("isValidIllustrationPath accepts the canonical shape and rejects traversal", () => {
  assert.equal(
    isValidIllustrationPath("8b9ce3bb-602f-466c-bcd0-fb36cd45096d/ab77ad02-b06d-4748-9efc-8c541ee85234/0f0e0d0c-0b0a-4908-8706-050403020100.png"),
    true,
  );
  assert.equal(isValidIllustrationPath("../../etc/passwd"), false);
  assert.equal(isValidIllustrationPath("a/b/c.png"), false); // filename must be a uuid
  assert.equal(
    isValidIllustrationPath("a/b/0f0e0d0c-0b0a-4908-8706-050403020100.svg"),
    false, // svg can script; only raster formats are served
  );
});
