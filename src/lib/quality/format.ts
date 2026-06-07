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
      suggestion: "补齐缺失的 ```。",
    });
  }

  return issues;
}
