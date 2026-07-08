import { QualityIssue } from "../types";

const REQUIRED_PATTERNS = [
  { check: "structure.heading", pattern: /^#\s+/mu, message: "章节缺少一级标题。" },
  { check: "structure.exercise", pattern: /练习|实践|任务/u, message: "章节缺少练习或实践任务。" },
  { check: "structure.explanation", pattern: /直觉|解释|概念|定义/u, message: "章节缺少概念解释或直觉说明。" },
];

export function validateStructure(content: string): QualityIssue[] {
  const base = REQUIRED_PATTERNS.flatMap((item) =>
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
  return [...base, ...validateEndBlockTitles(content)];
}

/**
 * The fixed end-blocks must use one canonical title across the whole book
 * («## 本章小结», «## 练习») so chapters don't drift to variants like «## 习题»
 * or «## 小结». A numeric prefix («## 4.11 本章小结») is allowed. Only flags when
 * a variant title is present but the canonical one is missing (a warning, not a
 * hard failure — the author prompt is the primary enforcement).
 */
function validateEndBlockTitles(content: string): QualityIssue[] {
  const canonical = (title: string) =>
    new RegExp(`^##\\s+(?:\\d+(?:\\.\\d+)*[\\s、.．]+)?${title}\\s*$`, "mu");
  const checks = [
    { title: "本章小结", variant: /^##\s+.*(?:小结|总结|回顾)\s*$/mu },
    { title: "练习", variant: /^##\s+.*(?:习题|练习|思考题|作业)\s*$/mu },
  ];
  return checks.flatMap(({ title, variant }) =>
    !canonical(title).test(content) && variant.test(content)
      ? [
          {
            check: "structure.block_title",
            severity: "warning" as const,
            message: `固定结尾块标题应统一为「## ${title}」，发现了变体写法。`,
            suggestion: `将该块标题改为「## ${title}」，与全书其他章节保持一致。`,
          },
        ]
      : [],
  );
}
