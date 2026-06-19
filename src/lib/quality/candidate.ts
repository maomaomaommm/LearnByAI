import { QualityIssue, QualityReport } from "../types";

type QualityDecisionReport = Pick<QualityReport, "issues" | "score" | "status">;

const STATUS_RANK = {
  failed: 0,
  warning: 1,
  passed: 2,
} as const;

export function shouldAcceptQualityCandidate(current: QualityDecisionReport, candidate: QualityDecisionReport) {
  const currentSummary = summarizeQualityForDecision(current);
  const candidateSummary = summarizeQualityForDecision(candidate);

  if (candidateSummary.errors > currentSummary.errors) return false;
  if (candidateSummary.blocking > currentSummary.blocking) return false;

  if (candidateSummary.errors < currentSummary.errors) return true;
  if (candidateSummary.blocking < currentSummary.blocking && candidate.score >= current.score - 5) return true;

  if (STATUS_RANK[candidate.status] > STATUS_RANK[current.status] && candidate.score >= current.score - 5) {
    return true;
  }

  if (candidate.score > current.score) return true;
  if (candidate.score < current.score) return false;

  if (candidateSummary.warnings < currentSummary.warnings) return true;
  if (candidateSummary.issueBurden < currentSummary.issueBurden) return true;

  return false;
}

export function summarizeQualityForDecision(report: QualityDecisionReport) {
  const substantiveIssues = report.issues.filter((issue) => !isWorkflowQualityIssue(issue));
  const errors = substantiveIssues.filter((issue) => issue.severity === "error").length;
  const warnings = substantiveIssues.filter((issue) => issue.severity === "warning").length;
  const infos = substantiveIssues.filter((issue) => issue.severity === "info").length;
  const blocking = countBlockingQualityIssues(substantiveIssues);
  const issueBurden = errors * 100 + blocking * 30 + warnings * 10 + infos * 2;

  return {
    errors,
    warnings,
    infos,
    blocking,
    issueBurden,
  };
}

export function countBlockingQualityIssues(issues: QualityIssue[]) {
  return issues.filter((issue) => {
    if (isWorkflowQualityIssue(issue)) return false;
    if (issue.severity === "error") return true;
    const text = `${issue.check} ${issue.message} ${issue.suggestion ?? ""}`;
    return /contract|continuity|structure|forbidden|missing|truncated|unfinished|提前|后续|结构|缺失|草稿/u.test(text);
  }).length;
}

export function isWorkflowQualityIssue(issue: QualityIssue) {
  return (
    issue.check.startsWith("review_repair.") ||
    issue.check.startsWith("self_repair.") ||
    issue.check === "reviewer.unavailable"
  );
}
