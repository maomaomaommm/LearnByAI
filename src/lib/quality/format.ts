import { QualityIssue } from "../types";
import { canRenderMath } from "../katexValidate";

export function validateFormat(content: string): QualityIssue[] {
  const issues: QualityIssue[] = [];

  if (/\\\[|\\\]/u.test(content)) {
    issues.push({
      check: "format.math_delimiters",
      severity: "warning",
      message: "发现 \\[ 或 \\] 公式定界符。",
      suggestion: "使用 $$ 块级公式。",
    });
  }

  if (/(^|\n)\$(?!\$)\s*[^$\n]+(\n|$)/u.test(content)) {
    issues.push({
      check: "format.lonely_dollar",
      severity: "error",
      message: "发现疑似孤立美元符号公式。",
      suggestion: "将复杂公式放入独立 $$ 块。",
    });
  }

  // Detect stray $ mid-paragraph surrounded by CJK content
  // e.g. "状态转移函数 $...给出。策略 $，五元组"
  if (/[一-鿿　-〿＀-￯]\s*\$[一-鿿　-〿＀-￯]/u.test(content)) {
    issues.push({
      check: "format.stray_math_dollar",
      severity: "error",
      message: "发现段落中间混入的孤美元符号。",
      suggestion: "将孤 $ 转义为 \\$，或将数学公式放入正确的 $...$ 或 $$...$$ 块。",
    });
  }

  if ((content.match(/```/gu)?.length ?? 0) % 2 !== 0) {
    issues.push({
      check: "format.code_fence",
      severity: "error",
      message: "代码块 fence 数量不成对。",
      suggestion: "补齐缺失的 ```，或删除多余的 fence。",
    });
  }

  if (hasEmptyFencePair(content)) {
    issues.push({
      check: "format.empty_code_fence",
      severity: "error",
      message: "发现空代码块或多余的连续代码块 fence。",
      suggestion: "删除空代码块和正文末尾多余的 ```。",
    });
  }

  const displayMathCount = content.match(/(^|\n)\$\$\s*\n/gu)?.length ?? 0;
  const likelyDisplayFormulaCount = countLikelyDisplayFormulaLines(content);
  if (displayMathCount === 0 && likelyDisplayFormulaCount >= 3) {
    issues.push({
      check: "format.missing_block_math",
      severity: "error",
      message: "发现多处疑似独立公式，但没有使用 $$...$$ 块公式。",
      suggestion: "将独立公式、推导和多行公式改成 $$...$$ 块公式。",
    });
  }

  if (hasBareLatexCommand(content)) {
    issues.push({
      check: "format.bare_latex",
      severity: "error",
      message: "发现未包裹在 $ 或 $$ 中的裸 LaTeX 命令(公式会被当作普通文本输出)。",
      suggestion: "将独立公式放入 $$...$$,行内公式放入 $...$；公式内中文用 \\text{} 包裹。",
    });
  }

  // Authoritative check: ask KaTeX (the actual renderer) to render every formula
  // block. Anything it can't render is a real rendering error, caught precisely
  // rather than guessed at.
  const broken = findUnrenderableMath(content);
  if (broken.length) {
    issues.push({
      check: "format.unrenderable_math",
      severity: "error",
      message: `发现 ${broken.length} 处 KaTeX 无法渲染的公式(语法错误或残缺),例如:${broken[0]}`,
      suggestion: "修正 LaTeX 语法,使其能被 KaTeX 正确渲染。",
    });
  }

  if (hasLatexInMermaidLabel(content)) {
    issues.push({
      check: "format.mermaid_latex",
      severity: "warning",
      message: "Mermaid 图内标签疑似含 LaTeX / 数学记号($、_{}、^{}、\\ 命令),图里会原样显示。",
      suggestion: "图内标签改用纯文本(如 S(t)、pi_ref 或中文);渲染时系统会兜底清洗,但建议源头就写成纯文本。",
    });
  }

  return issues;
}

// Mermaid renders labels as plain text, so LaTeX left inside a ```mermaid block
// shows up literally. `$`, `_{`, `^{` and greek commands never appear in
// Mermaid's own syntax, so their presence inside a mermaid fence is a leak.
function hasLatexInMermaidLabel(content: string) {
  const blocks = content.match(/```mermaid[\s\S]*?```/gu) ?? [];
  return blocks.some((block) =>
    /\$|_\{|\^\{|\\(?:pi|gamma|theta|phi|lambda|sigma|mu|alpha|beta|text|frac|mathbb|mathbf|hat|bar)\b/u.test(block),
  );
}

// Render every $$...$$ and $...$ with KaTeX; report ones that fail (the renderer
// is the judge, so this catches the exact errors a reader would see).
function findUnrenderableMath(content: string): string[] {
  const fenceless = content.replace(/```[\s\S]*?```/gu, "");
  const broken: string[] = [];

  for (const m of fenceless.matchAll(/\$\$([\s\S]+?)\$\$/gu)) {
    const inner = m[1]!.trim();
    if (inner && !canRenderMath(inner, true)) broken.push(inner.slice(0, 60));
  }
  const inlineScan = fenceless.replace(/\$\$[\s\S]+?\$\$/gu, "");
  for (const m of inlineScan.matchAll(/(?<!\\)\$(?!\$)([^\n$]+?)(?<!\\)\$/gu)) {
    const inner = m[1]!.trim();
    if (inner && !canRenderMath(inner, false)) broken.push(inner.slice(0, 60));
  }
  return broken;
}

// Detects strong LaTeX commands that leak OUTSIDE any code fence / $$ block /
// inline $...$ — i.e. a bare formula the model forgot to wrap. CJK inside the
// formula (e.g. \text{中文}) does not hide it; ordinary prose that merely says
// "argmax" (no backslash) is not flagged.
function hasBareLatexCommand(content: string) {
  const stripped = content
    .replace(/```[\s\S]*?```/gu, "")
    .replace(/\$\$[\s\S]*?\$\$/gu, "")
    .replace(/(?<!\\)\$[^\n$]+?(?<!\\)\$/gu, "");
  return /\\(?:max|min|arg|sup|inf|quad|qquad|mathbf|mathbb|mathcal|mathrm|operatorname|frac|dfrac|tfrac|sum|prod|int|begin|partial|nabla|cdot|times|leq|geq|sqrt|hat|bar|vec|alpha|beta|gamma|theta|lambda|sigma|mu|pi|infty)\b/u.test(stripped);
}

function hasEmptyFencePair(content: string) {
  return /(^|\n)\s*```[a-zA-Z0-9_-]*\s*\n\s*```\s*(?=\n|$)/u.test(content);
}

function countLikelyDisplayFormulaLines(content: string) {
  let count = 0;
  let inFence = false;
  let inDisplayMath = false;

  for (const line of content.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (/^(```|~~~)/u.test(trimmed)) {
      inFence = !inFence;
      continue;
    }
    if (trimmed === "$$") {
      inDisplayMath = !inDisplayMath;
      continue;
    }
    if (inFence || inDisplayMath || !trimmed) continue;
    if (/[\u4e00-\u9fff]/u.test(trimmed) && !/^\\(?:begin|frac|sum|int|operatorname|mathrm|mathbf|Pr|mathbb)\b/u.test(trimmed)) continue;
    if (
      /(?:\\frac|\\sum|\\int|\\operatorname|\\begin\{|[A-Za-z0-9_{}\\]+\s*[=≈≤≥]|[A-Za-z]\([^)]*\)\s*=)/u.test(trimmed) &&
      /[=≈≤≥+\-*/^_\\]/u.test(trimmed)
    ) {
      count += 1;
    }
  }

  return count;
}
