import assert from "node:assert/strict";
import { test } from "node:test";
import { sanitizeMathDelimiters } from "../../src/lib/sanitizeMath";

test("preserves valid inline math $E=mc^2$", () => {
  assert.equal(sanitizeMathDelimiters("公式 $E=mc^2$ 成立"), "公式 $E=mc^2$ 成立");
});

test("escapes stray $ in Chinese paragraph with period", () => {
  const input = "状态转移函数 $...给出。策略 $";
  const actual = sanitizeMathDelimiters(input);
  // The content between $ is "...给出。策略 " — contains Chinese period → both escaped
  assert.ok(actual.includes("\\$"));
});

test("escapes unpaired $ at end", () => {
  assert.equal(sanitizeMathDelimiters("只有一个 $"), "只有一个 \\$");
});

test("escapes unpaired $ at start", () => {
  assert.equal(sanitizeMathDelimiters("$ 开头不对"), "\\$ 开头不对");
});

test("preserves $$...$$ display math untouched", () => {
  const input = "之前\n$$\nE=mc^2\n$$\n之后";
  assert.equal(sanitizeMathDelimiters(input), input);
});

test("preserves fenced code blocks with $ untouched", () => {
  const input = "文本\n```\n$foo = bar;\n```\n继续";
  assert.equal(sanitizeMathDelimiters(input), input);
});

test("leaves already escaped \\$ alone", () => {
  assert.equal(sanitizeMathDelimiters("价格 \\$100"), "价格 \\$100");
});

test("does not let currency-like dollars swallow a later valid formula", () => {
  const actual = sanitizeMathDelimiters("price is $100, formula is $x$.");
  assert.equal(actual, "price is \\$100, formula is $x$.");
});

test("treats plain words inside dollars as text, not math", () => {
  assert.equal(sanitizeMathDelimiters("token $USD$ and phrase $hello world$"), "token \\$USD\\$ and phrase \\$hello world\\$");
});

test("preserves pure numeric inline math", () => {
  const input = "steps $3$ and $4$, probability $0.8$, delta $-1.5$, rate $50\\%$";
  assert.equal(sanitizeMathDelimiters(input), input);
});

test("protects inline code spans before math scanning", () => {
  const actual = sanitizeMathDelimiters("code `$var = 1` and math $Q_{tot}$");
  assert.equal(actual, "code `$var = 1` and math $Q_{tot}$");
});

test("keeps $L(\\theta)$ between Chinese as valid math", () => {
  const input = "损失函数 $L(\\theta)$ 是";
  assert.equal(sanitizeMathDelimiters(input), input);
});

test("escapes suspicious pair with no math tokens", () => {
  const input = "这里 $ 的 $ 不对";
  const actual = sanitizeMathDelimiters(input);
  // Content between pair is " 的 " — no math tokens → suspicious
  assert.ok(actual.includes("\\$"));
});

test("handles odd count: three stray $ signs", () => {
  const input = "状态 $...给。策略 $，五元组 $";
  const actual = sanitizeMathDelimiters(input);
  // 3 dollars → last one unpaired (escaped). Then check the pair: contains 。→ escaped.
  // All three should be escaped.
  const escapedCount = (actual.match(/\\\$/g) ?? []).length;
  assert.equal(escapedCount, 3);
});

test("handles mixed valid and invalid pairs", () => {
  const input = "有效 $x^2$ 无效 $ 的 $ 有效 $y$";
  const actual = sanitizeMathDelimiters(input);
  // $x^2$ — valid (short, has ^, digits)
  // $ 的 $ — suspicious (no math tokens)
  // $y$ — valid (single letter, short)
  assert.ok(actual.includes("$x^2$"));
  assert.ok(actual.includes("$y$"));
  assert.ok(actual.includes("\\$ 的 \\$"));
});

test("newlines inside $...$ trigger escape", () => {
  const input = "$line1\nline2$";
  const actual = sanitizeMathDelimiters(input);
  // Both $ get escaped to \$, content with newline is preserved
  assert.ok(actual.startsWith("\\$"));
  assert.ok(actual.endsWith("\\$"));
  assert.ok(actual.includes("\n"));
});

test("long content >200 chars inside $...$ triggers escape", () => {
  const longStr = "A".repeat(201);
  const input = `$${longStr}$`;
  const actual = sanitizeMathDelimiters(input);
  assert.ok(actual.startsWith("\\$"));
  assert.ok(actual.endsWith("\\$"));
});

test("empty content returns empty", () => {
  assert.equal(sanitizeMathDelimiters(""), "");
});

test("no $ returns same content", () => {
  assert.equal(sanitizeMathDelimiters("纯净文本，没有任何美元符号。"), "纯净文本，没有任何美元符号。");
});

test("preserves adjacent display math blocks", () => {
  const input = "文本\n$$\n块1\n$$\n$$\n块2\n$$\n文本";
  assert.equal(sanitizeMathDelimiters(input), input);
});

test("handles content with only a single $ character", () => {
  assert.equal(sanitizeMathDelimiters("$"), "\\$");
});

test("handles content with only $$", () => {
  assert.equal(sanitizeMathDelimiters("$$"), "$$");
});

test("handles real-world example: scattered dollars in Chinese paragraph", () => {
  const input = "状态转移函数 $...给出。策略 $，决定在当前状态...五元组 $ 构成一个马尔可夫链。";
  const actual = sanitizeMathDelimiters(input);
  // Three $ signs — all should be escaped (odd count triggers last, pair with 。triggers first two)
  const escapedCount = (actual.match(/\\\$/g) ?? []).length;
  assert.equal(escapedCount, 3);
});
