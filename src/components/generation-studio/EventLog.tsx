"use client";

import type { Course, JobStatus } from "@/lib/types";
import { canRetryChapter, type StudioEvent } from "./helpers";

type EventLogProps = {
  events: StudioEvent[];
  focusedJobId?: string;
  jobStatus: Record<string, JobStatus>;
  course: Course;
  backgroundJob?: string;
  onRetryChapter: (chapterId: string, generationJobId?: string) => void;
  onRetryCoursePlanning: (generationJobId?: string) => void;
};

export function EventLog({ events, focusedJobId, jobStatus, course, backgroundJob, onRetryChapter, onRetryCoursePlanning }: EventLogProps) {
  const recentEvents = events.slice(-18).reverse();
  const activeCount = Object.values(jobStatus).filter((status) => status === "pending" || status === "queued" || status === "running" || status === "retrying").length;
  const failedEvents = events.filter((event) => event.status === "failed" || event.isError);
  const readyCount = course.chapters.filter((chapter) => chapter.status === "ready" || chapter.qualityReport?.status === "passed" || chapter.qualityReport?.status === "warning").length;

  return (
    <aside className="grid min-h-[720px] grid-rows-[auto_1fr_auto] overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-border p-4">
        <div>
          <div className="font-mono text-xs font-semibold uppercase tracking-widest text-foreground">校订记录</div>
          <div className="mt-1 text-xs text-muted-foreground">真实后台事件流</div>
        </div>
        <span className="rounded-full border border-border bg-muted px-2.5 py-1 font-mono text-[11px] text-muted-foreground">{activeCount ? "RUNNING" : "IDLE"}</span>
      </div>

      <div className="max-h-[590px] space-y-2 overflow-auto p-3">
        {recentEvents.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">等待后台 Agent 写入第一条事件...</div>
        ) : (
          recentEvents.map((event) => {
            const focused = event.jobId === focusedJobId;
            const failed = event.status === "failed" || event.isError;
            return (
              <div
                key={event.id}
                className={`grid grid-cols-[64px_minmax(0,1fr)] gap-2 rounded-md border p-3 text-xs ${
                  failed
                    ? "border-destructive/30 bg-destructive/5"
                    : focused
                      ? "border-foreground/30 bg-muted"
                      : "border-border bg-background"
                }`}
              >
                <time className="font-mono text-[10px] text-muted-foreground">
                  {new Date(event.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </time>
                <div className="min-w-0">
                  <div className="font-mono text-[11px] font-semibold uppercase text-foreground">{event.agent}</div>
                  <div className="mt-1 text-muted-foreground">{event.message}</div>
                  {event.chapterTitle && <div className="mt-2 truncate text-[11px] text-muted-foreground">章节：{event.chapterTitle}</div>}
                  {failed && <RetryInline event={event} course={course} backgroundJob={backgroundJob} onRetryChapter={onRetryChapter} onRetryCoursePlanning={onRetryCoursePlanning} />}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 border-t border-border p-3">
        <Metric value={`${readyCount}/${course.chapters.length || 0}`} label="完成章节" />
        <Metric value={String(activeCount)} label="活跃任务" />
        <Metric value={String(failedEvents.length)} label="错误事件" />
      </div>
    </aside>
  );
}

function RetryInline({
  event,
  course,
  backgroundJob,
  onRetryChapter,
  onRetryCoursePlanning,
}: {
  event: StudioEvent;
  course: Course;
  backgroundJob?: string;
  onRetryChapter: (chapterId: string, generationJobId?: string) => void;
  onRetryCoursePlanning: (generationJobId?: string) => void;
}) {
  if (!event.chapterId) {
    if (event.jobId !== course.generationJobId) return null;
    return (
      <button
        type="button"
        onClick={() => onRetryCoursePlanning(course.generationJobId)}
        disabled={backgroundJob === course.generationJobId}
        className="mt-2 rounded-md border border-border bg-background px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
      >
        {backgroundJob === course.generationJobId ? "正在重试" : "重新规划"}
      </button>
    );
  }

  const chapter = course.chapters.find((item) => item.id === event.chapterId);
  if (!chapter) return null;
  const status = chapter.generationJobId ? undefined : "failed";
  if (!canRetryChapter(chapter, status)) return null;

  return (
    <button
      type="button"
      onClick={() => onRetryChapter(chapter.id, chapter.generationJobId)}
      disabled={backgroundJob === (chapter.generationJobId ?? chapter.id)}
      className="mt-2 rounded-md border border-border bg-background px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
    >
      {backgroundJob === (chapter.generationJobId ?? chapter.id) ? "正在重试" : "重新生成"}
    </button>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-md border border-border bg-background p-2">
      <div className="text-base font-semibold text-foreground">{value}</div>
      <div className="mt-1 text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}
