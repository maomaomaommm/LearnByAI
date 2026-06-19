import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeMath } from "../../src/lib/markdownMath";
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

test("format repair removes empty trailing code fences", () => {
  const content = ["# Heading", "concept explanation", "exercise task", "```python", "print(1)", "```", "```", "```"].join("\n");
  const repaired = preRepairMarkdown(content);
  const result = runChapterQualityPipeline(chapter(), repaired);

  assert.doesNotMatch(repaired, /\n```\n```\s*$/u);
  assert.ok(!result.issues.some((issue) => issue.check === "format.empty_code_fence"));
});

test("format repair preserves fenced text diagrams", () => {
  const content = [
    "# Heading",
    "concept explanation",
    "exercise task",
    "```text",
    "given r + [error e] -> controller -> scheduler -> transformer -> output y",
    "              ^                                      |",
    "              |--------- sensor / feedback ---------|",
    "```",
  ].join("\n");

  const repaired = preRepairMarkdown(content);

  assert.match(repaired, /```text\n/u);
  assert.match(repaired, /sensor \/ feedback/u);
});

test("TQH flags likely display formulas without block math", () => {
  const content = [
    "# Heading",
    "concept explanation",
    "exercise task",
    "H(j\\omega) = \\frac{1}{1 + j\\omega RC}",
    "C_{Agent} = g(C_{Model}, C_{Harness})",
    "\\operatorname{Err} = \\frac{1}{m}\\sum_i e_i",
  ].join("\n");
  const report = runChapterQualityPipeline(chapter(), content);

  assert.equal(report.status, "failed");
  assert.ok(report.issues.some((issue) => issue.check === "format.missing_block_math"));
});

test("math normalization preserves valid display math delimiters", () => {
  const content = [
    "Accuracy is:",
    "",
    "$$",
    "\\operatorname{Acc}_{\\text{observed}} =",
    "\\frac{1}{m}\\sum_{i \\in \\mathcal{I}_{\\text{ok}}}",
    "\\mathbf{1}(\\hat{y}_i = y_i)",
    "$$",
    "where $m = |\\mathcal{I}_{\\text{ok}}|$.",
  ].join("\n");

  const normalized = normalizeMath(content);

  assert.match(normalized, /\$\$\n\\operatorname\{Acc\}_\{\\text\{observed\}\} =/u);
  assert.match(normalized, /\\mathbf\{1\}\(\\hat\{y\}_i = y_i\)\n\$\$/u);
  assert.doesNotMatch(normalized, /(^|\n)\$(?!\$)\n\\operatorname/u);
});

test("math normalization escapes underscores inside text-mode LaTeX commands", () => {
  const content = [
    "$$",
    "\\operatorname{state}_{\\text{__end__}} = \\mathrm{node_name}",
    "$$",
  ].join("\n");

  const normalized = normalizeMath(content);

  assert.match(normalized, /\\text\{\\_\\_end\\_\\_\}/u);
  assert.match(normalized, /\\mathrm\{node\\_name\}/u);
});

test("math normalization prevents KaTeX multiple tag failures in aligned blocks", () => {
  const content = [
    "$$",
    "\\begin{aligned}",
    "\\frac{v_\\alpha(s)}{v(s)} &= \\frac{k\\omega_0 s}{s^2 + k\\omega_0 s + \\omega_0^2} \\tag{3.3} \\\\",
    "\\frac{v_\\beta(s)}{v(s)} &= \\frac{k\\omega_0^2}{s^2 + k\\omega_0 s + \\omega_0^2} \\tag{3.4}",
    "\\end{aligned}",
    "$$",
  ].join("\n");

  const normalized = normalizeMath(content);

  assert.doesNotMatch(normalized, /\\tag\{3\.[34]\}/u);
  assert.match(normalized, /\\qquad \\text\{\(3\.3\)\}/u);
  assert.match(normalized, /\\qquad \\text\{\(3\.4\)\}/u);
});

test("math normalization wraps absolute-value formulas that start with pipe", () => {
  const content = [
    "PI 控制器频率响应幅值：",
    "|G_{\\text{PI}}(j\\omega)| = \\sqrt{K_p^2 + \\left(\\frac{K_i}{\\omega}\\right)^2}, \\qquad \\omega_c = 100",
    "后续文字不应进入公式块。",
  ].join("\n");

  const normalized = normalizeMath(content);

  assert.match(normalized, /\$\$\n\|G_\{\\text\{PI\}\}\(j\\omega\)\| = \\sqrt/u);
  assert.match(normalized, /\\qquad \\omega_c = 100\n\$\$/u);
  assert.equal(displayBlocksContaining(normalized, "后续文字").length, 0);
});

test("math normalization wraps naked formulas with repeated variable words", () => {
  const content = [
    "Formula:",
    "T_1 = \\frac{\\sqrt{3} |\\vec{v}_{ref}|}{T_s^{V{dc}}} \\sin\\left( \\frac{\\pi}{3} - \\theta \\right), \\quad T_2 = \\frac{\\sqrt{3} |\\vec{v}_{ref}|}{T_s^{V{dc}}} \\sin(\\theta),",
    "G_{cl}(s) = \\frac{\\hat{v}_o(s)}{\\hat{V}_{ref}(s)} = \\frac{G_c(s) G_{PWM}(s) G_{vd}(s)}{1 + G_c(s) G_{PWM}(s) G_{vd}(s)}",
  ].join("\n");

  const normalized = normalizeMath(content);

  assert.match(normalized, /\$\$\nT_1 = \\frac/u);
  assert.match(normalized, /\\sin\(\\theta\),\nG_\{cl\}\(s\) = \\frac/u);
  assert.match(normalized, /G_c\(s\) G_\{PWM\}\(s\) G_\{vd\}\(s\)\}\n\$\$/u);
});

test("math normalization accepts common model-generated LaTeX variants", () => {
  const content = [
    "Bracket display:",
    "\\[",
    "a_i = b_i",
    "\\]",
    "Inline escaped parens: \\(m = |I|\\).",
    "Equation environment:",
    "\\begin{equation}",
    "\\theta = \\frac{1}{n}\\sum_i x_i",
    "\\end{equation}",
    "Align environment:",
    "\\begin{align}",
    "L(\\theta) &= \\sum_i \\ell_i(\\theta) \\\\",
    "\\nabla L(\\theta) &= 0",
    "\\end{align}",
    "Single dollar display:",
    "$",
    "\\operatorname{Acc} = \\frac{1}{m}\\sum_i \\mathbf{1}(\\hat{y}_i=y_i)",
    "$",
    "Line-start display:",
    "$ \\operatorname{Err} =",
    "\\frac{1}{m}\\sum_i \\mathbf{1}(\\hat{y}_i \\ne y_i)",
    "",
    "Naked display:",
    "\\Pr(Y=1 \\mid X=x) =",
    "\\frac{\\Pr(X=x \\mid Y=1)\\Pr(Y=1)}{\\Pr(X=x)}",
  ].join("\n");

  const normalized = normalizeMath(content);

  assert.match(normalized, /\$\$\na_i = b_i\n\$\$/u);
  assert.match(normalized, /Inline escaped parens: \$m = \|I\|\$\./u);
  assert.match(normalized, /\$\$\n\\theta = \\frac\{1\}\{n\}\\sum_i x_i\n\$\$/u);
  assert.ok(
    normalized.includes(
      [
        "$$",
        "\\begin{aligned}",
        "L(\\theta) &= \\sum_i \\ell_i(\\theta) \\\\",
        "\\nabla L(\\theta) &= 0",
        "\\end{aligned}",
        "$$",
      ].join("\n"),
    ),
  );
  assert.match(normalized, /\$\$\n\\operatorname\{Acc\} = \\frac\{1\}\{m\}\\sum_i \\mathbf\{1\}\(\\hat\{y\}_i=y_i\)\n\$\$/u);
  assert.match(normalized, /\$\$\n\\operatorname\{Err\} =\n\\frac\{1\}\{m\}\\sum_i \\mathbf\{1\}\(\\hat\{y\}_i \\ne y_i\)\n\$\$/u);
  assert.match(normalized, /\$\$\n\\Pr\(Y=1 \\mid X=x\) =\n\\frac\{\\Pr\(X=x \\mid Y=1\)\\Pr\(Y=1\)\}\{\\Pr\(X=x\)\}\n\$\$/u);
  assert.doesNotMatch(normalized, /\\\[|\\\]/u);
  assert.doesNotMatch(normalized, /(^|\n)\$(?!\$)\n/u);
});

test("math normalization does not repair fenced code or inline prose as display math", () => {
  const content = [
    "Inline math stays inline: $x_i$ is a variable in this sentence.",
    "",
    "```js",
    "const raw = \"\\\\[not math here\\\\]\";",
    "$$",
    "```",
  ].join("\n");

  const normalized = normalizeMath(content);

  assert.match(normalized, /\$x_i\$ is a variable/u);
  assert.match(normalized, /```js\nconst raw = "\\\\\[not math here\\\\\]";\n\$\$\n```/u);
  assert.doesNotMatch(normalized, /\$\$\nx_i/u);
});

test("math normalization preserves adjacent display blocks without swallowing prose", () => {
  const content = [
    "Two metrics:",
    "",
    "$$",
    "\\mathrm{Acc}_{\\mathrm{count\\ invalid}} = \\frac{\\sum_{i=1}^{n}\\mathbf{1}\\{\\hat{y}_i=y_i\\}}{n}",
    "$$",
    "$$",
    "\\mathrm{Acc}_{\\mathrm{skip\\ invalid}} = \\frac{\\sum_{i \\in V}\\mathbf{1}\\{\\hat{y}_i=y_i\\}}{|V|}",
    "$$",
    "where $V$ is the valid-output sample set, $|V|$ is its size, and $n$ is the full sample count.",
    "",
    "Next section starts here.",
  ].join("\n");

  const normalized = normalizeMath(content);

  assert.match(
    normalized,
    /\$\$\n\\mathrm\{Acc\}_\{\\mathrm\{count\\ invalid\}\} = [\s\S]*?\n\$\$\n\$\$\n\\mathrm\{Acc\}_\{\\mathrm\{skip\\ invalid\}\} = [\s\S]*?\n\$\$/u,
  );
  assert.match(normalized, /where \$V\$ is the valid-output sample set/u);
  assert.equal(displayBlocksContaining(normalized, "where $V$").length, 0);
  assert.equal(displayBlocksContaining(normalized, "Next section starts here.").length, 0);
});

function displayBlocksContaining(content: string, needle: string) {
  const blocks: string[] = [];
  const current: string[] = [];
  let inDisplayMath = false;

  for (const line of content.split("\n")) {
    if (line.trim() === "$$") {
      if (inDisplayMath) {
        const body = current.join("\n");
        if (body.includes(needle)) blocks.push(body);
        current.length = 0;
      }
      inDisplayMath = !inDisplayMath;
      continue;
    }

    if (inDisplayMath) current.push(line);
  }

  return blocks;
}
