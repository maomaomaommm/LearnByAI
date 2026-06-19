import type { AgentEvent, AgentName, Course, EntityStatus, JobStatus } from "@/lib/types";
import { effectiveChapterStatus, hasChapterBody, isChapterReadable } from "@/lib/chapterReadiness";

export type StudioEvent = AgentEvent & {
  jobId: string;
  chapterId?: string;
  chapterTitle?: string;
  isError?: boolean;
};

export type StageKey = "ARCHITECT" | "AUTHOR" | "POLISHER" | "FORMAT" | "REVIEWER";

export const ACTIVE_JOB_STATUSES = new Set<JobStatus>(["pending", "queued", "running", "retrying"]);

export const CHAPTER_STATUS_LABEL: Record<EntityStatus, string> = {
  pending: "待生成",
  queued: "队列中",
  generating: "生成中",
  draft_ready: "待质检草稿",
  quality_failed: "质检未通过",
  ready: "质检通过",
  failed: "需重试",
};

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  pending: "待处理",
  queued: "队列中",
  running: "运行中",
  retrying: "重试中",
  succeeded: "已完成",
  failed: "失败",
};

export const STAGES: Array<{ key: StageKey; agent: string; label: string }> = [
  { key: "ARCHITECT", agent: "ARCHITECT", label: "规划课程" },
  { key: "AUTHOR", agent: "AUTHOR", label: "撰写草稿" },
  { key: "POLISHER", agent: "POLISHER", label: "润色结构" },
  { key: "FORMAT", agent: "FORMAT", label: "整理格式" },
  { key: "REVIEWER", agent: "REVIEWER", label: "质量检查" },
];

export function chapterStatusLabel(chapter: Course["chapters"][number], status?: JobStatus) {
  if (status && ACTIVE_JOB_STATUSES.has(status)) return JOB_STATUS_LABEL[status];
  return CHAPTER_STATUS_LABEL[effectiveChapterStatus(chapter)];
}

export function isActiveChapterJob(chapter: Course["chapters"][number], jobStatus: Record<string, JobStatus>) {
  if (!chapter.generationJobId) return false;
  return ACTIVE_JOB_STATUSES.has(jobStatus[chapter.generationJobId] ?? "pending");
}

export function hasActiveChapterJobs(course: Course, jobStatus: Record<string, JobStatus>) {
  return course.chapters.some((chapter) => isActiveChapterJob(chapter, jobStatus));
}

export function canRetryChapter(chapter: Course["chapters"][number], status?: JobStatus) {
  if (status && ACTIVE_JOB_STATUSES.has(status)) return false;
  const effectiveStatus = effectiveChapterStatus(chapter);
  return effectiveStatus === "draft_ready" || effectiveStatus === "quality_failed" || effectiveStatus === "failed" || status === "failed";
}

export function flattenStudioEvents(
  course: Course,
  jobEvents: Record<string, AgentEvent[]>,
  jobStatus: Record<string, JobStatus>,
  jobErrors: Record<string, string>,
) {
  const events: StudioEvent[] = [];

  if (course.generationJobId) {
    events.push(...eventsForJob(course.generationJobId, jobEvents, jobStatus, jobErrors));
  }

  for (const chapter of course.chapters) {
    if (!chapter.generationJobId) continue;
    events.push(
      ...eventsForJob(chapter.generationJobId, jobEvents, jobStatus, jobErrors).map((event) => ({
        ...event,
        chapterId: chapter.id,
        chapterTitle: chapter.title,
      })),
    );
  }

  return events.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

export function stageForEvent(event?: Pick<StudioEvent, "agent" | "message">): { key: StageKey; title: string; agent: AgentName | "FORMAT" | "REPAIRER" } {
  if (!event) return { key: "ARCHITECT", title: "等待生成", agent: "ARCHITECT" };
  if (isRepairMessage(event.message)) return { key: "REVIEWER", title: "自动返修", agent: "REPAIRER" };
  if (isFormatMessage(event.message)) return { key: "FORMAT", title: "整理格式", agent: "FORMAT" };
  if (event.agent === "AUTHOR") return { key: "AUTHOR", title: "撰写草稿", agent: "AUTHOR" };
  if (event.agent === "POLISHER") return { key: "POLISHER", title: "润色结构", agent: "POLISHER" };
  if (event.agent === "REVIEWER") return { key: "REVIEWER", title: "质量检查", agent: "REVIEWER" };
  if (event.agent === "ARCHITECT") return { key: "ARCHITECT", title: "规划课程", agent: "ARCHITECT" };
  return { key: "ARCHITECT", title: "系统调度", agent: "ASSISTANT" };
}

export function estimateProgress(course: Course, jobStatus: Record<string, JobStatus>, isCoursePlanning: boolean, complete: boolean) {
  if (complete) return 100;
  if (isCoursePlanning) {
    const status = course.generationJobId ? jobStatus[course.generationJobId] : undefined;
    if (status === "running") return 22;
    if (status === "retrying") return 18;
    if (status === "queued") return 12;
    if (status === "failed") return 10;
    return course.chapters.length ? 30 : 8;
  }
  if (!course.chapters.length) return 0;

  const score = course.chapters.reduce((total, chapter) => {
    const status = chapter.generationJobId ? jobStatus[chapter.generationJobId] : undefined;
    if (status && ACTIVE_JOB_STATUSES.has(status)) return total + 0.35;
    const effectiveStatus = effectiveChapterStatus(chapter);
    if (effectiveStatus === "ready") return total + 1;
    if (effectiveStatus === "quality_failed") return total + 1;
    if (effectiveStatus === "draft_ready") return total + 0.72;
    if (effectiveStatus === "generating") return total + 0.45;
    if (effectiveStatus === "queued") return total + 0.18;
    return total;
  }, 0);

  return Math.min(98, Math.max(30, Math.round(30 + (score / course.chapters.length) * 68)));
}

export function previewChapterContent(chapter: Course["chapters"][number]) {
  const source = chapter.content || chapter.sections?.map((section) => `${section.title}\n${section.content}`).join("\n\n") || chapter.description;
  return stripMarkdown(source).replace(/\s+/g, " ").trim().slice(0, 360);
}

function eventsForJob(
  jobId: string,
  jobEvents: Record<string, AgentEvent[]>,
  jobStatus: Record<string, JobStatus>,
  jobErrors: Record<string, string>,
) {
  const events = (jobEvents[jobId] ?? []).map((event) => ({ ...event, jobId }));
  const error = jobErrors[jobId];
  if (!error) return events;
  return [
    ...events,
    {
      id: `${jobId}-error`,
      jobId,
      agent: "ASSISTANT" as const,
      status: jobStatus[jobId] ?? "failed",
      message: error,
      createdAt: events.at(-1)?.createdAt ?? new Date().toISOString(),
      isError: true,
    },
  ];
}

function isFormatMessage(message: string) {
  return /format|markdown|formula|katex|tex|fence|标题|格式|公式|代码块|列表|Format Guard/i.test(message);
}

function isRepairMessage(message: string) {
  return /repair|retry|返修|修复|重试|回滚|rolled back|candidate/i.test(message);
}

function stripMarkdown(value: string) {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`~\[\]()]/g, " ")
    .replace(/\|/g, " ");
}

export { effectiveChapterStatus, hasChapterBody, isChapterReadable };
