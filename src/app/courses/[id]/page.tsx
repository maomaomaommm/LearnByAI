"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { formatMinutes, totalMinutes } from "@/lib/time";
import { AgentEvent, Course, EntityStatus, ExportJob, GenerationJob, JobStatus } from "@/lib/types";
import { MarkdownContent } from "@/components/MarkdownContent";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Target, Lightbulb, GraduationCap, ArrowLeft, FileText, ChevronRight, Clock, Download } from "lucide-react";
import { apiFetch, subscribeToSse } from "@/lib/clientApi";
import { publicSafeErrorMessage } from "@/lib/publicSafeError";

const CHAPTER_STATUS_LABEL: Record<EntityStatus, string> = {
  pending: "\u5f85\u751f\u6210",
  queued: "\u961f\u5217\u4e2d",
  generating: "\u751f\u6210\u4e2d",
  draft_ready: "\u5f85\u8d28\u68c0\u8349\u7a3f",
  quality_failed: "\u8d28\u68c0\u672a\u901a\u8fc7",
  ready: "\u8d28\u68c0\u901a\u8fc7",
  failed: "\u9700\u91cd\u8bd5",
};

const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  pending: "\u5f85\u5904\u7406",
  queued: "\u961f\u5217\u4e2d",
  running: "\u8fd0\u884c\u4e2d",
  retrying: "\u91cd\u8bd5\u4e2d",
  succeeded: "\u5df2\u5b8c\u6210",
  failed: "\u5931\u8d25",
};

const QUALITY_STATUS_LABEL: Record<string, string> = {
  passed: "\u8d28\u68c0\u901a\u8fc7",
  warning: "\u8d28\u68c0\u901a\u8fc7",
  failed: "\u8d28\u68c0\u672a\u901a\u8fc7",
};

const ACTIVE_JOB_STATUSES = new Set<JobStatus>(["pending", "queued", "running", "retrying"]);
const REGENERABLE_CHAPTER_STATUSES = new Set<EntityStatus>(["draft_ready", "quality_failed", "failed"]);

function hasChapterBody(chapter: Course["chapters"][number]) {
  return Boolean(chapter.content || chapter.sections?.length);
}

function effectiveChapterStatus(chapter: Course["chapters"][number]): EntityStatus {
  if (hasChapterBody(chapter)) {
    if (chapter.qualityReport?.status === "failed" || chapter.status === "quality_failed") return "quality_failed";
    if (chapter.status === "ready" || chapter.qualityReport?.status === "passed" || chapter.qualityReport?.status === "warning") return "ready";
    return "draft_ready";
  }
  return chapter.status ?? "pending";
}

function chapterStatusLabel(chapter: Course["chapters"][number]) {
  if (hasChapterBody(chapter)) {
    if (chapter.qualityReport?.status) {
      return QUALITY_STATUS_LABEL[chapter.qualityReport.status] ?? CHAPTER_STATUS_LABEL[effectiveChapterStatus(chapter)];
    }
    return CHAPTER_STATUS_LABEL[effectiveChapterStatus(chapter)];
  }
  return CHAPTER_STATUS_LABEL[effectiveChapterStatus(chapter)];
}

function isActiveChapterJob(status?: JobStatus) {
  return Boolean(status && ACTIVE_JOB_STATUSES.has(status));
}

function canRegenerateChapter(chapter: Course["chapters"][number], currentJobStatus?: JobStatus) {
  if (isActiveChapterJob(currentJobStatus)) return false;
  if (chapter.status === "queued" || chapter.status === "generating") return false;
  return REGENERABLE_CHAPTER_STATUSES.has(effectiveChapterStatus(chapter));
}

function shouldShowChapterJobStatus(chapter: Course["chapters"][number], currentJobStatus?: JobStatus) {
  if (!currentJobStatus) return false;
  if (isActiveChapterJob(currentJobStatus)) return true;
  return !hasChapterBody(chapter) && currentJobStatus === "failed";
}

export default function CourseOverviewPage() {
  const { id } = useParams<{ id: string }>();
  const [course, setCourse] = useState<Course>();
  const [exporting, setExporting] = useState<ExportJob["format"] | "">("");
  const [exportError, setExportError] = useState("");
  const [backgroundJob, setBackgroundJob] = useState("");
  const [jobStatus, setJobStatus] = useState<Record<string, JobStatus>>({});
  const [jobErrors, setJobErrors] = useState<Record<string, string>>({});
  const [jobEvents, setJobEvents] = useState<Record<string, AgentEvent[]>>({});
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoadError("");

    apiFetch(`/api/courses/${id}`)
      .then((response) => (response.ok ? response.json() : undefined))
      .then((data) => {
        if (cancelled) return;
        if (data?.course) setCourse(data.course);
        else setLoadError("课程不存在，或你没有访问权限。");
      })
      .catch(() => {
        if (!cancelled) setLoadError("读取课程失败，请稍后重试。");
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    let cancelled = false;

    const applyCourse = (nextCourse: Course) => {
      if (cancelled) return;
      setCourse(nextCourse);
    };
    const applyJobs = (jobs: GenerationJob[]) => {
      if (cancelled || jobs.length === 0) return;
      setJobStatus((current) => ({
        ...current,
        ...Object.fromEntries(jobs.map((job) => [job.id, job.status])),
      }));
      setJobErrors((current) => ({
        ...current,
        ...Object.fromEntries(jobs.map((job) => [job.id, job.error ?? ""])),
      }));
      setJobEvents((current) => ({
        ...current,
        ...Object.fromEntries(jobs.map((job) => [job.id, job.events ?? []])),
      }));
    };

    const subscription = subscribeToSse(`/api/courses/${id}/events`, {
      onMessage(message) {
        const data = message.data;
        if (message.event === "snapshot") {
          const snapshot = data as { course?: Course; jobs?: GenerationJob[] } | undefined;
          if (snapshot?.course) applyCourse(snapshot.course);
          if (snapshot?.jobs) applyJobs(snapshot.jobs);
        } else if (message.event === "course") {
          const payload = data as { course?: Course } | undefined;
          if (payload?.course) applyCourse(payload.course);
        } else if (message.event === "job") {
          const payload = data as { job?: GenerationJob } | undefined;
          if (payload?.job) applyJobs([payload.job]);
        }
      },
    });

    return () => {
      cancelled = true;
      subscription.close();
    };
  }, [id]);

  async function retryChapter(chapterId: string, generationJobId?: string) {
    if (!course) return;
    const pendingKey = generationJobId ?? chapterId;
    setBackgroundJob(pendingKey);

    const response = generationJobId
      ? await apiFetch(`/api/generation-jobs/${generationJobId}`, {
          method: "POST",
          body: JSON.stringify({ retry: true }),
        })
      : await apiFetch(`/api/chapters/${chapterId}/generate`, {
          method: "POST",
          body: JSON.stringify({ courseId: course.id, retry: true }),
        });
    const data = response.ok ? await response.json() : undefined;
    if (data?.course) {
      setCourse(data.course);
    } else if (data?.job) {
      setJobStatus((current) => ({ ...current, [data.job.id]: data.job.status }));
      setJobErrors((current) => ({ ...current, [data.job.id]: data.job.error ?? "" }));
      setJobEvents((current) => ({ ...current, [data.job.id]: data.job.events ?? [] }));
    } else {
      const nextCourse = {
        ...course,
        chapters: course.chapters.map((chapter) =>
          chapter.id === chapterId ? { ...chapter, status: "failed" as const } : chapter,
        ),
      };
      setCourse(nextCourse);
    }
    setBackgroundJob("");
  }

  async function retryCoursePlanning(generationJobId?: string) {
    if (!course || !generationJobId) return;
    setBackgroundJob(generationJobId);
    setJobErrors((current) => ({ ...current, [generationJobId]: "" }));
    const response = await apiFetch(`/api/generation-jobs/${generationJobId}`, {
      method: "POST",
      body: JSON.stringify({ retry: true }),
    });
    const data = await response.json().catch(() => undefined);
    if (!response.ok) {
      setJobStatus((current) => ({ ...current, [generationJobId]: "failed" }));
      setJobErrors((current) => ({ ...current, [generationJobId]: data?.error ?? "重新规划课程大纲失败。" }));
      setBackgroundJob("");
      return;
    }
    if (data?.course) {
      setCourse(data.course);
    }
    if (data?.job) {
      setJobStatus((current) => ({ ...current, [generationJobId]: data.job.status }));
      if (data.job.error) setJobErrors((current) => ({ ...current, [generationJobId]: data.job.error }));
      if (data.job.events) setJobEvents((current) => ({ ...current, [generationJobId]: data.job.events }));
    }
    setBackgroundJob("");
  }

  async function exportCourse(format: ExportJob["format"]) {
    if (!course) return;
    setExporting(format);
    setExportError("");

    try {
      const response = await apiFetch("/api/exports", {
        method: "POST",
        body: JSON.stringify({ courseId: course.id, format }),
      });
      const data = await response.json();
      if (!response.ok || !data.export) throw new Error(data.error ?? "Export failed");
      const downloadResponse = await apiFetch(`/api/exports/${data.export.id}`);
      if (!downloadResponse.ok) throw new Error("Export download failed");
      const blob = await downloadResponse.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = data.export.fileName ?? `${course.topic}.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setExportError(publicSafeErrorMessage(error, "Export failed. Please try again."));
    } finally {
      setExporting("");
    }
  }

  if (!course) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        {loadError || "正在读取课程..."}
      </div>
    );
  }

  const coursePlanningStatus = course.generationJobId ? jobStatus[course.generationJobId] : undefined;
  const coursePlanningEvents = course.generationJobId ? (jobEvents[course.generationJobId] ?? []) : [];
  const isCoursePlanning =
    course.chapters.length === 0 ||
    coursePlanningStatus === "pending" ||
    coursePlanningStatus === "queued" ||
    coursePlanningStatus === "retrying" ||
    coursePlanningStatus === "running";

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-4 py-12">
        <div className="mb-6 flex items-center justify-between">
          <Link href="/" className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft size={14} /> 返回首页创建课程
          </Link>
          <ThemeToggle />
        </div>

        {/* Course Header */}
        <div className="mb-8 rounded-lg border border-border bg-card p-6 md:p-8">
          <div className="mb-4 flex items-center justify-between">
            <h1 className="font-mono text-2xl font-bold text-foreground md:text-3xl">{course.topic}</h1>
            <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              {backgroundJob ? "后台生成中" : course.generationJobId ? "MAOL 已规划" : "课程就绪"}
            </span>
          </div>
          <p className="mb-6 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {course.goal}
          </p>
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1 rounded-md bg-background px-2.5 py-1.5 border border-border">
              <Target size={14} className="text-foreground" /> 目标导向
            </span>
            <span className="flex items-center gap-1 rounded-md bg-background px-2.5 py-1.5 border border-border">
              <GraduationCap size={14} className="text-foreground" /> {course.profile.slice(0, 30)}...
            </span>
            <button
              onClick={() => exportCourse("pdf")}
              disabled={Boolean(exporting)}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              <Download size={14} /> {exporting === "pdf" ? "导出中" : "导出 PDF"}
            </button>
            <button
              onClick={() => exportCourse("tex")}
              disabled={Boolean(exporting)}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              <Download size={14} /> {exporting === "tex" ? "导出中" : "导出 TeX"}
            </button>
          </div>
          {exportError && <p className="mt-4 text-sm text-destructive">{exportError}</p>}
        </div>

        {isCoursePlanning ? (
          <div className="rounded-lg border border-border bg-card p-8">
            <div className="mb-3 font-mono text-xs uppercase tracking-widest text-muted-foreground">
              任务状态: {(coursePlanningStatus ?? "pending").toUpperCase()}
            </div>
            <h2 className="font-mono text-lg font-semibold text-foreground">ARCHITECT 正在为您规划课程大纲</h2>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Course Bible（课程全局设定）和各章节大纲正在后台生成中。生成完成后本页面将自动刷新。
            </p>
            {course.generationJobId && jobErrors[course.generationJobId] && (
              <div className="mt-5 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                {jobErrors[course.generationJobId]}
              </div>
            )}
            {coursePlanningEvents.length > 0 && (
              <ol className="mt-5 space-y-2 rounded-md border border-border bg-background p-4 text-xs text-muted-foreground">
                {coursePlanningEvents.slice(-6).map((event) => (
                  <li key={event.id} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                    <span className="font-mono uppercase text-foreground">{event.agent}</span>
                    <span className="font-mono uppercase">{event.status}</span>
                    <span className="min-w-0 flex-1">{event.message}</span>
                    <time className="font-mono text-[10px] uppercase">
                      {new Date(event.createdAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </time>
                  </li>
                ))}
              </ol>
            )}
            {course.generationJobId && coursePlanningStatus === "failed" && (
              <button
                type="button"
                onClick={() => void retryCoursePlanning(course.generationJobId)}
                disabled={backgroundJob === course.generationJobId}
                className="mt-5 rounded-md border border-border bg-background px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                {backgroundJob === course.generationJobId ? "正在重试..." : "重新规划课程大纲"}
              </button>
            )}
          </div>
        ) : (
        <div className="grid gap-8 lg:grid-cols-[1fr_1fr]">
          {/* Left: Course Bible */}
          <div className="space-y-6">
            <h2 className="mb-4 font-mono text-sm font-semibold uppercase tracking-widest text-muted-foreground">Course Bible</h2>
            
            <BibleSection icon={FileText} title="课程叙事" content={course.courseBible.globalNarrative} />
            
            <div className="rounded-lg border border-border bg-card p-5">
              <div className="mb-3 flex items-center gap-2">
                <Target size={16} className="text-foreground" />
                <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-foreground">最终能力</h3>
              </div>
              <ul className="space-y-2">
                {course.courseBible.finalOutcomes.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <ChevronRight size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-lg border border-border bg-card p-5">
              <div className="mb-3 flex items-center gap-2">
                <Lightbulb size={16} className="text-foreground" />
                <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-foreground">前置知识</h3>
              </div>
              <ul className="space-y-2">
                {course.courseBible.prerequisites.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <ChevronRight size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Right: Chapters */}
          <div>
            <h2 className="mb-4 font-mono text-sm font-semibold uppercase tracking-widest text-muted-foreground">章节列表</h2>
            <div className="space-y-4">
              {course.chapters.map((chapter, index) => {
                const currentJobStatus = chapter.generationJobId ? jobStatus[chapter.generationJobId] : undefined;
                const currentJobStatusLabel = shouldShowChapterJobStatus(chapter, currentJobStatus) && currentJobStatus
                  ? JOB_STATUS_LABEL[currentJobStatus]
                  : "";
                const pendingKey = chapter.generationJobId ?? chapter.id;
                return (
                  <Link
                    key={chapter.id}
                    href={`/courses/${course.id}/chapters/${chapter.id}`}
                    className="group block rounded-lg border border-border bg-card p-5 transition-all hover:-translate-y-1 hover:border-foreground/30 hover:shadow-md"
                  >
                  <div className="mb-2 flex items-start justify-between gap-4">
                    <h3 className="font-mono text-base font-semibold text-foreground group-hover:text-primary transition-colors">
                      <span className="mr-2 text-muted-foreground">{String(index + 1).padStart(2, '0')}.</span>
                      {chapter.title}
                    </h3>
                    {currentJobStatusLabel && (
                      <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-medium text-primary">
                        {"\u4efb\u52a1\uff1a"}{currentJobStatusLabel}
                      </span>
                    )}
                    <span className="shrink-0 rounded-full bg-background px-2.5 py-1 text-[10px] font-medium text-muted-foreground border border-border">
                      {chapterStatusLabel(chapter)}
                    </span>
                  </div>
                  <p className="mb-4 line-clamp-2 text-sm text-muted-foreground">
                    {chapter.description}
                  </p>
                  {chapter.qualityReport && (
                    <div className="mb-3 rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
                      TQH{"\uff1a"}{chapter.qualityReport.score} / 100 {"\u00b7"} {QUALITY_STATUS_LABEL[chapter.qualityReport.status] ?? chapter.qualityReport.status}
                    </div>
                  )}
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <div className="flex items-center gap-4">
                      <span className="flex items-center gap-1">
                        <Clock size={12} />
                        {formatMinutes(totalMinutes(chapter.time))}
                      </span>
                    </div>
                    <span className="flex items-center gap-1 font-medium text-foreground opacity-0 transition-opacity group-hover:opacity-100">
                      开始阅读 <ChevronRight size={14} />
                    </span>
                  </div>
                  {canRegenerateChapter(chapter, currentJobStatus) && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        void retryChapter(chapter.id, chapter.generationJobId);
                      }}
                      disabled={backgroundJob === pendingKey}
                      className="mt-4 rounded-md border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                    >
                      {backgroundJob === pendingKey ? "正在重试" : "重新生成"}
                    </button>
                  )}
                </Link>
                );
              })}
            </div>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}

import { ElementType } from "react";
function BibleSection({ icon: Icon, title, content }: { icon: ElementType; title: string; content: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="mb-3 flex items-center gap-2">
        <Icon size={16} className="text-foreground" />
        <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-foreground">{title}</h3>
      </div>
      <div className="text-sm leading-relaxed text-muted-foreground">
        <MarkdownContent content={content} />
      </div>
    </div>
  );
}
