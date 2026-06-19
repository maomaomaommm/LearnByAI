import assert from "node:assert/strict";
import test from "node:test";
import { shouldAcceptQualityCandidate, summarizeQualityForDecision } from "../../src/lib/quality/candidate";
import { QualityReport } from "../../src/lib/types";

function report(input: Partial<QualityReport>): QualityReport {
  return {
    id: crypto.randomUUID(),
    targetType: "chapter",
    targetId: "chapter-1",
    score: 62,
    status: "failed",
    issues: [],
    createdAt: new Date(0).toISOString(),
    ...input,
  };
}

test("quality candidate accepts equal-score repairs that reduce substantive warnings", () => {
  const current = report({
    score: 62,
    issues: [
      { check: "reviewer.continuity", severity: "warning", message: "提前展开后续章节。", source: "REVIEWER" },
      { check: "reviewer.depth", severity: "warning", message: "土壤热通量符号错误。", source: "REVIEWER" },
      { check: "review_repair.attempts", severity: "warning", message: "internal", source: "TQH" },
    ],
  });
  const candidate = report({
    score: 62,
    issues: [
      { check: "reviewer.depth", severity: "warning", message: "土壤热通量符号错误。", source: "REVIEWER" },
      { check: "review_repair.attempts", severity: "warning", message: "internal", source: "TQH" },
    ],
  });

  assert.equal(shouldAcceptQualityCandidate(current, candidate), true);
  assert.equal(summarizeQualityForDecision(current).warnings, 2);
  assert.equal(summarizeQualityForDecision(candidate).warnings, 1);
});

test("quality candidate rejects repairs that add blocking issues", () => {
  const current = report({
    score: 62,
    issues: [{ check: "reviewer.depth", severity: "warning", message: "局部表述问题。", source: "REVIEWER" }],
  });
  const candidate = report({
    score: 70,
    issues: [{ check: "reviewer.continuity", severity: "warning", message: "提前展开后续章节。", source: "REVIEWER" }],
  });

  assert.equal(shouldAcceptQualityCandidate(current, candidate), false);
});
