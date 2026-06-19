"use client";

import type { Course, JobStatus } from "@/lib/types";
import { chapterStatusLabel } from "./helpers";

type ChapterSidebarProps = {
  course: Course;
  focusedChapterId?: string;
  jobStatus: Record<string, JobStatus>;
  onSelectChapter: (chapterId: string) => void;
};

export function ChapterSidebar({ course, focusedChapterId, jobStatus, onSelectChapter }: ChapterSidebarProps) {
  return (
    <aside className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <div className="border-b border-border p-4">
        <div className="font-mono text-xs font-semibold uppercase tracking-widest text-foreground">课程目录</div>
        <div className="mt-1 text-xs text-muted-foreground">点击章节可切换中央手稿焦点</div>
      </div>
      <div className="space-y-1 p-3">
        {course.chapters.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">ARCHITECT 正在规划章节结构...</div>
        ) : (
          course.chapters.map((chapter, index) => {
            const status = chapter.generationJobId ? jobStatus[chapter.generationJobId] : undefined;
            const active = chapter.id === focusedChapterId;
            return (
              <button
                key={chapter.id}
                type="button"
                onClick={() => onSelectChapter(chapter.id)}
                className={`relative grid w-full grid-cols-[34px_minmax(0,1fr)] gap-2 rounded-md p-3 text-left transition-colors ${
                  active ? "bg-muted text-foreground before:absolute before:bottom-3 before:left-0 before:top-3 before:w-0.5 before:bg-foreground" : "text-muted-foreground hover:bg-muted/60"
                }`}
              >
                <span className="font-mono text-sm font-semibold text-muted-foreground">{String(index + 1).padStart(2, "0")}.</span>
                <span className="min-w-0">
                  <span className="line-clamp-2 text-sm font-medium leading-snug">{chapter.title}</span>
                  <span className="mt-2 block text-xs text-muted-foreground">{chapterStatusLabel(chapter, status)}</span>
                </span>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}
