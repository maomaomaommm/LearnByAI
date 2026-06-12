import { QualityIssue } from "../types";

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

  return issues;
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
