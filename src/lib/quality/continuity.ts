import { Chapter, QualityIssue } from "../types";

export function validateContinuity(chapter: Chapter): QualityIssue[] {
  const issues: QualityIssue[] = [];

  if (!chapter.connectionFromPrevious) {
    issues.push({
      check: "continuity.previous",
      severity: "warning",
      message: "章节缺少承接上一章的说明。",
      suggestion: "补充 connectionFromPrevious。",
    });
  }

  if (!chapter.setupForNext) {
    issues.push({
      check: "continuity.next",
      severity: "warning",
      message: "章节缺少为下一章铺垫的说明。",
      suggestion: "补充 setupForNext。",
    });
  }

  return issues;
}
