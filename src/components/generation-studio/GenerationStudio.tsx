"use client";

import { useEffect, useMemo, useState } from "react";
import type { AgentEvent, Course, JobStatus } from "@/lib/types";
import {
  estimateProgress,
  flattenStudioEvents,
  hasActiveChapterJobs,
  isActiveChapterJob,
  stageForEvent,
} from "./helpers";
import { ChapterSidebar } from "./ChapterSidebar";
import { EventLog } from "./EventLog";
import { PaperDocument } from "./PaperDocument";
import { ProgressBar } from "./ProgressBar";
import { StageStrip } from "./StageStrip";

type GenerationStudioProps = {
  course: Course;
  isCoursePlanning: boolean;
  jobStatus: Record<string, JobStatus>;
  jobEvents: Record<string, AgentEvent[]>;
  jobErrors: Record<string, string>;
  backgroundJob?: string;
  onRetryCoursePlanning: (generationJobId?: string) => void;
  onRetryChapter: (chapterId: string, generationJobId?: string) => void;
  onCompleteSettled?: () => void;
};

export function GenerationStudio({
  course,
  isCoursePlanning,
  jobStatus,
  jobEvents,
  jobErrors,
  backgroundJob,
  onRetryCoursePlanning,
  onRetryChapter,
  onCompleteSettled,
}: GenerationStudioProps) {
  const [selectedChapterId, setSelectedChapterId] = useState<string>();
  const [userPinnedChapter, setUserPinnedChapter] = useState(false);
  const [settling, setSettling] = useState(false);
  const studioEvents = useMemo(() => flattenStudioEvents(course, jobEvents, jobStatus, jobErrors), [course, jobErrors, jobEvents, jobStatus]);
  const activeChapterJobs = hasActiveChapterJobs(course, jobStatus);
  const complete = !isCoursePlanning && !activeChapterJobs && course.chapters.length > 0;

  const defaultFocusedChapter = useMemo(() => {
    return (
      course.chapters.find((chapter) => isActiveChapterJob(chapter, jobStatus)) ??
      course.chapters.find((chapter) => chapter.status === "draft_ready" || chapter.status === "quality_failed") ??
      course.chapters[0]
    );
  }, [course.chapters, jobStatus]);

  const selectedChapter = course.chapters.find((chapter) => chapter.id === selectedChapterId);
  const focusedChapter = userPinnedChapter && selectedChapter ? selectedChapter : defaultFocusedChapter;

  useEffect(() => {
    if (!selectedChapterId && defaultFocusedChapter) setSelectedChapterId(defaultFocusedChapter.id);
  }, [defaultFocusedChapter, selectedChapterId]);

  useEffect(() => {
    if (!userPinnedChapter || !selectedChapter) return;
    const stillActive = isActiveChapterJob(selectedChapter, jobStatus);
    if (!stillActive && selectedChapter.status !== "draft_ready" && selectedChapter.status !== "quality_failed") {
      setUserPinnedChapter(false);
    }
  }, [jobStatus, selectedChapter, userPinnedChapter]);

  useEffect(() => {
    if (!complete) {
      setSettling(false);
      return;
    }
    setSettling(true);
    const timeout = window.setTimeout(() => {
      setSettling(false);
      onCompleteSettled?.();
    }, 2600);
    return () => window.clearTimeout(timeout);
  }, [complete, onCompleteSettled]);

  const focusedJobId = focusedChapter?.generationJobId;
  const focusedEvents = focusedJobId ? studioEvents.filter((event) => event.jobId === focusedJobId) : studioEvents.filter((event) => !event.chapterId);
  const latestEvent = focusedEvents.at(-1) ?? studioEvents.at(-1);
  const stage = complete ? { key: "REVIEWER" as const, title: "生成完成", agent: "REVIEWER" as const } : stageForEvent(latestEvent);
  const progress = estimateProgress(course, jobStatus, isCoursePlanning, complete);
  const courseJobStatus = course.generationJobId ? jobStatus[course.generationJobId] : undefined;
  const courseFailed = course.generationJobId && courseJobStatus === "failed";
  const planningEvents = course.generationJobId ? studioEvents.filter((event) => event.jobId === course.generationJobId) : [];

  return (
    <section className="space-y-6">
      <div className="grid min-h-[720px] gap-4 lg:grid-cols-[280px_minmax(0,1fr)_360px]">
        <ChapterSidebar
          course={course}
          focusedChapterId={focusedChapter?.id}
          jobStatus={jobStatus}
          onSelectChapter={(chapterId) => {
            setSelectedChapterId(chapterId);
            setUserPinnedChapter(true);
          }}
        />

        <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          <StageStrip activeStage={stage.key} />
          <PaperDocument
            course={course}
            chapter={focusedChapter}
            stageTitle={stage.title}
            activeAgent={stage.agent}
            latestEvent={latestEvent}
            events={focusedEvents}
            complete={complete || settling}
            isPlanning={isCoursePlanning}
          />
        </div>

        <EventLog
          events={studioEvents}
          focusedJobId={focusedJobId ?? course.generationJobId}
          jobStatus={jobStatus}
          course={course}
          backgroundJob={backgroundJob}
          onRetryChapter={onRetryChapter}
          onRetryCoursePlanning={onRetryCoursePlanning}
        />
      </div>

      {courseFailed && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <p>{course.generationJobId ? jobErrors[course.generationJobId] : "课程规划失败。"}</p>
          <button
            type="button"
            onClick={() => onRetryCoursePlanning(course.generationJobId)}
            disabled={backgroundJob === course.generationJobId}
            className="mt-3 rounded-md border border-border bg-background px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            {backgroundJob === course.generationJobId ? "正在重试..." : "重新规划课程大纲"}
          </button>
        </div>
      )}

      <ProgressBar
        progress={progress}
        text={complete ? "教材生成完成，正在打开课程详情" : latestEvent?.message ?? (isCoursePlanning ? "ARCHITECT 正在规划课程大纲" : "章节正在后台生成")}
      />

      {planningEvents.length > 0 && isCoursePlanning && (
        <div className="sr-only" aria-live="polite">
          {planningEvents.at(-1)?.message}
        </div>
      )}
    </section>
  );
}
