import { test } from "node:test";
import assert from "node:assert/strict";
import { postRepairMarkdown } from "../../src/lib/prompts/formatGuard";
import { validateFormat } from "../../src/lib/quality/format";

// postRepairMarkdown is the deterministic, render-time format guard. Its job:
// whatever it emits must render correctly (no literal stray "$", no empty code
// blocks) and it must be idempotent (the renderer may run it again).

test("preserves valid inline math", () => {
  assert.equal(postRepairMarkdown("质量由 $E=mc^2$ 给出。"), "质量由 $E=mc^2$ 给出。");
});

test("preserves CJK-adjacent inline math", () => {
  const input = "设$x$为状态变量，则$y=f(x)$。";
  assert.equal(postRepairMarkdown(input), input);
});

test("tightens spaced inline math so remark-math can render it", () => {
  // "$ x $" is NOT recognized by remark-math (space after opening / before closing)
  // and would leak as a literal "$". Must become "$x$".
  const out = postRepairMarkdown("设 $ x $ 为变量。");
  assert.ok(out.includes("$x$"), `expected tightened $x$, got: ${out}`);
  assert.ok(!/\$ x \$/.test(out), `must not keep spaced delimiters: ${out}`);
});

test("tightens one-sided spaced inline math", () => {
  assert.ok(postRepairMarkdown("当 $x $ 增大").includes("$x$"));
  assert.ok(postRepairMarkdown("当 $ x$ 增大").includes("$x$"));
});

test("escapes stray lone dollar in a paragraph", () => {
  const out = postRepairMarkdown("状态转移函数 $给出。策略 $，五元组。");
  assert.ok(out.includes("\\$"), `lone $ should be escaped: ${out}`);
});

test("converts backslash-paren inline to $...$", () => {
  assert.equal(postRepairMarkdown("其中 \\(x_i\\) 表示样本。"), "其中 $x_i$ 表示样本。");
});

test("converts backslash-bracket block to $$...$$", () => {
  const out = postRepairMarkdown("推导：\n\\[\nY = \\sum_i x_i\n\\]\n完成。");
  assert.ok(out.includes("$$"), out);
  assert.ok(!out.includes("\\["), out);
});

test("removes empty code fences entirely", () => {
  const out = postRepairMarkdown("正文一段。\n\n```\n```\n\n下一段。");
  assert.ok(!/```\s*```/.test(out), `empty fence must be gone: ${JSON.stringify(out)}`);
  assert.ok(!/(^|\n)\s*```[a-zA-Z0-9_-]*\s*\n\s*```/.test(out), JSON.stringify(out));
});

test("removes empty fence with a language tag", () => {
  const out = postRepairMarkdown("正文。\n\n```python\n```\n\n结束。");
  assert.ok(!/```python\s*```/.test(out), JSON.stringify(out));
});

test("unwraps CJK prose wrapped in display math", () => {
  assert.ok(!postRepairMarkdown("$$这是中文说明文字不是公式$$").includes("$$"));
});

test("normalizes a realistic dirty chapter to render-safe output", () => {
  const dirty = [
    "# 第 3 章 马尔可夫决策过程",
    "",
    "设状态变量 $ s $ 与动作 $ a $，策略 $\\pi$ 给出动作分布。",
    "",
    "其中折扣因子 \\(\\gamma \\in (0,1)\\)。贝尔曼方程：",
    "",
    "\\[",
    "V(s) = \\max_a r(s,a)",
    "\\]",
    "",
    "下面给出伪代码：",
    "",
    "```python",
    "```",
    "",
    "成本函数写作 $，其中包含中文。",
    "",
    "```",
    "```",
    "",
    "本章小结。",
  ].join("\n");

  const out = postRepairMarkdown(dirty);

  // spaced inline math tightened
  assert.ok(out.includes("$s$") && out.includes("$a$"), out);
  assert.ok(!out.includes("$ s $") && !out.includes("$ a $"), out);
  // backslash delimiters converted
  assert.ok(!out.includes("\\(") && !out.includes("\\["), out);
  assert.ok(out.includes("$$"), out);
  // empty code fences removed
  assert.ok(!/```[a-zA-Z0-9_-]*\s*\n\s*```/.test(out), out);
  // lone dollar escaped, not left to leak
  assert.ok(out.includes("\\$"), out);
  // idempotent
  assert.equal(postRepairMarkdown(out), out);
});

test("is idempotent on all representative cases", () => {
  const samples = [
    "质量由 $E=mc^2$ 给出。",
    "设 $ x $ 为变量。",
    "设$x$为状态变量，则$y=f(x)$。",
    "状态转移函数 $给出。策略 $，五元组。",
    "正文一段。\n\n```\n```\n\n下一段。",
    "正文。\n\n```python\n```\n\n结束。",
    "其中 \\(x_i\\) 表示样本。",
    "推导：\n\\[\nY = \\sum_i x_i\n\\]\n完成。",
    "$$\nE = mc^2\n$$",
    "目标函数：\nL(\\theta) = \\sum_i (y_i - x_i)^2\n下面分析。",
  ];
  for (const s of samples) {
    const once = postRepairMarkdown(s);
    const twice = postRepairMarkdown(once);
    assert.equal(twice, once, `not idempotent for: ${JSON.stringify(s)}\n once: ${JSON.stringify(once)}\n twice: ${JSON.stringify(twice)}`);
  }
});

// Regression: MAS ch.3 — a bare display formula that embeds \text{CJK}. The CJK
// inside \text{} must NOT make the line be treated as prose; it must still be
// wrapped as display math so it renders instead of leaking literal LaTeX.
test("wraps bare display LaTeX that contains text-command CJK", () => {
  const input = String.raw`也就是说：
\max_{\mathbf{a}'} Q_{tot}(\mathbf{o}', \mathbf{a}') = Q_{tot}(\mathbf{o}', \mathbf{a}^*) \quad \text{其中 } a_i^* = \arg\max_{a_i} Q_i(o_i', a_i)
下面分析。`;
  const out = postRepairMarkdown(input);
  assert.ok(out.includes("$$"), `bare display LaTeX should be wrapped: ${JSON.stringify(out)}`);
  assert.equal(postRepairMarkdown(out), out, "must stay idempotent");
});

test("validateFormat flags bare strong-LaTeX line not wrapped in $/$$", () => {
  const bare = String.raw`也就是说：
\max_{\mathbf{a}'} Q_{tot}(\mathbf{o}') = Q_{tot}(\mathbf{a}^*) \quad \text{其中 } a_i^*
下面分析。`;
  const issues = validateFormat(bare);
  assert.ok(issues.some((i) => i.severity === "error"), `should flag an error: ${JSON.stringify(issues)}`);
});

test("validateFormat does not flag prose that merely mentions a command word", () => {
  const prose = "本节介绍最大化期望回报的方法,并讨论 argmax 的直觉。";
  const issues = validateFormat(prose);
  assert.ok(!issues.some((i) => i.check === "format.bare_latex"), `no false positive: ${JSON.stringify(issues)}`);
});


// KaTeX-as-judge: escaped-dollar math and render validation
test("unescapes \$...\$ when KaTeX can render it (\$i\$ -> $i$)", () => {
  const out = postRepairMarkdown(String.raw`其中 \$i\$ 表示第 i 个智能体。`);
  assert.ok(out.includes("$i$"), out);
  assert.ok(!out.includes(String.raw`\$i\$`), out);
});

test("keeps literal currency \$5 (not renderable as intended math)", () => {
  const out = postRepairMarkdown(String.raw`成本约 \$5 美元。`);
  assert.ok(out.includes(String.raw`\$5`), out);
});

test("validateFormat flags a formula KaTeX cannot render", () => {
  const issues = validateFormat(String.raw`公式:$$\frac{1}$$ 完成。`);
  assert.ok(issues.some((i) => i.check === "format.unrenderable_math"), JSON.stringify(issues));
});

test("validateFormat does not flag a valid formula", () => {
  const issues = validateFormat(String.raw`公式:$$\frac{\partial Q}{\partial Q_i} \geq 0$$ 和行内 $Q_{tot}$。`);
  assert.ok(!issues.some((i) => i.check === "format.unrenderable_math"), JSON.stringify(issues));
});
