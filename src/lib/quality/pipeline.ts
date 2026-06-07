import { Chapter, QualityIssue, QualityReport, QualityStatus } from "../types";
import { validateContinuity } from "./continuity";
import { validateFactLite } from "./fact-lite";
import { validateFormat } from "./format";
import { validateStructure } from "./structure";

const MAX_SELF_REPAIR_ATTEMPTS = 1;

export function runChapterQualityPipeline(chapter: Chapter, content: string): QualityReport {
  const issues = [
    ...validateStructure(content),
    ...validateFormat(content),
    ...validateContinuity(chapter),
    ...validateFactLite(content),
  ];

  const score = scoreIssues(issues);
  const status: QualityStatus =
    issues.some((issue) => issue.severity === "error") || score < 70
      ? "failed"
      : issues.length > 0
        ? "warning"
        : "passed";

  return {
    id: crypto.randomUUID(),
    targetType: "chapter",
    targetId: chapter.id,
    score,
    status,
    issues,
    createdAt: new Date().toISOString(),
  };
}

export function runChapterQualityPipelineWithRepair(
  chapter: Chapter,
  content: string,
  repair: (content: string) => string,
) {
  let nextContent = content;
  let report = runChapterQualityPipeline(chapter, nextContent);
  let attempts = 0;

  while (report.status === "failed" && attempts < MAX_SELF_REPAIR_ATTEMPTS && canRepair(report.issues)) {
    attempts += 1;
    const repaired = repair(nextContent);
    if (repaired === nextContent) break;
    nextContent = repaired;
    report = runChapterQualityPipeline(chapter, nextContent);
  }

  return {
    content: nextContent,
    report: {
      ...report,
      issues:
        attempts > 0
          ? [
              ...report.issues,
              {
                check: "self_repair.attempts",
                severity: report.status === "failed" ? ("warning" as const) : ("info" as const),
                message: `TQH self-repair attempts: ${attempts}.`,
                suggestion:
                  report.status === "failed"
                    ? "Review failed quality issues before publishing this chapter."
                    : "Chapter passed after deterministic format repair.",
                source: "TQH" as const,
              },
            ]
          : report.issues,
    },
    attempts,
  };
}

function canRepair(issues: QualityIssue[]) {
  return issues.some((issue) => issue.check.startsWith("format."));
}

function scoreIssues(issues: QualityIssue[]) {
  const penalty = issues.reduce((total, issue) => {
    if (issue.severity === "error") return total + 24;
    if (issue.severity === "warning") return total + 10;
    return total + 3;
  }, 0);
  return Math.max(0, 100 - penalty);
}
