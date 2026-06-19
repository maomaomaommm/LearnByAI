"use client";

import { useEffect, useMemo, useState } from "react";
import type { AgentName, Course } from "@/lib/types";
import type { StudioEvent } from "./helpers";
import { previewChapterContent } from "./helpers";

type PaperDocumentProps = {
  course: Course;
  chapter?: Course["chapters"][number];
  stageTitle: string;
  activeAgent: AgentName | "FORMAT" | "REPAIRER";
  latestEvent?: StudioEvent;
  events: StudioEvent[];
  complete: boolean;
  isPlanning: boolean;
};

export function PaperDocument({ course, chapter, stageTitle, activeAgent, latestEvent, events, complete, isPlanning }: PaperDocumentProps) {
  const [scanKey, setScanKey] = useState(0);
  const [typedTitle, setTypedTitle] = useState("");
  const displayTitle = isPlanning ? course.topic : (chapter?.title ?? course.topic);
  const lines = useMemo(() => buildPaperLines(course, chapter, events, latestEvent, isPlanning), [chapter, course, events, isPlanning, latestEvent]);

  useEffect(() => {
    setTypedTitle("");
    let index = 0;
    const timer = window.setInterval(() => {
      index += 1;
      setTypedTitle(displayTitle.slice(0, index));
      if (index >= displayTitle.length) window.clearInterval(timer);
    }, 22);
    return () => window.clearInterval(timer);
  }, [displayTitle]);

  useEffect(() => {
    setScanKey((key) => key + 1);
  }, [activeAgent, chapter?.id, stageTitle]);

  return (
    <div className="grid min-h-[620px] place-items-center bg-background p-6 [background-image:linear-gradient(90deg,transparent_0,transparent_calc(100%-1px),hsl(var(--border))_calc(100%-1px))] [background-size:28px_100%]">
      <article className="relative min-h-[520px] w-full max-w-3xl overflow-hidden border border-border bg-card p-8 shadow-[0_22px_80px_rgba(0,0,0,0.08)] md:p-10">
        <div
          key={scanKey}
          className="pointer-events-none absolute inset-x-0 -top-20 h-20 bg-gradient-to-b from-transparent via-yellow-500/20 to-transparent motion-safe:animate-[studioScan_2.4s_ease-in-out]"
        />
        <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:linear-gradient(180deg,transparent_0_31px,hsl(var(--border))_32px,transparent_33px),linear-gradient(90deg,transparent_0_48px,hsl(var(--border))_49px,transparent_50px)] [background-size:100%_34px,100%_100%]" />
        <div className="relative z-10">
          <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">LEARNBYAI MANUSCRIPT / LIVE</div>
          <h2 className="mt-4 min-h-[76px] font-mono text-3xl font-bold leading-tight text-foreground md:text-5xl">
            {typedTitle}
            {typedTitle.length < displayTitle.length && <span className="ml-1 inline-block h-[0.82em] w-1 translate-y-1 bg-foreground motion-safe:animate-pulse" />}
          </h2>
          <div className="mt-5 flex flex-wrap gap-2">
            <Tag>{stageTitle}</Tag>
            <Tag>{activeAgent}</Tag>
            <Tag>{chapter ? "章节聚焦" : "Course Bible"}</Tag>
          </div>
          <div className="mt-8 space-y-4">
            {lines.map((line, index) => (
              <div key={`${line}-${index}`} className="border-l-2 border-foreground pl-4 text-sm leading-8 text-muted-foreground">
                {index === 0 ? <strong className="text-foreground">{line}</strong> : line}
              </div>
            ))}
          </div>
        </div>
        {complete && (
          <div className="absolute bottom-8 right-8 rotate-[-4deg] rounded-md border-2 border-green-600 px-4 py-2 font-mono text-sm font-bold text-green-600 dark:border-green-400 dark:text-green-400">
            质检通过
          </div>
        )}
      </article>
      <style jsx>{`
        @keyframes studioScan {
          0% {
            opacity: 0;
            transform: translateY(0);
          }
          18% {
            opacity: 0.75;
          }
          100% {
            opacity: 0;
            transform: translateY(680px);
          }
        }
      `}</style>
    </div>
  );
}

function Tag({ children }: { children: string }) {
  return <span className="rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground">{children}</span>;
}

function buildPaperLines(
  course: Course,
  chapter: Course["chapters"][number] | undefined,
  events: StudioEvent[],
  latestEvent: StudioEvent | undefined,
  isPlanning: boolean,
) {
  if (isPlanning) {
    return [
      "ARCHITECT 正在规划课程大纲",
      latestEvent?.message ?? "正在根据学习目标生成 Course Bible 和章节契约。",
      course.goal,
    ].filter(Boolean);
  }

  if (!chapter) {
    return ["等待章节进入生成队列", latestEvent?.message ?? "后台 Agent 正在准备章节任务。"];
  }

  const content = previewChapterContent(chapter);
  const eventMessages = events.slice(-2).map((event) => event.message);
  return [
    `${chapter.title}`,
    ...eventMessages,
    content || chapter.description,
  ].filter(Boolean).slice(0, 5);
}
