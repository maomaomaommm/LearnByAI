import { parseJson } from "../ai";
import { appendJobEvent, createGenerationJob, completeGenerationJob, failGenerationJob, getGenerationJob, patchGenerationJob } from "../jobs";
import { ModelOverrides } from "../modelOverrides";
import { createMockAnswer, createMockChapter, createMockCourse } from "../mock";
import { buildAnnotationTutorPrompt } from "../prompts/annotationTutor";
import { buildChapterReviewPrompt } from "../prompts/chapterReviewer";
import { buildChapterWriterPrompt } from "../prompts/chapterWriter";
import { buildCoursePlannerPrompt } from "../prompts/coursePlanner";
import { buildFormatGuardPrompt, postRepairMarkdown, preRepairMarkdown } from "../prompts/formatGuard";
import { runChapterQualityPipelineWithRepair } from "../quality/pipeline";
import { safeErrorMessage } from "../safeError";
import { Chapter, ChapterGenerateResponse, Course, CourseBible, CourseCreateResponse, GenerationJob, Section } from "../types";
import { dispatchAgentText } from "./dispatcher";
import { assertMockFallbackAllowed } from "./fallback";
import { markdownToSections } from "./integrator";

export type CourseInput = {
  topic: string;
  goal: string;
  background: string;
  preference: string;
  weeklyHours: number;
};

export type CourseGeneration = {
  profile: string;
  courseBible: CourseBible;
  chapters: Omit<Chapter, "id" | "content" | "review" | "status">[];
};

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
  options: { jobId?: string; overrides?: ModelOverrides; onJobUpdate?: (job: GenerationJob) => Promise<void> | void } = {},
): Promise<ChapterGenerateResponse> {
  const existingJob = options.jobId ? getGenerationJob(options.jobId) : undefined;
  const job = existingJob
    ? patchGenerationJob(existingJob.id, {
        courseId: course.id,
        chapterId: chapter.id,
        activeAgent: "AUTHOR",
        status: "running",
      })!
    : createGenerationJob({
        type: "chapter",
        courseId: course.id,
        chapterId: chapter.id,
        activeAgent: "AUTHOR",
        status: "running",
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
    const draft = preRepairMarkdown(
      await dispatchAgentText({
        agent: "AUTHOR",
        jobId: job.id,
        prompt: buildChapterWriterPrompt(course, chapter, {
          chapterIndex: course.chapters.findIndex((item) => item.id === chapter.id),
          chapters: course.chapters,
        }),
        temperature: 0.45,
        maxTokens: 24576,
        overrides: options.overrides,
        mock: () => createMockChapter(course.topic, chapter.title, course.goal),
        onJobUpdate: options.onJobUpdate,
      }),
    );

    let formatted = draft;
    let review = "正文已生成；Format Guard 暂时超时，已保留本地格式预修复版本。";

    try {
      formatted = postRepairMarkdown(
        await dispatchAgentText({
          agent: "POLISHER",
          jobId: job.id,
          prompt: buildFormatGuardPrompt(draft),
          temperature: 0.1,
          maxTokens: 24576,
          overrides: options.overrides,
          mock: () => draft,
          onJobUpdate: options.onJobUpdate,
        }),
      );
      review = "已通过 Format Guard 完成 Markdown、公式、代码块与标题格式修复。";
    } catch (error) {
      assertMockFallbackAllowed(error, options.overrides, "POLISHER");
      formatted = draft;
    }

    const quality = await reviewChapter(course, chapter, formatted, job.id, options.onJobUpdate, options.overrides);
    formatted = quality.content;
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
    failGenerationJob(job.id, safeErrorMessage(error, "Chapter generation failed."));
    assertMockFallbackAllowed(error, options.overrides, "AUTHOR");
    const fallback = createMockChapter(course.topic, chapter.title, course.goal);
    const quality = await reviewChapter(course, chapter, fallback, job.id, options.onJobUpdate, options.overrides);
    const repairedFallback = quality.content;
    const qualityReport = quality.report;
    const sections: Section[] = markdownToSections(chapter, repairedFallback);
    return {
      content: repairedFallback,
      sections,
      review: "已降级为 Mock 内容。",
      qualityReport,
      job: getGenerationJob(job.id),
    };
  }
}

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
    assertMockFallbackAllowed(error, overrides, "REVIEWER");
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
          message: "REVIEWER 阶段暂时不可用，已保留 TQH 本地检查结果。",
          source: "REVIEWER" as const,
        },
      ],
      status: report.status === "failed" ? report.status : ("warning" as const),
      score: Math.max(0, report.score - 5),
      },
    };
  }
}

export async function askTutor(input: {
  topic: string;
  selectedText: string;
  question: string;
  history?: { role: "user" | "assistant"; content: string }[];
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
      prompt: buildAnnotationTutorPrompt({ ...input, history: input.history ?? [] }),
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

export async function planCourseOutline(
  input: CourseInput,
  jobId: string,
  options: { overrides?: ModelOverrides; onJobUpdate?: (job: GenerationJob) => Promise<void> | void } = {},
): Promise<CourseGeneration> {
  const mock = () => {
    const course = createMockCourse(input);
    return JSON.stringify({
      profile: course.profile,
      courseBible: course.courseBible,
      chapters: course.chapters.map(stripGeneratedChapterFields),
    });
  };

  try {
    return parseJson<CourseGeneration>(
      await dispatchAgentText({
        agent: "ARCHITECT",
        jobId,
        prompt: buildCoursePlannerPrompt(input),
        temperature: 0.25,
        maxTokens: 6144,
        overrides: options.overrides,
        mock,
        onJobUpdate: options.onJobUpdate,
      }),
    );
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
