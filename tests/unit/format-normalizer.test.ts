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

test("removes nested single-dollar delimiters inside display math", () => {
  const dirty = "$$\n$\n\\Omega=\\{s_0,s_1\\}\n$\n$$";
  const out = postRepairMarkdown(dirty);
  assert.equal(out, "$$\n\\Omega=\\{s_0,s_1\\}\n$$");
  assert.equal(postRepairMarkdown(out), out);
  assert.ok(!validateFormat(out).some((issue) => issue.check === "format.lonely_dollar"), JSON.stringify(validateFormat(out)));
});

test("removes leaked dollar delimiters from display math body", () => {
  const dirty = "$$\n$\\Pr(A)$\n=\n0.8\n$$";
  const out = postRepairMarkdown(dirty);
  const body = out.match(/\$\$([\s\S]*?)\$\$/u)?.[1] ?? "";
  assert.doesNotMatch(body, /\$/u, out);
  assert.equal(postRepairMarkdown(out), out);
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

test("escapes | inside table-cell math to \\mid so the row does not split the formula", () => {
  const input =
    "| 类型 | 表达式 | 特点 |\n| --- | --- | --- |\n" +
    "| 贝尔曼 | $v_\\pi(s) = \\sum_a \\pi(a|s) p(s',r|s,a)$ | 期望 |";
  const out = postRepairMarkdown(input);
  assert.match(out, /\\pi\(a\\mid s\)/u);
  assert.match(out, /p\(s',r\\mid s,a\)/u);
  const dataRow = out.split("\n").find((l) => l.includes("贝尔曼"))!;
  // exactly the 4 real column separators remain (none left inside the formula)
  assert.equal((dataRow.match(/(?<!\\)\|/gu) ?? []).length, 4);
  assert.equal(postRepairMarkdown(out), out, "must stay idempotent");
});

test("does not rewrite | outside of tables (absolute value stays intact)", () => {
  const out = postRepairMarkdown("绝对值 $|x|$ 在正文里应保持不变。");
  assert.doesNotMatch(out, /\\mid/u);
  assert.match(out, /\|x\|/u);
});


// Regression: real RL-textbook failure — a whole display formula emitted with
// NO delimiters, split across lines, first line starting with "(" so no
// line-level heuristic fires. The paragraph-level KaTeX-judged wrapper must
// wrap it as display math.
test("wraps a fully bare multi-line formula paragraph (real ch02 case)", () => {
  const input = [
    "若今天状态为晴，则明天奖励的条件期望是",
    "",
    String.raw`(P r)(\text{晴})`,
    "=",
    String.raw`0.8\times 1+0.2\times (-1)`,
    "=0.6.",
    "",
    "其中，$0.8$ 是今天晴、明天仍为晴的概率。",
  ].join("\n");
  const out = postRepairMarkdown(input);
  assert.ok(out.includes("$$\n(P r)(" + String.raw`\text{晴})`), out);
  assert.ok(out.includes("=0.6.\n$$"), out);
  assert.equal(postRepairMarkdown(out), out, "must stay idempotent");
});

test("wraps a bare single-line formula starting with an absolute-value bar (real ch03 case)", () => {
  const input = `则有\n\n${String.raw`|G_t| \leq (T-t)R_{\max}.`}\n\n其中 $T$ 表示回合终止时刻。`;
  const out = postRepairMarkdown(input);
  assert.ok(out.includes("$$\n" + String.raw`|G_t| \leq (T-t)R_{\max}.` + "\n$$"), out);
  assert.equal(postRepairMarkdown(out), out);
});

test("wraps raw formulas inside a blockquote example (real KL example case)", () => {
  const input = [
    "> 例 16-1：从整段回溯到逐令牌 KL 惩罚",
    ">",
    "> 给定提示词 $x$，当前策略和参考策略的条件概率为：",
    ">",
    String.raw`> \pi_\theta(a\mid x)=0.6,\qquad \pi_\theta(b\mid x)=0.5,`,
    ">",
    String.raw`> \pi_{\mathrm{ref}}(a\mid x)=0.4,\qquad \pi_{\mathrm{ref}}(b\mid x)=0.8.`,
    ">",
    "> 因而对动作 $a$ 的逐令牌差为：",
    ">",
    String.raw`> \log\frac{0.30}{0.32}`,
    ">",
    String.raw`> 1.2\times 3`,
  ].join("\n");
  const out = postRepairMarkdown(input);
  assert.match(out, /\$\$\n\\pi_\\theta\(a\\mid x\)=0\.6/u, out);
  assert.match(out, /\$\$\n\\log\\frac\{0\.30\}\{0\.32\}\n\$\$/u, out);
  assert.match(out, /\$\$\n1\.2\\times 3\n\$\$/u, out);
  assert.equal(postRepairMarkdown(out), out, "must stay idempotent");
});

test("converts legacy example and definition blockquotes to textbook paragraphs", () => {
  const input = [
    "> 例 16-1：从整段回溯到逐令牌 KL 惩罚",
    ">",
    "> 给定提示词 $x$，回合由两个令牌组成。",
    ">",
    "> 定义 16.2：序列级偏好",
    ">",
    "> 序列级偏好比较完整回答的整体质量。",
  ].join("\n");
  const out = postRepairMarkdown(input);
  assert.match(out, /^\*\*例 16-1：从整段回溯到逐令牌 KL 惩罚\*\*/mu);
  assert.match(out, /^\*\*定义 16\.2：序列级偏好\*\*/mu);
  assert.doesNotMatch(out, /^>\s*(?:例|定义)/mu);
  assert.equal(postRepairMarkdown(out), out, "must stay idempotent");
});

test("keeps cases row spacing commands inside display math", () => {
  const input = [
    "$$",
    String.raw`\pi(a\mid s)=`,
    String.raw`\begin{cases}`,
    String.raw`1-\varepsilon, & a=a^*,\\[6pt]`,
    String.raw`\varepsilon, & a\ne a^*.`,
    String.raw`\end{cases}`,
    "$$",
  ].join("\n");
  const out = postRepairMarkdown(input);
  assert.equal(out, input);
  assert.ok(!validateFormat(out).some((issue) => issue.check === "format.math_delimiters"), JSON.stringify(validateFormat(out)));
  assert.equal(postRepairMarkdown(out), out);
});

test("heals cases split by a mistaken \\\\[6pt] delimiter conversion", () => {
  const input = [
    "$$",
    String.raw`\pi(a\mid s)=`,
    String.raw`\begin{cases}`,
    "1-\\varepsilon, & a=a^*,\\",
    "$$",
    "6pt]",
    "",
    "$$",
    String.raw`\varepsilon, & a\ne a^*.`,
    String.raw`\end{cases}`,
    "$$",
  ].join("\n");
  const out = postRepairMarkdown(input);
  assert.match(out, /a=a\^\*,\\\\\[6pt\]/u);
  assert.doesNotMatch(out, /^\s*6pt\]\s*$/mu);
  assert.equal((out.match(/\$\$/gu) ?? []).length, 2);
  assert.ok(!validateFormat(out).some((issue) => issue.check === "format.unrenderable_math"), JSON.stringify(validateFormat(out)));
  assert.equal(postRepairMarkdown(out), out);
});

test("heals cases split where the next row body is trapped between display delimiters", () => {
  const input = [
    "$$",
    String.raw`\frac{\pi(A_t\mid S_t)}`,
    String.raw`{b(A_t\mid S_t)}`,
    "=",
    String.raw`\begin{cases}`,
    String.raw`\dfrac{1}{b(A_t\mid S_t)},`,
    "& A_t=\\pi(S_t),\\",
    "$$",
    "6pt]",
    "0,",
    "",
    "$$",
    String.raw`& A_t\ne\pi(S_t).`,
    String.raw`\end{cases}`,
    "$$",
  ].join("\n");
  const out = postRepairMarkdown(input);
  assert.match(out, /A_t=\\pi\(S_t\),\\\\\[6pt\]\n0,/u);
  assert.equal((out.match(/\$\$/gu) ?? []).length, 2);
  assert.ok(!validateFormat(out).some((issue) => issue.check.startsWith("format.")), JSON.stringify(validateFormat(out)));
  assert.equal(postRepairMarkdown(out), out);
});

test("merges a bare relation prefix into the following display formula", () => {
  const input = [
    "若奖励有界，则",
    "",
    String.raw`|G_t|`,
    String.raw`\le`,
    "",
    "$$",
    String.raw`\sum_{k=0}^{\infty}\gamma^kR_{\max}`,
    String.raw`=\frac{R_{\max}}{1-\gamma}.`,
    "$$",
    "",
    "因此回报有界。",
  ].join("\n");
  const out = postRepairMarkdown(input);
  assert.ok(out.includes("$$\n" + String.raw`|G_t|` + "\n" + String.raw`\le`), out);
  assert.equal((out.match(/\$\$/gu) ?? []).length, 2);
  assert.ok(!validateFormat(out).some((issue) => issue.check === "format.bare_latex"), JSON.stringify(validateFormat(out)));
  assert.equal(postRepairMarkdown(out), out);
});

test("does not wrap prose paragraphs, tables, or lists as math", () => {
  const input = [
    "这是一个提及公式概念的中文段落，但它不是公式。",
    "",
    "| 列A | 列B |",
    "| --- | --- |",
    "| 1 | 2 |",
    "",
    String.raw`- 列表项 \alpha 提及`,
  ].join("\n");
  const out = postRepairMarkdown(input);
  assert.ok(!out.includes("$$"), out);
});
