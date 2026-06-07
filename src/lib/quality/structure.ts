import { QualityIssue } from "../types";

const REQUIRED_PATTERNS = [
  { check: "structure.heading", pattern: /^#\s+/mu, message: "章节缺少一级标题。" },
  { check: "structure.exercise", pattern: /练习|实践|任务/u, message: "章节缺少练习或实践任务。" },
  { check: "structure.explanation", pattern: /直觉|解释|概念|定义/u, message: "章节缺少概念解释或直觉说明。" },
];

export function validateStructure(content: string): QualityIssue[] {
  return REQUIRED_PATTERNS.flatMap((item) =>
    item.pattern.test(content)
      ? []
      : [
          {
            check: item.check,
            severity: "error" as const,
            message: item.message,
            suggestion: "补齐教材章节的基础结构。",
          },
        ],
  );
}
