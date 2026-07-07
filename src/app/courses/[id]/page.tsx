"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { formatMinutes, totalMinutes } from "@/lib/time";
import { AgentEvent, Course, EntityStatus, ExportJob, GenerationJob, JobStatus } from "@/lib/types";
import { MarkdownContent } from "@/components/MarkdownContent";
import { ThemeToggle } from "@/components/ThemeToggle";
import { GenerationStudio } from "@/components/generation-studio/GenerationStudio";
import {
  estimateProgress,
  flattenStudioEvents,
  stageForEvent,
} from "@/components/generation-studio/helpers";
import { effectiveChapterStatus, hasChapterBody, isChapterReadable } from "@/lib/chapterReadiness";
import { Target, Lightbulb, GraduationCap, ArrowLeft, FileText, ChevronRight, Clock, Download, Activity } from "lucide-react";
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

const REGENERABLE_CHAPTER_STATUSES = new Set<EntityStatus>(["draft_ready", "quality_failed", "failed"]);
const ACTIVE_JOB_STATUSES = new Set<JobStatus>(["pending", "queued", "running", "retrying"]);

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

function chapterTone(chapter: Course["chapters"][number], currentJobStatus?: JobStatus) {
  if (isActiveChapterJob(currentJobStatus)) return "border-primary/30 bg-primary/5 text-primary";
  const status = effectiveChapterStatus(chapter);
  if (status === "ready") return "border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400";
  if (status === "quality_failed") return "border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400";
  if (status === "failed") return "border-destructive/30 bg-destructive/5 text-destructive";
  return "border-border bg-background text-muted-foreground";
}

export default function CourseOverviewPage() {
  const { id } = useParams<{ id: string }>();
  const [course, setCourse] = useState<Course>();
  const [exporting, setExporting] = useState<ExportJob["format"] | "">("");
  const [exportError, setExportError] = useState("");
  const [latestTexSource, setLatestTexSource] = useState<{ exportId: string; fileName: string } | null>(null);
  const [backgroundJob, setBackgroundJob] = useState("");
  const [jobStatus, setJobStatus] = useState<Record<string, JobStatus>>({});
  const [jobErrors, setJobErrors] = useState<Record<string, string>>({});
  const [jobEvents, setJobEvents] = useState<Record<string, AgentEvent[]>>({});
  const [loadError, setLoadError] = useState("");
  const [studioSettled, setStudioSettled] = useState(false);
  const [sawStudioActivity, setSawStudioActivity] = useState(false);
  const [studioExpanded, setStudioExpanded] = useState(false);

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
      const data = (await response.json()) as { export?: ExportJob; error?: string };
      if (!response.ok || !data.export) throw new Error(data.error ?? "Export failed");
      await downloadExportFile(data.export.id, data.export.fileName ?? `${course.topic}.${format}`);
      const texAsset = data.export.assets?.find((asset) => asset.format === "tex");
      setLatestTexSource(texAsset ? { exportId: data.export.id, fileName: texAsset.fileName } : null);
    } catch (error) {
      setExportError(publicSafeErrorMessage(error, "Export failed. Please try again."));
    } finally {
      setExporting("");
    }
  }

  async function downloadExportFile(exportId: string, fileName: string, asset?: ExportJob["format"]) {
    const suffix = asset ? `?asset=${asset}` : "";
    const downloadResponse = await apiFetch(`/api/exports/${exportId}${suffix}`);
    if (!downloadResponse.ok) throw new Error("Export download failed");
    const blob = await downloadResponse.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  const hasLoadedCourse = Boolean(course);
  const coursePlanningStatus = course?.generationJobId ? jobStatus[course.generationJobId] : undefined;
  const isCoursePlanning =
    hasLoadedCourse && (
    (course?.chapters.length ?? 0) === 0 ||
    coursePlanningStatus === "pending" ||
    coursePlanningStatus === "queued" ||
    coursePlanningStatus === "retrying" ||
    coursePlanningStatus === "running");
  const hasActiveChapterJobs = course?.chapters.some((chapter) => {
    if (!chapter.generationJobId) return false;
    return ACTIVE_JOB_STATUSES.has(jobStatus[chapter.generationJobId] ?? "pending");
  }) ?? false;
  const readableChapters = course?.chapters.filter(isChapterReadable) ?? [];
  const hasReadableChapters = readableChapters.length > 0;
  const hasGenerationActivity = isCoursePlanning || hasActiveChapterJobs;
  const showStudio = isCoursePlanning || (hasActiveChapterJobs && !hasReadableChapters) || (sawStudioActivity && !studioSettled && !hasReadableChapters && Boolean(course?.chapters.length));

  useEffect(() => {
    if (hasGenerationActivity) {
      setSawStudioActivity(true);
      setStudioSettled(false);
    }
  }, [hasGenerationActivity]);

  if (!course) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        {loadError || "正在读取课程..."}
      </div>
    );
  }

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
          {latestTexSource && (
            <button
              type="button"
              onClick={() => void downloadExportFile(latestTexSource.exportId, latestTexSource.fileName, "tex")}
              className="mt-4 inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              <Download size={13} /> 下载本次 TeX 源文件
            </button>
          )}
        </div>

        {showStudio ? (
          <GenerationStudio
            course={course}
            isCoursePlanning={isCoursePlanning}
            jobStatus={jobStatus}
            jobEvents={jobEvents}
            jobErrors={jobErrors}
            backgroundJob={backgroundJob}
            onRetryCoursePlanning={(generationJobId) => void retryCoursePlanning(generationJobId)}
            onRetryChapter={(chapterId, generationJobId) => void retryChapter(chapterId, generationJobId)}
            onCompleteSettled={() => setStudioSettled(true)}
          />
        ) : (
        <>
        {hasActiveChapterJobs && (
          <MiniGenerationProgress
            course={course}
            isCoursePlanning={isCoursePlanning}
            jobStatus={jobStatus}
            jobEvents={jobEvents}
            jobErrors={jobErrors}
            expanded={studioExpanded}
            onToggle={() => setStudioExpanded((current) => !current)}
          >
            <GenerationStudio
              course={course}
              isCoursePlanning={isCoursePlanning}
              jobStatus={jobStatus}
              jobEvents={jobEvents}
              jobErrors={jobErrors}
              backgroundJob={backgroundJob}
              onRetryCoursePlanning={(generationJobId) => void retryCoursePlanning(generationJobId)}
              onRetryChapter={(chapterId, generationJobId) => void retryChapter(chapterId, generationJobId)}
            />
          </MiniGenerationProgress>
        )}
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
                const readable = isChapterReadable(chapter);
                const content = (
                  <>
                  <div className="mb-2 flex items-start justify-between gap-4">
                    <h3 className={`font-mono text-base font-semibold text-foreground transition-colors ${readable ? "group-hover:text-primary" : ""}`}>
                      <span className="mr-2 text-muted-foreground">{String(index + 1).padStart(2, '0')}.</span>
                      {chapter.title}
                    </h3>
                    {currentJobStatusLabel && (
                      <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-medium text-primary">
                        {"\u4efb\u52a1\uff1a"}{currentJobStatusLabel}
                      </span>
                    )}
                    <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-medium ${chapterTone(chapter, currentJobStatus)}`}>
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
                    <span className={`flex items-center gap-1 font-medium transition-opacity ${readable ? "text-foreground opacity-0 group-hover:opacity-100" : "text-muted-foreground/60"}`}>
                      {readable ? "开始阅读" : "暂不可读"} <ChevronRight size={14} />
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
                  </>
                );
                return readable ? (
                  <Link
                    key={chapter.id}
                    href={`/courses/${course.id}/chapters/${chapter.id}`}
                    className="group block rounded-lg border border-border bg-card p-5 transition-all hover:-translate-y-1 hover:border-foreground/30 hover:shadow-md"
                  >
                    {content}
                  </Link>
                ) : (
                  <div
                    key={chapter.id}
                    className="block rounded-lg border border-border bg-card/80 p-5 opacity-90"
                  >
                    {content}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        </>
        )}
      </div>
    </div>
  );
}

import { ElementType } from "react";
function MiniGenerationProgress({
  course,
  isCoursePlanning,
  jobStatus,
  jobEvents,
  jobErrors,
  expanded,
  onToggle,
  children,
}: {
  course: Course;
  isCoursePlanning: boolean;
  jobStatus: Record<string, JobStatus>;
  jobEvents: Record<string, AgentEvent[]>;
  jobErrors: Record<string, string>;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const studioEvents = flattenStudioEvents(course, jobEvents, jobStatus, jobErrors);
  const latestEvent = studioEvents.at(-1);
  const stage = stageForEvent(latestEvent);
  const activeCount = course.chapters.filter((chapter) => {
    if (!chapter.generationJobId) return false;
    return ACTIVE_JOB_STATUSES.has(jobStatus[chapter.generationJobId] ?? "pending");
  }).length;
  const progress = estimateProgress(course, jobStatus, isCoursePlanning, false);

  return (
    <section className="mb-8 rounded-lg border border-border bg-card">
      <div className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
            <Activity size={16} className="text-primary" />
            <span>{activeCount} 个章节正在后台生成</span>
            <span className="rounded-full border border-border bg-background px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
              {stage.agent} · {stage.title}
            </span>
          </div>
          <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
            最近：{latestEvent?.chapterTitle ? `「${latestEvent.chapterTitle}」` : ""}{latestEvent?.message ?? "后台正在同步生成进度。"}
          </p>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-foreground transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="shrink-0 rounded-md border border-border bg-background px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          {expanded ? "收起生成现场" : "查看生成现场"}
        </button>
      </div>
      {expanded && <div className="border-t border-border p-4">{children}</div>}
    </section>
  );
}

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
