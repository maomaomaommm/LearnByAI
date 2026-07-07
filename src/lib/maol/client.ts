import { parseJson } from "../ai";
import { normalizeChapterMarkdownHeading } from "../chapterHeadings";
import { appendJobEvent, createGenerationJob, completeGenerationJob, failGenerationJob, getGenerationJob, patchGenerationJob } from "../jobs";
import { ModelOverrides } from "../modelOverrides";
import { createMockAnswer, createMockChapter, createMockCourse } from "../mock";
import { buildAnnotationTutorPrompt } from "../prompts/annotationTutor";
import { buildChapterRepairPrompt } from "../prompts/chapterRepairer";
import { buildChapterReviewPrompt } from "../prompts/chapterReviewer";
import { buildChapterWriterPrompt, getChapterLengthGuide } from "../prompts/chapterWriter";
import { buildContentRepairPrompt } from "../prompts/contentRepair";
import {
  buildCourseBiblePrompt,
  buildCourseSkeletonPrompt,
  CourseSkeleton,
} from "../prompts/coursePlanner";
import { buildFormatGuardPrompt, postRepairMarkdown, preRepairMarkdown } from "../prompts/formatGuard";
import { runChapterQualityPipelineWithRepair } from "../quality/pipeline";
import { safeErrorMessage } from "../safeError";
import { Chapter, ChapterGenerateResponse, Course, CourseBible, CourseCreateResponse, GenerationJob, QualityIssue, Section } from "../types";
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
  courseRequirements?: string;
  referenceMaterial?: string;
  styleSample?: string;
};

export type CourseGeneration = {
  profile: string;
  courseBible: CourseBible;
  chapters: Omit<Chapter, "id" | "content" | "review" | "status">[];
};

const COURSE_PLANNER_STAGE_TIMEOUT_MS = 360_000;
const REMOTE_FORMAT_GUARD_MAX_CHARS = 6_000;
const CHUNKED_REPAIR_MIN_CHARS = 6_000;
const REPAIR_CHUNK_MAX_CHARS = 1_800;
const REPAIR_CHUNK_MAX_TOKENS = 3_072;
const REPAIR_CHUNK_TIMEOUT_MS = 45_000;
const TUTOR_TIMEOUT_MS = 60_000;
const TUTOR_REPAIR_TIMEOUT_MS = 60_000;
const MAX_LONG_TEXT_REPAIR_ATTEMPTS = 1;

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
    const lengthGuide = getChapterLengthGuide(course.chapterLength);
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
    let review = "\u6b63\u6587\u5df2\u751f\u6210\uff1b\u683c\u5f0f\u4fee\u590d\u6682\u65f6\u4e0d\u53ef\u7528\uff0c\u5df2\u4fdd\u7559\u672c\u5730\u683c\u5f0f\u9884\u4fee\u590d\u7248\u672c\u3002";

    try {
      if (shouldSkipRemoteFormatGuard(draft)) {
        throw new Error("Long draft uses local format guard before targeted review repair.");
      }
      formatted = postRepairMarkdown(
        await dispatchAgentText({
          agent: "POLISHER",
          jobId: job.id,
          prompt: buildFormatGuardPrompt(draft),
          temperature: 0.1,
          maxTokens: lengthGuide.maxTokens,
          overrides: options.overrides,
          mock: () => draft,
          onJobUpdate: options.onJobUpdate,
        }),
      );
      review = "\u5df2\u901a\u8fc7\u683c\u5f0f\u4fee\u590d\uff0c\u5b8c\u6210 Markdown\u3001\u516c\u5f0f\u3001\u4ee3\u7801\u5757\u4e0e\u6807\u9898\u683c\u5f0f\u68c0\u67e5\u3002";
      await options.onStage?.({
        stage: "polished",
        content: formatted,
        sections: markdownToSections(chapter, formatted),
        review,
      });
    } catch (error) {
      formatted = postRepairMarkdown(draft);
      review = `格式修复模型暂时不可用，已使用本地格式修复保留草稿：${safeErrorMessage(error, "POLISHER failed.")}`;
    }

    const quality = await reviewChapterWithRepair(course, chapter, formatted, job.id, options.onJobUpdate, options.overrides, lengthGuide.maxTokens);
    formatted = normalizeChapterMarkdownHeading(course, chapter, quality.content);
    const qualityReport = quality.report;
    const sections = markdownToSections(chapter, formatted);
    completeGenerationJob(job.id, chapter.id);

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

  const lengthGuide = getChapterLengthGuide(course.chapterLength);
  const draft = preRepairMarkdown(content);
  let formatted = draft;
  let review = "\u6b63\u6587\u5df2\u751f\u6210\uff1b\u683c\u5f0f\u4fee\u590d\u6682\u65f6\u4e0d\u53ef\u7528\uff0c\u5df2\u4fdd\u7559\u672c\u5730\u683c\u5f0f\u9884\u4fee\u590d\u7248\u672c\u3002";

  try {
    if (shouldSkipRemoteFormatGuard(draft)) {
      throw new Error("Long draft uses local format guard before targeted review repair.");
    }
    formatted = postRepairMarkdown(
      await dispatchAgentText({
        agent: "POLISHER",
        jobId: job.id,
        prompt: buildFormatGuardPrompt(draft),
        temperature: 0.1,
        maxTokens: lengthGuide.maxTokens,
        overrides: options.overrides,
        mock: () => draft,
        onJobUpdate: options.onJobUpdate,
      }),
    );
    review = "\u5df2\u901a\u8fc7\u683c\u5f0f\u4fee\u590d\uff0c\u5b8c\u6210 Markdown\u3001\u516c\u5f0f\u3001\u4ee3\u7801\u5757\u4e0e\u6807\u9898\u683c\u5f0f\u68c0\u67e5\u3002";
    await options.onStage?.({
      stage: "polished",
      content: formatted,
      sections: markdownToSections(chapter, formatted),
      review,
    });
  } catch (error) {
    formatted = postRepairMarkdown(draft);
    review = `格式修复模型暂时不可用，已使用本地格式修复保留草稿：${safeErrorMessage(error, "POLISHER failed.")}`;
  }

  const quality = await reviewChapterWithRepair(course, chapter, formatted, job.id, options.onJobUpdate, options.overrides, lengthGuide.maxTokens);
  formatted = normalizeChapterMarkdownHeading(course, chapter, quality.content);
  const qualityReport = quality.report;
  const sections = markdownToSections(chapter, formatted);
  completeGenerationJob(job.id, chapter.id);

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

  try {
    const reviewerText = await dispatchAgentText({
      agent: "REVIEWER",
      jobId,
      prompt: buildChapterReviewPrompt(course, chapter, quality.content),
      temperature: 0.2,
      maxTokens: 4096,
      overrides,
      onJobUpdate,
      mock: () =>
        JSON.stringify({
          passed: report.status !== "failed",
          issues: [],
          summary: `TQH baseline score ${report.score}.`,
        }),
    });
    const reviewer = parseJson<ReviewerJson>(reviewerText);
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
      status: reviewer.passed === false || issues.some((issue) => issue.severity === "error") || score < 70
        ? ("failed" as const)
        : issues.length > 0
          ? ("warning" as const)
          : ("passed" as const),
      },
    };
  } catch (error) {
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

function shouldSkipRemoteFormatGuard(content: string) {
  return content.length > REMOTE_FORMAT_GUARD_MAX_CHARS;
}


const MAX_REVIEW_REPAIR_ATTEMPTS = 2;

async function reviewChapterWithRepair(
  course: Course,
  chapter: Chapter,
  content: string,
  jobId: string,
  onJobUpdate?: (job: GenerationJob) => Promise<void> | void,
  overrides?: ModelOverrides,
  maxTokens = 18432,
) {
  let best = await reviewChapter(course, chapter, content, jobId, onJobUpdate, overrides);
  let bestScore = best.report.score;
  let currentContent = best.content;

  const maxRepairAttempts = shouldUseChunkedRepair(content) ? MAX_LONG_TEXT_REPAIR_ATTEMPTS : MAX_REVIEW_REPAIR_ATTEMPTS;

  for (let attempt = 1; attempt <= maxRepairAttempts && shouldRepairQuality(best.report.issues, best.report.score); attempt += 1) {
    const repairIssues = best.report.issues.filter((issue) => issue.severity === "error" || issue.severity === "warning").slice(0, 8);
    if (!repairIssues.length) break;

    let repaired: string;
    try {
      repaired = await repairChapterContent(course, chapter, currentContent, repairIssues, {
        jobId,
        onJobUpdate,
        overrides,
        maxTokens,
      });
    } catch (error) {
      return withRepairUnavailableIssue(best, error);
    }
    currentContent = repaired;
    const reviewed = await reviewChapter(course, chapter, repaired, jobId, onJobUpdate, overrides);
    const report = {
      ...reviewed.report,
      issues: [
        ...reviewed.report.issues,
        {
          check: "review_repair.attempts",
          severity: reviewed.report.status === "failed" ? ("warning" as const) : ("info" as const),
          message: `Reviewer repair attempts: ${attempt}.`,
          suggestion: reviewed.report.status === "failed" ? "Keep the best available draft and show quality issues in the UI." : "Chapter passed automatic repair.",
          source: "TQH" as const,
        },
      ],
    };
    const candidate = { ...reviewed, report };
    if (candidate.report.score >= bestScore) {
      best = candidate;
      bestScore = candidate.report.score;
    }
    if (candidate.report.status !== "failed") return candidate;
  }

  return best;
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

  const repairedChunks: string[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index] ?? "";
    try {
      const repairedChunk = await dispatchPolisherRepairText({
        jobId: options.jobId,
        prompt: buildChapterChunkRepairPrompt(course, chapter, chunk, repairIssues, index + 1, chunks.length),
        temperature: 0.15,
        maxTokens: Math.min(options.maxTokens, REPAIR_CHUNK_MAX_TOKENS),
        timeoutMs: REPAIR_CHUNK_TIMEOUT_MS,
        maxAttempts: 1,
        stream: false,
        overrides: options.overrides,
        onJobUpdate: options.onJobUpdate,
        mock: () => chunk,
      });
      repairedChunks.push(postRepairMarkdown(repairedChunk));
    } catch (error) {
      const skippedJob = appendJobEvent(options.jobId, {
        agent: "POLISHER",
        status: "running",
        message: `Chunk ${index + 1}/${chunks.length} repair skipped: ${safeErrorMessage(error, "POLISHER chunk failed.")}`,
      }, { preserveJobStatus: true });
      if (skippedJob) await options.onJobUpdate?.(skippedJob);
      repairedChunks.push(postRepairMarkdown(chunk));
    }
  }

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
  try {
    return await dispatchAgentText({
      agent: "POLISHER",
      ...input,
    });
  } catch (error) {
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

function shouldRepairQuality(issues: QualityIssue[], score: number) {
  return score < 70 || issues.some((issue) => issue.severity === "error");
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
      stream: false,
      overrides: input.overrides,
      mock: () => createMockAnswer(input.selectedText, input.question),
      onJobUpdate: input.onJobUpdate,
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
  try {
    const researchStartedJob = appendJobEvent(jobId, {
      agent: "ARCHITECT",
      status: "running",
      message: "正在联网检索最新论文与领域进展。",
    }, { preserveJobStatus: true });
    if (researchStartedJob) await options.onJobUpdate?.(researchStartedJob);

    const researchDate = new Date().toISOString().slice(0, 10);
    const researchBrief = await researchLatestCourseKnowledge(input, options.overrides);

    const researchCompletedJob = appendJobEvent(jobId, {
      agent: "ARCHITECT",
      status: "running",
      message: "联网检索完成，正在依据最新资料规划课程。",
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
      message: "Kimi 正在生成章节路线。",
    }, { preserveJobStatus: true });
    if (skeletonJob) await options.onJobUpdate?.(skeletonJob);

    const skeletonText = await dispatchCoursePlannerStage(
      buildCourseSkeletonPrompt(plannerInput),
      jobId,
      options.overrides,
      4096,
      options.onJobUpdate,
    );
    const skeleton = parseJson<CourseSkeleton>(skeletonText);
    assertCourseSkeleton(skeleton);

    const bibleJob = appendJobEvent(jobId, {
      agent: "ARCHITECT",
      status: "running",
      message: "章节路线完成，Kimi 正在生成 Course Bible 和章节契约。",
    }, { preserveJobStatus: true });
    if (bibleJob) await options.onJobUpdate?.(bibleJob);

    const bibleText = await dispatchCoursePlannerStage(
      buildCourseBiblePrompt(plannerInput, skeleton),
      jobId,
      options.overrides,
      6144,
      options.onJobUpdate,
    );
    const courseBible = parseJson<{ courseBible: CourseBible }>(bibleText).courseBible;
    return mergeCoursePlanningStages(skeleton, courseBible);
  } catch (error) {
    assertMockFallbackAllowed(error, options.overrides, "ARCHITECT");
    const fallback = createMockCourse(input);
    return {
      profile: fallback.profile,
      courseBible: fallback.courseBible,
      chapters: fallback.chapters.map(stripGeneratedChapterFields),
    };
  }
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
