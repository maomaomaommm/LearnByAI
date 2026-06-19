import { parseJson } from "../ai";
import { normalizeChapterMarkdownHeading } from "../chapterHeadings";
import { appendJobEvent, createGenerationJob, completeGenerationJob, failGenerationJob, getGenerationJob, patchGenerationJob } from "../jobs";
import { repairInvalidJsonEscapes } from "../jsonRepair";
import { ModelOverrides } from "../modelOverrides";
import { createMockAnswer, createMockChapter, createMockCourse } from "../mock";
import { buildAnnotationTutorPrompt } from "../prompts/annotationTutor";
import { buildChapterRepairPrompt, buildChapterRepairByAuthorPrompt, buildChapterChunkRepairByAuthorPrompt } from "../prompts/chapterRepairer";
import { buildChapterReviewPrompt, buildChapterReviewJsonRepairPrompt } from "../prompts/chapterReviewer";
import { buildChapterWriterPrompt, getEffectiveChapterLengthGuide } from "../prompts/chapterWriter";
import { buildContentRepairPrompt } from "../prompts/contentRepair";
import {
  buildChapterContractCompactPrompt,
  buildChapterContractPrompt,
  buildCourseBibleCompactPrompt,
  buildCourseBiblePrompt,
  buildCourseSkeletonCompactPrompt,
  buildCourseSkeletonPrompt,
} from "../prompts/coursePlanner";
import type { CourseBibleCore, CourseSkeleton } from "../prompts/coursePlanner";
import { buildFormatGuardPrompt, postRepairMarkdown, preRepairMarkdown } from "../prompts/formatGuard";
import { runChapterQualityPipelineWithRepair } from "../quality/pipeline";
import { safeErrorMessage } from "../safeError";
import { Chapter, ChapterContract, ChapterGenerateResponse, Course, CourseBible, CourseCreateResponse, GenerationJob, GenerationProfile, QualityIssue, QualityReport, Section } from "../types";
import { researchLatestCourseKnowledge } from "../webResearch";
import { dispatchAgentText } from "./dispatcher";
import { assertMockFallbackAllowed } from "./fallback";
import { markdownToSections } from "./integrator";

export type CourseInput = {
  topic: string;
  goal: string;
  background: string;
  preference: string;
  weeklyHours: number;
  chapterLength?: "short" | "medium" | "long";
  generationProfile?: GenerationProfile;
};

export type CourseGeneration = {
  profile: string;
  courseBible: CourseBible;
  chapters: Omit<Chapter, "id" | "content" | "review" | "status">[];
};

export type ChapterDraftResponse = {
  content: string;
  sections: Section[];
  review: string;
  job?: GenerationJob;
};

const COURSE_PLANNER_STAGE_TIMEOUT_MS = 360_000;
const CHUNKED_REPAIR_MIN_CHARS = 8_000;
const REPAIR_CHUNK_MAX_CHARS = 2_400;
const REPAIR_CHUNK_MAX_TOKENS = 4_096;
const REPAIR_CHUNK_TIMEOUT_MS = 45_000;
const REPAIR_CHUNK_CONCURRENCY = 2;
const TUTOR_TIMEOUT_MS = 60_000;
const TUTOR_REPAIR_TIMEOUT_MS = 60_000;
const MAX_LONG_TEXT_REPAIR_ATTEMPTS = 3;
const MAX_REVIEW_REPAIR_ATTEMPTS = 3;
const REMOTE_FORMAT_GUARD_MAX_CHARS = 15_000;
const CHUNKED_FORMAT_GUARD_MIN_CHARS = 8_000;
const polisherFuseByJob = new Map<string, string>();

function polisherFuseReason(jobId: string) {
  return polisherFuseByJob.get(jobId);
}

async function markPolisherFused(
  jobId: string,
  error: unknown,
  onJobUpdate?: (job: GenerationJob) => Promise<void> | void,
) {
  const reason = safeErrorMessage(error, "POLISHER permanent provider error.");
  polisherFuseByJob.set(jobId, reason);
  const fusedJob = appendJobEvent(jobId, {
    agent: "POLISHER",
    status: "running",
    message: `POLISHER disabled for this job after permanent provider error: ${reason}.`,
  }, { preserveJobStatus: true });
  if (fusedJob) await onJobUpdate?.(fusedJob);
}

function isPermanentPolisherProviderError(error: unknown) {
  const message = safeErrorMessage(error, "");
  if (/429|5\d\d|timeout|timed out|fetch failed|network|socket|econnreset|etimedout/i.test(message)) return false;
  return /(^|\D)400(\D|$)|invalid thinking|invalid temperature|invalid_request|unsupported parameter|bad request/i.test(message);
}

async function runInBatches<T, R>(
  items: T[],
  batchSize: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map((item, j) => fn(item, i + j)));
    for (let j = 0; j < batch.length; j += 1) {
      results[i + j] = batchResults[j]!;
    }
  }
  return results;
}

export async function generateCourse(input: CourseInput, options: { overrides?: ModelOverrides } = {}): Promise<CourseCreateResponse> {
  const job = createGenerationJob({
    type: "course",
    activeAgent: "ARCHITECT",
    status: "running",
    message: "Course generation started.",
  });

  try {
    const generated = await planCourseOutline(input, job.id, { overrides: options.overrides });
    const firstChapterJob = createGenerationJob({
      type: "chapter",
      activeAgent: "AUTHOR",
      status: "queued",
      message: "First chapter queued for background generation.",
    });
    const course: Course = {
      id: crypto.randomUUID(),
      ...input,
      profile: generated.profile,
      courseBible: generated.courseBible,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      generationJobId: job.id,
      chapters: generated.chapters.map((chapter, index) => ({
        ...chapter,
        id: crypto.randomUUID(),
        status: index === 0 ? "queued" : "pending",
        generationJobId: index === 0 ? firstChapterJob.id : undefined,
      })),
    };

    const firstChapter = course.chapters[0];
    patchGenerationJob(job.id, {
      courseId: course.id,
    });
    if (firstChapter) {
      patchGenerationJob(firstChapterJob.id, {
        courseId: course.id,
        chapterId: firstChapter.id,
      });
    }

    completeGenerationJob(job.id, course.id);
    return { course, job: getGenerationJob(job.id) };
  } catch (error) {
    failGenerationJob(job.id, safeErrorMessage(error, "Course generation failed."));
    assertMockFallbackAllowed(error, options.overrides, "ARCHITECT");
    const course = createMockCourse(input);
    course.generationJobId = job.id;
    return { course, job: getGenerationJob(job.id) };
  }
}

export async function generateChapter(
  course: Course,
  chapter: Chapter,
  options: {
    jobId?: string;
    overrides?: ModelOverrides;
    onJobUpdate?: (job: GenerationJob) => Promise<void> | void;
    onStage?: (stage: ChapterGenerationStage) => Promise<void> | void;
  } = {},
): Promise<ChapterGenerateResponse> {
  const existingJob = options.jobId ? getGenerationJob(options.jobId) : undefined;
  const job = existingJob
    ? patchGenerationJob(existingJob.id, {
        courseId: course.id,
        chapterId: chapter.id,
        activeAgent: "AUTHOR",
        status: "running",
        modelOverrides: options.overrides ?? existingJob.modelOverrides,
      })!
    : createGenerationJob({
        type: "chapter",
        courseId: course.id,
        chapterId: chapter.id,
        activeAgent: "AUTHOR",
        status: "running",
        modelOverrides: options.overrides,
        message: "Chapter generation started.",
      });

  if (existingJob) {
    appendJobEvent(job.id, {
      agent: "AUTHOR",
      status: "running",
      message: "Queued chapter generation resumed.",
    });
  }

  try {
    const lengthGuide = getEffectiveChapterLengthGuide(course);
    const draft = preRepairMarkdown(
      await dispatchAgentText({
        agent: "AUTHOR",
        jobId: job.id,
        prompt: buildChapterWriterPrompt(course, chapter, {
          chapterIndex: course.chapters.findIndex((item) => item.id === chapter.id),
          chapters: course.chapters,
        }),
        temperature: 0.45,
        maxTokens: lengthGuide.maxTokens,
        overrides: options.overrides,
        mock: () => createMockChapter(course.topic, chapter.title, course.goal),
        onJobUpdate: options.onJobUpdate,
      }),
    );

    await options.onStage?.({
      stage: "draft",
      content: draft,
      sections: markdownToSections(chapter, draft),
      review: "\u8349\u7a3f\u5df2\u4fdd\u5b58\uff0c\u683c\u5f0f\u4fee\u590d\u548c\u8d28\u91cf\u68c0\u67e5\u4ecd\u5728\u7ee7\u7eed\u3002",
    });

    let formatted = draft;
    let review = "正文已生成；格式修复暂时不可用，已保留本地格式预修复版本。";

    try {
      if (shouldSkipRemoteFormatGuard(draft)) {
        throw new Error("Long draft uses local format guard before targeted review repair.");
      }
      formatted = await runFormatGuard(draft, {
        jobId: job.id,
        overrides: options.overrides,
        maxTokens: lengthGuide.maxTokens,
        onJobUpdate: options.onJobUpdate,
      });
      review = "已通过格式修复，完成 Markdown、公式、代码块与标题格式检查。";
    } catch (error) {
      formatted = postRepairMarkdown(draft);
      review = `格式修复模型暂时不可用，已使用本地格式修复保留草稿：${safeErrorMessage(error, "POLISHER failed.")}`;
    }

    await options.onStage?.({
      stage: "polished",
      content: formatted,
      sections: markdownToSections(chapter, formatted),
      review,
    });

    const quality = await reviewChapterWithRepair(course, chapter, formatted, job.id, options.onJobUpdate, options.overrides, lengthGuide.maxTokens);
    formatted = normalizeChapterMarkdownHeading(course, chapter, quality.content);
    const qualityReport = quality.report;
    const sections = markdownToSections(chapter, formatted);
    completeGenerationJob(job.id, chapter.id);
    polisherFuseByJob.delete(job.id);

    return {
      content: formatted,
      sections,
      review,
      qualityReport,
      job: getGenerationJob(job.id),
    };
  } catch (error) {
    const failedJob = failGenerationJob(job.id, safeErrorMessage(error, "Chapter generation failed."));
    if (failedJob) await options.onJobUpdate?.(failedJob);
    assertMockFallbackAllowed(error, options.overrides, "AUTHOR");
    const fallback = createMockChapter(course.topic, chapter.title, course.goal);
    const quality = await reviewChapterWithRepair(course, chapter, fallback, job.id, options.onJobUpdate, options.overrides);
    const repairedFallback = normalizeChapterMarkdownHeading(course, chapter, quality.content);
    const qualityReport = quality.report;
    const sections: Section[] = markdownToSections(chapter, repairedFallback);
    return {
      content: repairedFallback,
      sections,
      review: "\u5df2\u964d\u7ea7\u4e3a\u6a21\u62df\u5185\u5bb9\u3002",
      qualityReport,
      job: getGenerationJob(job.id),
    };
  }
}

export async function generateChapterDraft(
  course: Course,
  chapter: Chapter,
  options: {
    jobId?: string;
    overrides?: ModelOverrides;
    onJobUpdate?: (job: GenerationJob) => Promise<void> | void;
    onStage?: (stage: ChapterGenerationStage) => Promise<void> | void;
  } = {},
): Promise<ChapterDraftResponse> {
  const existingJob = options.jobId ? getGenerationJob(options.jobId) : undefined;
  const job = existingJob
    ? patchGenerationJob(existingJob.id, {
        courseId: course.id,
        chapterId: chapter.id,
        activeAgent: "AUTHOR",
        status: "running",
        modelOverrides: options.overrides ?? existingJob.modelOverrides,
      })!
    : createGenerationJob({
        type: "chapter",
        courseId: course.id,
        chapterId: chapter.id,
        activeAgent: "AUTHOR",
        status: "running",
        modelOverrides: options.overrides,
        message: "Chapter draft generation started.",
      });

  if (existingJob) {
    appendJobEvent(job.id, {
      agent: "AUTHOR",
      status: "running",
      message: "Queued chapter draft generation resumed.",
    });
  }

  try {
    const lengthGuide = getEffectiveChapterLengthGuide(course);
    const draft = normalizeChapterMarkdownHeading(
      course,
      chapter,
      preRepairMarkdown(
        await dispatchAgentText({
          agent: "AUTHOR",
          jobId: job.id,
          prompt: buildChapterWriterPrompt(course, chapter, {
            chapterIndex: course.chapters.findIndex((item) => item.id === chapter.id),
            chapters: course.chapters,
          }),
          temperature: 0.45,
          maxTokens: lengthGuide.maxTokens,
          overrides: options.overrides,
          mock: () => createMockChapter(course.topic, chapter.title, course.goal),
          onJobUpdate: options.onJobUpdate,
        }),
      ),
    );
    const sections = markdownToSections(chapter, draft);
    const review = "草稿已保存，格式修复和质量检查将在后台继续。";

    await options.onStage?.({
      stage: "draft",
      content: draft,
      sections,
      review,
    });

    const completedJob = completeGenerationJob(job.id, chapter.id);
    if (completedJob) await options.onJobUpdate?.(completedJob);
    polisherFuseByJob.delete(job.id);

    return {
      content: draft,
      sections,
      review,
      job: getGenerationJob(job.id),
    };
  } catch (error) {
    const failedJob = failGenerationJob(job.id, safeErrorMessage(error, "Chapter draft generation failed."));
    if (failedJob) await options.onJobUpdate?.(failedJob);
    assertMockFallbackAllowed(error, options.overrides, "AUTHOR");
    const fallback = normalizeChapterMarkdownHeading(course, chapter, createMockChapter(course.topic, chapter.title, course.goal));
    return {
      content: fallback,
      sections: markdownToSections(chapter, fallback),
      review: "已降级为模拟草稿。",
      job: getGenerationJob(job.id),
    };
  }
}

export async function reviewExistingChapterDraft(
  course: Course,
  chapter: Chapter,
  content: string,
  options: {
    jobId: string;
    overrides?: ModelOverrides;
    onJobUpdate?: (job: GenerationJob) => Promise<void> | void;
    onStage?: (stage: ChapterGenerationStage) => Promise<void> | void;
  },
): Promise<ChapterGenerateResponse> {
  const existingJob = getGenerationJob(options.jobId);
  const job = existingJob
    ? patchGenerationJob(existingJob.id, {
        courseId: course.id,
        chapterId: chapter.id,
        activeAgent: "POLISHER",
        status: "running",
        modelOverrides: options.overrides ?? existingJob.modelOverrides,
      })!
    : createGenerationJob({
        type: "chapter",
        mode: "review_draft",
        courseId: course.id,
        chapterId: chapter.id,
        activeAgent: "POLISHER",
        status: "running",
        modelOverrides: options.overrides,
        message: "Draft quality review started.",
      });

  appendJobEvent(job.id, {
    agent: "POLISHER",
    status: "running",
    message: "Existing draft review resumed.",
  });

  const lengthGuide = getEffectiveChapterLengthGuide(course);
  const draft = preRepairMarkdown(content);
  let formatted = draft;
  let review = "正文已生成；格式修复暂时不可用，已保留本地格式预修复版本。";

  try {
    if (shouldSkipRemoteFormatGuard(draft)) {
      throw new Error("Long draft uses local format guard before targeted review repair.");
    }
    formatted = await runFormatGuard(draft, {
      jobId: job.id,
      overrides: options.overrides,
      maxTokens: lengthGuide.maxTokens,
      onJobUpdate: options.onJobUpdate,
    });
    review = "已通过格式修复，完成 Markdown、公式、代码块与标题格式检查。";
  } catch (error) {
    formatted = postRepairMarkdown(draft);
    review = `格式修复模型暂时不可用，已使用本地格式修复保留草稿：${safeErrorMessage(error, "POLISHER failed.")}`;
  }

  await options.onStage?.({
    stage: "polished",
    content: formatted,
    sections: markdownToSections(chapter, formatted),
    review,
  });

  const quality = await reviewChapterWithRepair(course, chapter, formatted, job.id, options.onJobUpdate, options.overrides, lengthGuide.maxTokens);
  formatted = normalizeChapterMarkdownHeading(course, chapter, quality.content);
  const qualityReport = quality.report;
  const sections = markdownToSections(chapter, formatted);
  completeGenerationJob(job.id, chapter.id);
  polisherFuseByJob.delete(job.id);

  return {
    content: formatted,
    sections,
    review,
    qualityReport,
    job: getGenerationJob(job.id),
  };
}

export type ChapterGenerationStage = {
  stage: "draft" | "polished";
  content: string;
  sections: Section[];
  review: string;
};

type ReviewerJson = {
  passed?: boolean;
  issues?: {
    severity?: "low" | "medium" | "high";
    category?: string;
    message?: string;
    suggestion?: string;
  }[];
  summary?: string;
};

async function reviewChapter(
  course: Course,
  chapter: Chapter,
  content: string,
  jobId: string,
  onJobUpdate?: (job: GenerationJob) => Promise<void> | void,
  overrides?: ModelOverrides,
) {
  const quality = runChapterQualityPipelineWithRepair(chapter, content, postRepairMarkdown);
  const report = quality.report;
  let lastReviewerText: string | undefined;

  try {
    const reviewerText = await dispatchAgentText({
      agent: "REVIEWER",
      jobId,
      prompt: buildChapterReviewPrompt(course, chapter, quality.content),
      temperature: 0.2,
      maxTokens: 4096,
      responseFormat: "json_object",
      overrides,
      onJobUpdate,
      mock: () =>
        JSON.stringify({
          passed: report.status !== "failed",
          issues: [],
          summary: `TQH baseline score ${report.score}.`,
        }),
    });
    lastReviewerText = reviewerText;
    let reviewer = parseJson<ReviewerJson>(reviewerText);
    if (!Array.isArray(reviewer.issues)) {
      reviewer = { ...reviewer, issues: [] };
    }
    const reviewerIssues =
      reviewer.issues?.map((issue) => ({
        check: `reviewer.${issue.category ?? "general"}`,
        severity:
          issue.severity === "high"
            ? ("error" as const)
            : issue.severity === "medium"
              ? ("warning" as const)
              : ("info" as const),
        message: issue.message ?? "Reviewer flagged an issue.",
        suggestion: issue.suggestion,
        source: "REVIEWER" as const,
      })) ?? [];

    const issues = [
      ...report.issues.map((issue) => ({ ...issue, source: issue.source ?? ("TQH" as const) })),
      ...reviewerIssues,
    ];
    const score = Math.max(
      0,
      report.score - reviewerIssues.reduce((total, issue) => total + (issue.severity === "error" ? 20 : issue.severity === "warning" ? 8 : 2), 0),
    );

    return {
      content: quality.content,
      attempts: quality.attempts,
      report: {
      ...report,
      issues,
      score,
      status: issues.some((issue) => issue.severity === "error") || score < 80
        ? ("failed" as const)
        : issues.length > 0
          ? ("warning" as const)
          : ("passed" as const),
      },
    };
  } catch (error) {
    const repaired = await parseReviewerJsonWithRepair(lastReviewerText, String(error), jobId, overrides, onJobUpdate);
    if (repaired) {
      const issues = [...report.issues.map((issue) => ({ ...issue, source: issue.source ?? ("TQH" as const) })), ...repaired.issues];
      const score = Math.max(0, report.score - repaired.issues.reduce((total, issue) => total + (issue.severity === "error" ? 20 : issue.severity === "warning" ? 8 : 2), 0));
      return {
        content: quality.content,
        attempts: quality.attempts,
        report: {
          ...report,
          issues,
          score,
          status: issues.some((issue) => issue.severity === "error") || score < 80
            ? ("failed" as const)
            : issues.length > 0
              ? ("warning" as const)
              : ("passed" as const),
        },
      };
    }

    return {
      content: quality.content,
      attempts: quality.attempts,
      report: {
      ...report,
      issues: [
        ...report.issues.map((issue) => ({ ...issue, source: issue.source ?? ("TQH" as const) })),
        {
          check: "reviewer.unavailable",
          severity: "warning" as const,
          message: `REVIEWER 暂时不可用，已保留 TQH 本地质检结果：${safeErrorMessage(error, "REVIEWER failed.")}`,
          suggestion: "稍后可重新质检或重新生成；当前章节不再因为质检模型异常而卡死。",
          source: "REVIEWER" as const,
        },
      ],
      status: report.status === "failed" ? report.status : ("warning" as const),
      score: Math.max(0, report.score - 5),
      },
    };
  }
}

async function parseReviewerJsonWithRepair(
  badJson: string | undefined,
  parseError: string,
  jobId: string,
  overrides?: ModelOverrides,
  onJobUpdate?: (job: GenerationJob) => Promise<void> | void,
): Promise<{ issues: { check: string; severity: "error" | "warning" | "info"; message: string; suggestion?: string; source: "REVIEWER" }[]; score: number } | undefined> {
  if (!badJson) return undefined;
  const noticeJob = appendJobEvent(jobId, {
    agent: "REVIEWER",
    status: "running",
    message: "REVIEWER JSON parse failed; attempting JSON repair.",
  }, { preserveJobStatus: true });
  if (noticeJob) await onJobUpdate?.(noticeJob);
  try {
    const repairedText = await dispatchAgentText({
      agent: "ASSISTANT",
      prompt: buildChapterReviewJsonRepairPrompt(badJson, parseError),
      temperature: 0.1,
      maxTokens: 4096,
      responseFormat: "json_object",
      overrides,
      onJobUpdate,
      mock: () => JSON.stringify({ passed: true, issues: [], summary: "REVIEWER JSON repaired." }),
    });
    const repaired = parseJson<ReviewerJson>(repairInvalidJsonEscapes(repairedText));
    if (!Array.isArray(repaired.issues)) {
      return undefined;
    }
    const issues = repaired.issues.map((issue) => ({
      check: `reviewer.${issue.category ?? "general"}`,
      severity:
        issue.severity === "high"
          ? ("error" as const)
          : issue.severity === "medium"
            ? ("warning" as const)
            : ("info" as const),
      message: issue.message ?? "Reviewer flagged an issue.",
      suggestion: issue.suggestion,
      source: "REVIEWER" as const,
    }));
    const score = Math.max(
      0,
      100 - issues.reduce((total, issue) => total + (issue.severity === "error" ? 20 : issue.severity === "warning" ? 8 : 2), 0),
    );
    return { issues, score };
  } catch {
    return undefined;
  }
}

function shouldSkipRemoteFormatGuard(content: string) {
  return false;
}

async function reviewChapterWithRepair(
  course: Course,
  chapter: Chapter,
  content: string,
  jobId: string,
  onJobUpdate?: (job: GenerationJob) => Promise<void> | void,
  overrides?: ModelOverrides,
  maxTokens = 18432,
) {
  let best: { content: string; attempts: number; report: QualityReport } = await reviewChapter(
    course,
    chapter,
    content,
    jobId,
    onJobUpdate,
    overrides,
  );
  if (shouldEscalateToAuthorRewrite(best.report)) {
    return withAuthorRewriteRequiredIssue(best);
  }
  let bestScore = best.report.score;
  let currentContent = best.content;

  const maxRepairAttempts = shouldUseChunkedRepair(content) ? MAX_LONG_TEXT_REPAIR_ATTEMPTS : MAX_REVIEW_REPAIR_ATTEMPTS;

  for (let attempt = 1; attempt <= maxRepairAttempts && shouldRepairQuality(best.report.issues, best.report.score); attempt += 1) {
    const repairIssues = best.report.issues
      .filter((issue) => issue.severity === "error" || issue.severity === "warning")
      .slice(0, 10);
    if (!repairIssues.length) break;

    let repaired: string;
    try {
      repaired = await repairChapterContentByAuthor(course, chapter, currentContent, repairIssues, {
        jobId,
        onJobUpdate,
        overrides,
        maxTokens,
      });
    } catch (error) {
      const errorMessage = safeErrorMessage(error, "AUTHOR repair failed");
      appendJobEvent(jobId, {
        agent: "AUTHOR",
        status: "running",
        message: `Repair attempt ${attempt} failed: ${errorMessage}. Continuing with best available content.`,
      }, { preserveJobStatus: true });
      if (attempt >= maxRepairAttempts) {
        return withRepairUnavailableIssue(best, error);
      }
      continue;
    }
    currentContent = repaired;

    try {
      const polished = await runFormatGuard(repaired, {
        jobId,
        overrides,
        maxTokens,
        onJobUpdate,
      });
      currentContent = polished;
    } catch (error) {
      const polishErrorMessage = safeErrorMessage(error, "Format guard after repair failed");
      appendJobEvent(jobId, {
        agent: "POLISHER",
        status: "running",
        message: `Post-repair format guard failed: ${polishErrorMessage}. Continuing with AUTHOR repaired content.`,
      }, { preserveJobStatus: true });
    }

    let reviewed: Awaited<ReturnType<typeof reviewChapter>>;
    try {
      reviewed = await reviewChapter(course, chapter, currentContent, jobId, onJobUpdate, overrides);
    } catch (error) {
      const errorMessage = safeErrorMessage(error, "REVIEWER failed");
      appendJobEvent(jobId, {
        agent: "REVIEWER",
        status: "running",
        message: `Review after repair ${attempt} failed: ${errorMessage}. Using previous best.`,
      }, { preserveJobStatus: true });
      if (attempt >= maxRepairAttempts) {
        return best;
      }
      continue;
    }
    const report = finalizeQualityReport(reviewed.report, attempt);
    const candidate = { ...reviewed, report };
    if (candidate.report.score >= bestScore) {
      best = candidate;
      bestScore = candidate.report.score;
    }
    if (!hasWarningOrError(candidate.report.issues) || (candidate.report.score >= 95 && !candidate.report.issues.some((issue: QualityIssue) => issue.severity === "error"))) {
      return candidate;
    }
  }

  return { ...best, report: finalizeQualityReport(best.report, maxRepairAttempts) };
}

function finalizeQualityReport(report: QualityReport, attempts: number): QualityReport {
  const passed = report.status !== "failed" && report.score >= 80;
  return {
    ...report,
    id: passed ? crypto.randomUUID() : report.id,
    createdAt: new Date().toISOString(),
    issues: [
      ...report.issues.filter((issue) => issue.check !== "review_repair.attempts"),
      {
        check: "review_repair.attempts",
        severity: report.status === "failed" ? ("warning" as const) : ("info" as const),
        message: `Reviewer repair attempts: ${attempts}, final score: ${report.score}.`,
        suggestion: report.status === "failed" ? "Keep the best available draft and show quality issues in the UI." : "Chapter passed automatic repair.",
        source: "TQH" as const,
      },
    ],
  };
}

async function repairChapterContent(
  course: Course,
  chapter: Chapter,
  content: string,
  repairIssues: QualityIssue[],
  options: {
    jobId: string;
    onJobUpdate?: (job: GenerationJob) => Promise<void> | void;
    overrides?: ModelOverrides;
    maxTokens: number;
  },
) {
  if (shouldUseChunkedRepair(content)) {
    return repairChapterInChunks(course, chapter, content, repairIssues, options);
  }

  try {
    return postRepairMarkdown(
      await dispatchPolisherRepairText({
        jobId: options.jobId,
        prompt: buildChapterRepairPrompt(course, chapter, content, repairIssues),
        temperature: 0.15,
        maxTokens: options.maxTokens,
        overrides: options.overrides,
        onJobUpdate: options.onJobUpdate,
        mock: () => postRepairMarkdown(content),
      }),
    );
  } catch (error) {
    if (content.length < CHUNKED_REPAIR_MIN_CHARS) throw error;
    return repairChapterInChunks(course, chapter, content, repairIssues, options);
  }
}

async function repairChapterInChunks(
  course: Course,
  chapter: Chapter,
  content: string,
  repairIssues: QualityIssue[],
  options: {
    jobId: string;
    onJobUpdate?: (job: GenerationJob) => Promise<void> | void;
    overrides?: ModelOverrides;
    maxTokens: number;
  },
) {
  const chunks = splitMarkdownForRepair(content);
  if (chunks.length <= 1) {
    return postRepairMarkdown(
      await dispatchAgentText({
        agent: "POLISHER",
        jobId: options.jobId,
        prompt: buildChapterRepairPrompt(course, chapter, content, repairIssues),
        temperature: 0.15,
        maxTokens: options.maxTokens,
        overrides: options.overrides,
        onJobUpdate: options.onJobUpdate,
        mock: () => postRepairMarkdown(content),
      }),
    );
  }

  const repairedChunks = await runInBatches(chunks, REPAIR_CHUNK_CONCURRENCY, async (chunk, index) => {
    try {
      const repairedChunk = await dispatchPolisherRepairText({
        jobId: options.jobId,
        prompt: buildChapterChunkRepairPrompt(course, chapter, chunk, repairIssues, index + 1, chunks.length),
        temperature: 0.15,
        maxTokens: Math.min(options.maxTokens, REPAIR_CHUNK_MAX_TOKENS),
        timeoutMs: REPAIR_CHUNK_TIMEOUT_MS,
        maxAttempts: 1,
        stream: true,
        overrides: options.overrides,
        onJobUpdate: options.onJobUpdate,
        mock: () => chunk,
      });
      return postRepairMarkdown(repairedChunk);
    } catch (error) {
      const skippedJob = appendJobEvent(options.jobId, {
        agent: "POLISHER",
        status: "running",
        message: `Chunk ${index + 1}/${chunks.length} repair skipped: ${safeErrorMessage(error, "POLISHER chunk failed.")}`,
      }, { preserveJobStatus: true });
      if (skippedJob) await options.onJobUpdate?.(skippedJob);
      return postRepairMarkdown(chunk);
    }
  });

  return postRepairMarkdown(repairedChunks.join("\n\n"));
}

async function repairChapterContentByAuthor(
  course: Course,
  chapter: Chapter,
  content: string,
  repairIssues: QualityIssue[],
  options: {
    jobId: string;
    onJobUpdate?: (job: GenerationJob) => Promise<void> | void;
    overrides?: ModelOverrides;
    maxTokens: number;
  },
) {
  if (shouldUseChunkedRepair(content)) {
    return repairChapterInChunksByAuthor(course, chapter, content, repairIssues, options);
  }

  try {
    return postRepairMarkdown(
      await dispatchAgentText({
        agent: "AUTHOR",
        jobId: options.jobId,
        prompt: buildChapterRepairByAuthorPrompt(course, chapter, content, repairIssues),
        temperature: 0.3,
        maxTokens: options.maxTokens,
        overrides: options.overrides,
        onJobUpdate: options.onJobUpdate,
        mock: () => postRepairMarkdown(content),
      }),
    );
  } catch (error) {
    if (content.length < CHUNKED_REPAIR_MIN_CHARS) throw error;
    return repairChapterInChunksByAuthor(course, chapter, content, repairIssues, options);
  }
}

async function repairChapterInChunksByAuthor(
  course: Course,
  chapter: Chapter,
  content: string,
  repairIssues: QualityIssue[],
  options: {
    jobId: string;
    onJobUpdate?: (job: GenerationJob) => Promise<void> | void;
    overrides?: ModelOverrides;
    maxTokens: number;
  },
) {
  const chunks = splitMarkdownForRepair(content);
  if (chunks.length <= 1) {
    return postRepairMarkdown(
      await dispatchAgentText({
        agent: "AUTHOR",
        jobId: options.jobId,
        prompt: buildChapterRepairByAuthorPrompt(course, chapter, content, repairIssues),
        temperature: 0.3,
        maxTokens: options.maxTokens,
        overrides: options.overrides,
        onJobUpdate: options.onJobUpdate,
        mock: () => postRepairMarkdown(content),
      }),
    );
  }

  const repairedChunks = await runInBatches(chunks, REPAIR_CHUNK_CONCURRENCY, async (chunk, index) => {
    try {
      const repairedChunk = await dispatchAgentText({
        agent: "AUTHOR",
        jobId: options.jobId,
        prompt: buildChapterChunkRepairByAuthorPrompt(course, chapter, chunk, repairIssues, index + 1, chunks.length),
        temperature: 0.3,
        maxTokens: Math.min(options.maxTokens, REPAIR_CHUNK_MAX_TOKENS),
        timeoutMs: REPAIR_CHUNK_TIMEOUT_MS,
        maxAttempts: 1,
        stream: true,
        overrides: options.overrides,
        onJobUpdate: options.onJobUpdate,
        mock: () => chunk,
      });
      const polishedChunk = postRepairMarkdown(repairedChunk);
      const validation = validateRepairedChunk(chunk, polishedChunk, chapter.title);
      if (validation) {
        throw new Error(validation);
      }
      return polishedChunk;
    } catch (error) {
      const skippedJob = appendJobEvent(options.jobId, {
        agent: "AUTHOR",
        status: "running",
        message: `Chunk ${index + 1}/${chunks.length} repair skipped: ${safeErrorMessage(error, "AUTHOR chunk failed.")}`,
      }, { preserveJobStatus: true });
      if (skippedJob) await options.onJobUpdate?.(skippedJob);
      return postRepairMarkdown(chunk);
    }
  });

  return postRepairMarkdown(repairedChunks.join("\n\n"));
}

async function dispatchPolisherRepairText(input: {
  jobId: string;
  prompt: string;
  temperature: number;
  maxTokens: number;
  timeoutMs?: number;
  maxAttempts?: number;
  stream?: boolean;
  overrides?: ModelOverrides;
  onJobUpdate?: (job: GenerationJob) => Promise<void> | void;
  mock: () => string;
}) {
  const fusedReason = polisherFuseReason(input.jobId);
  if (fusedReason) {
    const fallbackJob = appendJobEvent(input.jobId, {
      agent: "ASSISTANT",
      status: "running",
      message: `POLISHER repair skipped because provider is disabled for this job: ${fusedReason}`,
    }, { preserveJobStatus: true });
    if (fallbackJob) await input.onJobUpdate?.(fallbackJob);

    return dispatchAgentText({
      agent: "ASSISTANT",
      jobId: input.jobId,
      prompt: buildDefaultRepairFallbackPrompt(input.prompt),
      temperature: input.temperature,
      maxTokens: input.maxTokens,
      timeoutMs: input.timeoutMs,
      maxAttempts: input.maxAttempts,
      stream: input.stream,
      overrides: input.overrides,
      onJobUpdate: input.onJobUpdate,
      mock: input.mock,
    });
  }

  try {
    return await dispatchAgentText({
      agent: "POLISHER",
      ...input,
    });
  } catch (error) {
    if (isPermanentPolisherProviderError(error)) {
      await markPolisherFused(input.jobId, error, input.onJobUpdate);
    }
    const fallbackJob = appendJobEvent(input.jobId, {
      agent: "ASSISTANT",
      status: "running",
      message: `POLISHER repair fallback started: ${safeErrorMessage(error, "POLISHER failed.")}`,
    }, { preserveJobStatus: true });
    if (fallbackJob) await input.onJobUpdate?.(fallbackJob);

    return dispatchAgentText({
      agent: "ASSISTANT",
      jobId: input.jobId,
      prompt: buildDefaultRepairFallbackPrompt(input.prompt),
      temperature: input.temperature,
      maxTokens: input.maxTokens,
      timeoutMs: input.timeoutMs,
      maxAttempts: input.maxAttempts,
      stream: input.stream,
      overrides: input.overrides,
      onJobUpdate: input.onJobUpdate,
      mock: input.mock,
    });
  }
}

async function runRemoteFormatGuard(
  content: string,
  options: {
    jobId: string;
    overrides?: ModelOverrides;
    maxTokens: number;
    onJobUpdate?: (job: GenerationJob) => Promise<void> | void;
  },
) {
  if (content.length > REMOTE_FORMAT_GUARD_MAX_CHARS) {
    throw new Error(`Content too long for remote format guard: ${content.length} chars.`);
  }
  return postRepairMarkdown(
    await dispatchPolisherRepairText({
      jobId: options.jobId,
      prompt: buildFormatGuardPrompt(content),
      temperature: 0.1,
      maxTokens: options.maxTokens,
      overrides: options.overrides,
      onJobUpdate: options.onJobUpdate,
      mock: () => content,
    }),
  );
}

async function runChunkedFormatGuard(
  content: string,
  options: {
    jobId: string;
    overrides?: ModelOverrides;
    maxTokens: number;
    onJobUpdate?: (job: GenerationJob) => Promise<void> | void;
  },
) {
  const chunks = splitMarkdownForRepair(content);
  if (chunks.length <= 1) {
    return runRemoteFormatGuard(content, options);
  }
  const repairedChunks = await runInBatches(chunks, REPAIR_CHUNK_CONCURRENCY, async (chunk, index) => {
    try {
      const repairedChunk = await dispatchPolisherRepairText({
        jobId: options.jobId,
        prompt: buildFormatGuardPrompt(chunk),
        temperature: 0.1,
        maxTokens: Math.min(options.maxTokens, REPAIR_CHUNK_MAX_TOKENS),
        timeoutMs: REPAIR_CHUNK_TIMEOUT_MS,
        maxAttempts: 1,
        stream: true,
        overrides: options.overrides,
        onJobUpdate: options.onJobUpdate,
        mock: () => chunk,
      });
      return postRepairMarkdown(repairedChunk);
    } catch (error) {
      const skippedJob = appendJobEvent(options.jobId, {
        agent: "POLISHER",
        status: "running",
        message: `Format guard chunk ${index + 1}/${chunks.length} skipped: ${safeErrorMessage(error, "POLISHER chunk failed.")}`,
      }, { preserveJobStatus: true });
      if (skippedJob) await options.onJobUpdate?.(skippedJob);
      return postRepairMarkdown(chunk);
    }
  });
  return postRepairMarkdown(repairedChunks.join("\n\n"));
}

async function runFormatGuard(content: string, options: {
  jobId: string;
  overrides?: ModelOverrides;
  maxTokens: number;
  onJobUpdate?: (job: GenerationJob) => Promise<void> | void;
}) {
  if (content.length >= CHUNKED_FORMAT_GUARD_MIN_CHARS) {
    return runChunkedFormatGuard(content, options);
  }
  return runRemoteFormatGuard(content, options);
}

function buildDefaultRepairFallbackPrompt(prompt: string) {
  return `${prompt}

Fallback instruction: the POLISHER provider is unavailable. Complete the same repair task with the default model. Output only the repaired Markdown content.`;
}

function shouldUseChunkedRepair(content: string) {
  return content.length >= CHUNKED_REPAIR_MIN_CHARS;
}

function splitMarkdownForRepair(content: string) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const chunks: string[] = [];
  let current: string[] = [];
  let currentLength = 0;

  const flush = () => {
    const chunk = current.join("\n").trim();
    if (chunk) chunks.push(chunk);
    current = [];
    currentLength = 0;
  };

  for (const line of lines) {
    const lineLength = line.length + 1;
    const startsSection = /^#{2,3}\s+\S/u.test(line);
    if (
      current.length &&
      (currentLength + lineLength > REPAIR_CHUNK_MAX_CHARS ||
        (startsSection && currentLength >= REPAIR_CHUNK_MAX_CHARS / 2))
    ) {
      flush();
    }
    current.push(line);
    currentLength += lineLength;
  }
  flush();
  return chunks;
}

function buildChapterChunkRepairPrompt(
  course: Course,
  chapter: Chapter,
  chunk: string,
  issues: QualityIssue[],
  chunkIndex: number,
  totalChunks: number,
) {
  return `# Task: Targeted Chapter Chunk Repair

You are repairing one Markdown chunk from a Chinese textbook chapter.
Output only the repaired chunk. Do not output JSON, explanations, reports, code fences around the whole answer, or content from other chunks.
Preserve the existing heading level and section scope. Fix only issues that are relevant to this chunk; if an issue belongs elsewhere, keep this chunk semantically unchanged.
Standalone formulas must use $$...$$. Code must stay in fenced code blocks.

Course topic: ${course.topic}
Chapter title: ${chapter.title}
Chunk: ${chunkIndex}/${totalChunks}

Quality issues to fix when relevant:
${issues.map((issue, index) => `${index + 1}. [${issue.severity}] ${issue.check}: ${issue.message}${issue.suggestion ? ` Suggestion: ${issue.suggestion}` : ""}`).join("\n")}

Markdown chunk:

${chunk}`;
}

function hasWarningOrError(issues: QualityIssue[]): boolean {
  return issues.some((issue) => issue.severity === "error" || issue.severity === "warning");
}

function validateRepairedChunk(original: string, repaired: string, chapterTitle: string): string | undefined {
  if (!repaired.trim()) return "repair returned empty content";
  if (/^(您好|你好|抱歉|对不起|以下是|下面是|当然|好的)[，,。\s]/u.test(repaired.trim())) {
    return "repair returned conversational text";
  }
  if (/^```[\s\S]*```$/u.test(repaired.trim())) return "repair wrapped the whole result in a code fence";
  if (original.trim().length >= 200 && repaired.trim().length < original.trim().length * 0.5) {
    return "repair shortened content too aggressively";
  }
  const originalHeading = original.split(/\r?\n/u).find((line) => /^#{2,3}\s+\S/u.test(line))?.trim();
  if (originalHeading && !repaired.includes(originalHeading)) {
    return "repair lost heading";
  }
  if (!repaired.includes(chapterTitle) && original.includes(chapterTitle)) {
    return "repair lost chapter title context";
  }
  return undefined;
}

function shouldRepairQuality(issues: QualityIssue[], score: number) {
  return score < 80 || hasWarningOrError(issues);
}

function hasCatastrophicDraftSignal(report: QualityReport) {
  return report.issues.some((issue) =>
    issue.severity === "error" &&
    (/^(structure|contract)\./u.test(issue.check) || issue.check === "format.catastrophic"),
  );
}

function isLocalRepairIssue(issue: QualityIssue) {
  return !(
    issue.severity === "error" &&
    (/^(structure|contract)\./u.test(issue.check) || issue.check === "format.catastrophic")
  );
}

function shouldEscalateToAuthorRewrite(report: QualityReport) {
  return report.score < 50 && hasCatastrophicDraftSignal(report);
}

function withAuthorRewriteRequiredIssue<T extends {
  report: { issues: QualityIssue[]; status: "passed" | "warning" | "failed"; score: number };
}>(reviewed: T) {
  return {
    ...reviewed,
    report: {
      ...reviewed.report,
      issues: [
        ...reviewed.report.issues,
        {
          check: "review_repair.author_rewrite_required",
          severity: "error" as const,
          message: "Structural or contract quality is too low; this draft requires full AUTHOR regeneration.",
          suggestion: "触发 AUTHOR 全量重写，放弃当前草稿。",
          source: "TQH" as const,
        },
      ],
      status: "failed" as const,
      score: Math.max(0, reviewed.report.score - 10),
    },
  };
}

function withRepairUnavailableIssue<T extends {
  report: { issues: QualityIssue[]; status: "passed" | "warning" | "failed"; score: number };
}>(reviewed: T, error: unknown) {
  return {
    ...reviewed,
    report: {
      ...reviewed.report,
      issues: [
        ...reviewed.report.issues,
        {
          check: "review_repair.unavailable",
          severity: "warning" as const,
          message: `自动返修暂时不可用，已保留当前最佳草稿：${safeErrorMessage(error, "repair failed.")}`,
          suggestion: "稍后可重新生成；当前章节会按已有 TQH 分数展示。",
          source: "TQH" as const,
        },
      ],
      status: reviewed.report.status === "failed" ? reviewed.report.status : ("warning" as const),
      score: reviewed.report.status === "failed" ? reviewed.report.score : Math.max(0, reviewed.report.score - 3),
    },
  };
}

export async function askTutor(input: {
  topic: string;
  selectedText: string;
  question: string;
  history?: { role: "user" | "assistant"; content: string }[];
  context?: Parameters<typeof buildAnnotationTutorPrompt>[0]["context"];
  overrides?: ModelOverrides;
  onJobUpdate?: (job: GenerationJob) => Promise<void> | void;
  onChunk?: (chunk: string) => void;
}) {
  const job = createGenerationJob({
    type: "annotation",
    activeAgent: "TUTOR",
    status: "running",
    message: "Tutor answer started.",
  });

  try {
    const answer = await dispatchAgentText({
      agent: "TUTOR",
      jobId: job.id,
      prompt: buildAnnotationTutorPrompt({
        ...input,
        history: compactTutorHistory(input.history ?? []),
      }),
      temperature: 0.3,
      maxTokens: 2048,
      timeoutMs: TUTOR_TIMEOUT_MS,
      maxAttempts: 1,
      stream: true,
      overrides: input.overrides,
      mock: () => createMockAnswer(input.selectedText, input.question),
      onJobUpdate: input.onJobUpdate,
      onChunk: input.onChunk,
    });
    completeGenerationJob(job.id);
    return { answer, job: getGenerationJob(job.id) };
  } catch (error) {
    assertMockFallbackAllowed(error, input.overrides, "TUTOR");
    const answer = createMockAnswer(input.selectedText, input.question);
    failGenerationJob(job.id, "Tutor answer failed; returned mock fallback.");
    return { answer, job: getGenerationJob(job.id) };
  }
}

export type ContentRepairSuggestion = {
  issueType: "formula_rendering" | "markdown_format" | "conceptual_error" | "wording" | "other";
  diagnosis: string;
  beforeText: string;
  afterText: string;
  confidence: "low" | "medium" | "high";
};

export async function proposeContentRepair(input: {
  course: Course;
  chapterId: string;
  sectionId?: string;
  selectedText: string;
  userMessage: string;
  overrides?: ModelOverrides;
}) {
  const raw = await dispatchAgentText({
    agent: "TUTOR",
    prompt: buildContentRepairPrompt(input),
    temperature: 0.1,
    maxTokens: 2048,
    timeoutMs: TUTOR_REPAIR_TIMEOUT_MS,
    stream: false,
    responseFormat: "json_object",
    overrides: input.overrides,
    mock: () => JSON.stringify(createMockRepairSuggestion(input.selectedText)),
  });
  const parsed = parseJson<ContentRepairSuggestion>(raw);
  return normalizeRepairSuggestion(parsed, input.selectedText);
}

function createMockRepairSuggestion(selectedText: string): ContentRepairSuggestion {
  return {
    issueType: "markdown_format",
    diagnosis: "这是一个模拟修复建议。真实模型可用时会给出具体诊断。",
    beforeText: selectedText,
    afterText: selectedText,
    confidence: "low",
  };
}

function normalizeRepairSuggestion(
  suggestion: ContentRepairSuggestion,
  selectedText: string,
): ContentRepairSuggestion {
  const confidence = ["low", "medium", "high"].includes(suggestion.confidence)
    ? suggestion.confidence
    : "low";
  const issueType = [
    "formula_rendering",
    "markdown_format",
    "conceptual_error",
    "wording",
    "other",
  ].includes(suggestion.issueType)
    ? suggestion.issueType
    : "other";

  return {
    issueType: issueType as ContentRepairSuggestion["issueType"],
    diagnosis: String(suggestion.diagnosis ?? "").trim() || "已生成局部修复建议。",
    beforeText: selectedText,
    afterText: String(suggestion.afterText ?? selectedText).trim() || selectedText,
    confidence: confidence as ContentRepairSuggestion["confidence"],
  };
}

function compactTutorHistory(history: { role: "user" | "assistant"; content: string }[]) {
  return history
    .slice(-8)
    .map((message) => ({
      role: message.role,
      content: message.content.replace(/\s+/g, " ").trim().slice(0, 1200),
    }))
    .filter((message) => message.content);
}

export async function planCourseOutline(
  input: CourseInput,
  jobId: string,
  options: { overrides?: ModelOverrides; onJobUpdate?: (job: GenerationJob) => Promise<void> | void } = {},
): Promise<CourseGeneration> {
  const maxRetries = 2;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        appendJobEvent(jobId, {
          agent: "ARCHITECT",
          status: "running",
          message: `课程规划重试第 ${attempt} 次。`,
        }, { preserveJobStatus: true });
        await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
      }

      const researchStartedJob = appendJobEvent(jobId, {
        agent: "ARCHITECT",
        status: "running",
        message: "正在联网检索最新论文与领域进展。",
      }, { preserveJobStatus: true });
      if (researchStartedJob) await options.onJobUpdate?.(researchStartedJob);

      const researchDate = new Date().toISOString().slice(0, 10);
      const researchBrief = await researchLatestCourseKnowledge(input, options.overrides).catch((error) => {
        console.warn("[coursePlanner] research failed; continuing without web research:", safeErrorMessage(error, "research failed"));
        return undefined;
      });

      const researchCompletedJob = appendJobEvent(jobId, {
        agent: "ARCHITECT",
        status: "running",
        message: `${researchBrief ? "检索完成，开始整合检索资料规划课程。" : "联网检索暂时不可用，已跳过，直接规划课程。"}`,
      }, { preserveJobStatus: true });
      if (researchCompletedJob) await options.onJobUpdate?.(researchCompletedJob);

      const plannerInput = {
        ...input,
        researchBrief,
        researchDate,
      };

      const skeletonJob = appendJobEvent(jobId, {
        agent: "ARCHITECT",
        status: "running",
        message: "正在生成章节路线。",
      }, { preserveJobStatus: true });
      if (skeletonJob) await options.onJobUpdate?.(skeletonJob);

      const skeleton = await dispatchParsedCoursePlannerStage<CourseSkeleton>(
        "章节路线",
        () => buildCourseSkeletonPrompt(plannerInput),
        (reason) => buildCourseSkeletonCompactPrompt(plannerInput, reason),
        jobId,
        options.overrides,
        8192,
        4096,
        options.onJobUpdate,
        assertCourseSkeleton,
      );

      const bibleJob = appendJobEvent(jobId, {
        agent: "ARCHITECT",
        status: "running",
        message: "章节路线完成，正在生成精简 Course Bible。",
      }, { preserveJobStatus: true });
      if (bibleJob) await options.onJobUpdate?.(bibleJob);

      const biblePayload = await dispatchParsedCoursePlannerStage<{ courseBible: CourseBibleCore }>(
        "Course Bible",
        () => buildCourseBiblePrompt(plannerInput, skeleton),
        (reason) => buildCourseBibleCompactPrompt(plannerInput, skeleton, reason),
        jobId,
        options.overrides,
        4096,
        3072,
        options.onJobUpdate,
        (value) => assertCourseBibleCore(value.courseBible, skeleton),
      );
      const courseBibleCore = biblePayload.courseBible;

      const contractsJob = appendJobEvent(jobId, {
        agent: "ARCHITECT",
        status: "running",
        message: "Course Bible 完成，正在逐章生成章节契约。",
      }, { preserveJobStatus: true });
      if (contractsJob) await options.onJobUpdate?.(contractsJob);

      const chapterContracts = await runInBatches(skeleton.chapters, 2, async (_chapter, index) => {
        const contractJob = appendJobEvent(jobId, {
          agent: "ARCHITECT",
          status: "running",
          message: `正在生成第 ${index + 1}/${skeleton.chapters.length} 章章节契约。`,
        }, { preserveJobStatus: true });
        if (contractJob) await options.onJobUpdate?.(contractJob);

        const contractPayload = await dispatchParsedCoursePlannerStage<{ contract?: ChapterContract } | ChapterContract>(
          `第 ${index + 1} 章章节契约`,
          () => buildChapterContractPrompt(plannerInput, skeleton, courseBibleCore, index),
          (reason) => buildChapterContractCompactPrompt(plannerInput, skeleton, courseBibleCore, index, reason),
          jobId,
          options.overrides,
          2048,
          1536,
          options.onJobUpdate,
          (value) => assertChapterContract(unwrapChapterContract(value), skeleton.chapters[index]?.title ?? ""),
        );
        return unwrapChapterContract(contractPayload);
      });

      const courseBible: CourseBible = {
        ...courseBibleCore,
        chapterContracts,
      };
      return mergeCoursePlanningStages(skeleton, courseBible);
    } catch (error) {
      lastError = error;
      const errorMessage = safeErrorMessage(error, "ARCHITECT failed");
      appendJobEvent(jobId, {
        agent: "ARCHITECT",
        status: "running",
        message: `课程规划失败: ${errorMessage}`,
      }, { preserveJobStatus: true });
      
      if (attempt < maxRetries) {
        continue;
      }
    }
  }

  assertMockFallbackAllowed(lastError, options.overrides, "ARCHITECT");
  const fallback = createMockCourse(input);
  return {
    profile: fallback.profile,
    courseBible: fallback.courseBible,
    chapters: fallback.chapters.map(stripGeneratedChapterFields),
  };
}

function dispatchCoursePlannerStage(
  prompt: string,
  jobId: string,
  overrides: ModelOverrides | undefined,
  maxTokens: number,
  onJobUpdate?: (job: GenerationJob) => Promise<void> | void,
) {
  return dispatchAgentText({
    agent: "ARCHITECT",
    jobId,
    prompt,
    temperature: 0.2,
    maxTokens,
    timeoutMs: COURSE_PLANNER_STAGE_TIMEOUT_MS,
    maxAttempts: 1,
    stream: true,
    responseFormat: "json_object",
    overrides,
    mock: () => "{}",
    onJobUpdate,
  });
}

async function dispatchParsedCoursePlannerStage<T>(
  stageLabel: string,
  prompt: () => string,
  compactPrompt: (reason: string) => string,
  jobId: string,
  overrides: ModelOverrides | undefined,
  maxTokens: number,
  compactMaxTokens: number,
  onJobUpdate: ((job: GenerationJob) => Promise<void> | void) | undefined,
  validate?: (value: T) => void,
) {
  try {
    const text = await dispatchCoursePlannerStage(prompt(), jobId, overrides, maxTokens, onJobUpdate);
    const parsed = parseJson<T>(text);
    validate?.(parsed);
    return parsed;
  } catch (error) {
    const reason = safeErrorMessage(error, `${stageLabel} JSON failed`);
    const retryJob = appendJobEvent(jobId, {
      agent: "ARCHITECT",
      status: "running",
      message: `${stageLabel} 输出无法解析或过长，正在使用紧凑模式重试：${reason}`,
    }, { preserveJobStatus: true });
    if (retryJob) await onJobUpdate?.(retryJob);

    const retryText = await dispatchCoursePlannerStage(
      compactPrompt(reason),
      jobId,
      overrides,
      compactMaxTokens,
      onJobUpdate,
    );
    const parsed = parseJson<T>(retryText);
    validate?.(parsed);
    return parsed;
  }
}

function assertCourseSkeleton(skeleton: CourseSkeleton) {
  if (!skeleton.profile?.trim()) throw new Error("课程章节路线缺少 profile。");
  if (!Array.isArray(skeleton.chapters) || skeleton.chapters.length < 6 || skeleton.chapters.length > 8) {
    throw new Error("课程章节路线必须包含 6 到 8 章。");
  }
  const titles = skeleton.chapters.map((chapter) => chapter.title?.trim());
  if (titles.some((title) => !title) || new Set(titles).size !== titles.length) {
    throw new Error("课程章节标题为空或重复。");
  }
}

function assertCourseBibleCore(courseBible: CourseBibleCore | undefined, skeleton: CourseSkeleton) {
  if (!courseBible) throw new Error("Course Bible 缺失。");
  if (!courseBible.targetLearner?.trim()) throw new Error("Course Bible 缺少 targetLearner。");
  if (!courseBible.teachingStyle?.trim()) throw new Error("Course Bible 缺少 teachingStyle。");
  if (!courseBible.globalNarrative?.trim()) throw new Error("Course Bible 缺少 globalNarrative。");
  if (!Array.isArray(courseBible.finalOutcomes)) throw new Error("Course Bible finalOutcomes 必须是数组。");
  if (!Array.isArray(courseBible.prerequisites)) throw new Error("Course Bible prerequisites 必须是数组。");
  if (!Array.isArray(courseBible.terminology)) throw new Error("Course Bible terminology 必须是数组。");
  if (!Array.isArray(courseBible.chapterDependencies)) throw new Error("Course Bible chapterDependencies 必须是数组。");

  const titles = new Set(skeleton.chapters.map((chapter) => chapter.title));
  const invalidDependency = courseBible.chapterDependencies.find((item) => !titles.has(item.chapterTitle));
  if (invalidDependency) {
    throw new Error(`Course Bible 章节依赖标题无效：${invalidDependency.chapterTitle}`);
  }
}

function unwrapChapterContract(value: { contract?: ChapterContract } | ChapterContract): ChapterContract {
  if (value && typeof value === "object" && "contract" in value && value.contract) {
    return value.contract;
  }
  return value as ChapterContract;
}

function assertChapterContract(contract: ChapterContract | undefined, expectedTitle: string) {
  if (!contract) throw new Error(`章节契约缺失：${expectedTitle}`);
  if (contract.chapterTitle !== expectedTitle) {
    throw new Error(`章节契约标题不匹配：${contract.chapterTitle || "[empty]"} != ${expectedTitle}`);
  }
  for (const key of ["requiredTopics", "forbiddenEarlyTopics", "requiredExamples", "requiredFormulas"] as const) {
    if (!Array.isArray(contract[key])) {
      throw new Error(`章节契约 ${expectedTitle} 的 ${key} 必须是数组。`);
    }
  }
  if (!contract.bridgeFromPrevious?.trim()) throw new Error(`章节契约 ${expectedTitle} 缺少 bridgeFromPrevious。`);
  if (!contract.bridgeToNext?.trim()) throw new Error(`章节契约 ${expectedTitle} 缺少 bridgeToNext。`);
}

function mergeCoursePlanningStages(skeleton: CourseSkeleton, courseBible: CourseBible): CourseGeneration {
  if (!courseBible || !Array.isArray(courseBible.chapterContracts)) {
    throw new Error("Course Bible 缺少章节契约。");
  }

  const contracts = new Map(courseBible.chapterContracts.map((contract) => [contract.chapterTitle, contract]));
  const chapters = skeleton.chapters.map((chapter) => {
    const contract = contracts.get(chapter.title);
    if (!contract) throw new Error(`章节契约缺失：${chapter.title}`);
    return {
      ...chapter,
      contract,
    };
  });

  return {
    profile: skeleton.profile,
    courseBible: {
      ...courseBible,
      chapterContracts: chapters.map((chapter) => chapter.contract),
    },
    chapters,
  };
}

function stripGeneratedChapterFields(chapter: Chapter): Omit<Chapter, "id" | "content" | "review" | "status"> {
  return {
    title: chapter.title,
    description: chapter.description,
    minutes: chapter.minutes,
    purpose: chapter.purpose,
    connectionFromPrevious: chapter.connectionFromPrevious,
    setupForNext: chapter.setupForNext,
    time: chapter.time,
    sections: chapter.sections,
    qualityReport: chapter.qualityReport,
    generationJobId: chapter.generationJobId,
  };
}
