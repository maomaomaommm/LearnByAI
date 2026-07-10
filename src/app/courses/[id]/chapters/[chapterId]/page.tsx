"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { MouseEvent, useCallback, useEffect, useState } from "react";
import { MarkdownContent } from "@/components/MarkdownContent";
import { TutorPanel } from "@/components/reader/TutorPanel";
import { RevisePanel } from "@/components/reader/RevisePanel";
import { useTutor } from "@/lib/hooks/useTutor";
import { useRevise } from "@/lib/hooks/useRevise";
import { apiFetch, subscribeToSse } from "@/lib/clientApi";
import { publicSafeErrorMessage } from "@/lib/publicSafeError";
import { formatMinutes, totalMinutes } from "@/lib/time";
import { AgentEvent, Chapter, ChapterGenerateResponse, Course, EntityStatus, GenerationJob, Section } from "@/lib/types";
import { effectiveChapterStatus, hasChapterBody, isChapterAwaitingQuality, isChapterReadable } from "@/lib/chapterReadiness";
import { stageForEvent } from "@/components/generation-studio/helpers";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ModelSettings } from "@/components/ModelSettings";
import { ArrowLeft, Bot, ChevronDown, ChevronLeft, ChevronRight, Clock, Download, Menu, PencilLine, X } from "lucide-react";
import { toast } from "sonner";

const DEFAULT_REVIEW = "已完成结构、术语与公式一致性检查。";
const DRAFT_REVIEW = "草稿已保存，格式修复和质量检查仍在继续。";
const FORMAT_GUARD_REVIEW = "已通过格式修复，完成 Markdown、公式、代码块与标题格式检查。";
const QUALITY_FAILED_REVIEW = "已生成草稿，但质量检查未通过，下面仍展示已生成内容。";

type Panel = "tutor" | "revise" | null;

const CHAPTER_STATUS_LABEL: Record<EntityStatus, string> = {
  pending: "待生成",
  queued: "队列中",
  generating: "生成中",
  draft_ready: "待质检草稿",
  quality_failed: "质检未通过",
  ready: "质检通过",
  failed: "生成失败",
};

const QUALITY_STATUS_LABEL: Record<string, string> = {
  passed: "质检通过",
  warning: "质检通过",
  failed: "质检未通过",
};

function getChapterBody(chapter: Chapter) {
  return chapter.content ?? chapter.sections?.map((section) => section.content).join("\n\n") ?? "";
}

function isWaitingForBackgroundGeneration(chapter: Chapter) {
  return Boolean(chapter.generationJobId);
}

function reviewFallbackForChapter(chapter?: Chapter) {
  if (!chapter) return DEFAULT_REVIEW;
  const status = effectiveChapterStatus(chapter);
  if (status === "quality_failed") return QUALITY_FAILED_REVIEW;
  if (status === "draft_ready") return DRAFT_REVIEW;
  return DEFAULT_REVIEW;
}

function isQuestionMarkReview(value: string) {
  const text = value.trim();
  if (!text) return false;
  const questionMarks = text.match(/\?/g)?.length ?? 0;
  return questionMarks > 0 && questionMarks / text.length >= 0.4;
}

function localizeReviewText(value?: string, chapter?: Chapter) {
  const fallback = reviewFallbackForChapter(chapter);
  if (!value || isQuestionMarkReview(value)) return fallback;
  return value
    .replace("AUTHOR draft saved. Format Guard and quality review are still running.", DRAFT_REVIEW)
    .replace("Format Guard completed Markdown, formula, code block, and heading repairs.", FORMAT_GUARD_REVIEW)
    .replace("已通过 Format Guard 完成 Markdown、公式、代码块与标题格式修复。", FORMAT_GUARD_REVIEW)
    .replace("Chapter generation failed.", "本章生成失败。");
}

function closestSectionId(node: Node | null) {
  if (!node) return undefined;
  const element = node instanceof Element ? node : node.parentElement;
  return element?.closest<HTMLElement>("[data-section-id]")?.dataset.sectionId;
}

function chapterStatusLabel(chapter: Chapter) {
  if (hasChapterBody(chapter) && chapter.qualityReport?.status) {
    return QUALITY_STATUS_LABEL[chapter.qualityReport.status] ?? CHAPTER_STATUS_LABEL[effectiveChapterStatus(chapter)];
  }
  return CHAPTER_STATUS_LABEL[effectiveChapterStatus(chapter)];
}

function awaitingQualityMessage(event?: AgentEvent) {
  const stage = stageForEvent(event);
  if (stage.agent === "FORMAT") return "本章草稿已生成，正在整理 Markdown、公式与标题格式...";
  if (stage.agent === "REPAIRER") return "本章草稿已生成，正在自动返修质检发现的问题...";
  return "本章草稿已生成，正在由 REVIEWER 进行质量检查...";
}

export default function ReaderPage() {
  const { id, chapterId } = useParams<{ id: string; chapterId: string }>();
  const router = useRouter();
  const [course, setCourse] = useState<Course>();
  const [content, setContent] = useState("");
  const [sections, setSections] = useState<Section[]>([]);
  const [review, setReview] = useState("");
  const [jobEvents, setJobEvents] = useState<Record<string, AgentEvent[]>>({});
  const [loading, setLoading] = useState(true);
  const [generationError, setGenerationError] = useState("");
  const [requalitying, setRequalitying] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [tocOpen, setTocOpen] = useState(true);
  const [expandedChapters, setExpandedChapters] = useState<Record<string, boolean>>({});
  const [panel, setPanel] = useState<Panel>(null);
  const [chooser, setChooser] = useState<{ text: string; sectionId?: string } | null>(null);

  const chapter = course?.chapters.find((item) => item.id === chapterId);
  const currentIndex = course?.chapters.findIndex((c) => c.id === chapterId) ?? -1;
  const prevChapter = currentIndex > 0 && course ? course.chapters[currentIndex - 1] : null;
  const nextChapter = currentIndex < (course?.chapters.length ?? 0) - 1 && course ? course.chapters[currentIndex + 1] : null;
  const canPrint = Boolean(chapter && !loading && isChapterReadable(chapter));
  const chapterReadable = Boolean(chapter && isChapterReadable(chapter));
  const chapterAwaitingQuality = Boolean(chapter && isChapterAwaitingQuality(chapter));
  const chapterGenerationJobId = chapter?.generationJobId;
  const chapterStatus = chapter?.status;
  const isTextbook = course?.contentMode === "textbook";

  useEffect(() => {
    setExpandedChapters((current) => current[chapterId] ? current : { ...current, [chapterId]: true });
  }, [chapterId]);

  useEffect(() => {
    if (loading || typeof window === "undefined") return;
    const hash = window.location.hash;
    if (!hash.startsWith("#section-")) return;
    window.setTimeout(() => {
      document.querySelector(hash)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  }, [chapterId, loading, sections]);

  function toggleChapterSections(targetChapterId: string) {
    setExpandedChapters((current) => ({ ...current, [targetChapterId]: !current[targetChapterId] }));
  }

  function openSection(targetChapter: Chapter, sectionId: string) {
    if (targetChapter.id !== chapterId) {
      router.push(`/courses/${id}/chapters/${targetChapter.id}#section-${sectionId}`);
      return;
    }
    document.querySelector(`#section-${sectionId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function exportChapter() {
    if (!chapter || exporting) return;
    setExporting(true);
    try {
      const response = await apiFetch("/api/exports", {
        method: "POST",
        body: JSON.stringify({ courseId: id, format: "pdf", scope: "chapter", chapterId: chapter.id }),
      });
      const data = await response.json();
      if (!response.ok || !data.export) throw new Error(data.error ?? "导出失败");
      const download = await apiFetch(`/api/exports/${data.export.id}`);
      if (!download.ok) throw new Error("导出下载失败");
      const blob = await download.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = data.export.fileName ?? `${chapter.title}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(link.href);
      toast.success("PDF 已导出");
    } catch (error) {
      toast.error(publicSafeErrorMessage(error, "导出失败，请稍后重试。"));
    } finally {
      setExporting(false);
    }
  }

  const latestChapterEvent = chapterGenerationJobId ? jobEvents[chapterGenerationJobId]?.at(-1) : undefined;
  const waitMessage = chapterAwaitingQuality ? awaitingQualityMessage(latestChapterEvent) : "";

  const applyCourseUpdate = useCallback((nextCourse: Course) => {
    setCourse(nextCourse);

    const current = nextCourse.chapters.find((item) => item.id === chapterId);
    if (!current) {
      setGenerationError("");
      setLoading(false);
      return;
    }

    if (isChapterReadable(current)) {
      setGenerationError(effectiveChapterStatus(current) === "quality_failed" ? "本章质量检查未通过，下面仍展示已生成草稿。" : "");
      setContent(getChapterBody(current));
      setSections(current.sections ?? []);
      setReview(localizeReviewText(current.review, current));
      setLoading(false);
      return;
    }

    if (isChapterAwaitingQuality(current)) {
      setGenerationError("");
      setContent("");
      setSections([]);
      setReview(awaitingQualityMessage());
      setLoading(true);
      return;
    }

    setGenerationError("");
    setContent("");
    setSections([]);
    setReview(localizeReviewText(current.review, current));

    if (current.status === "failed") {
      setGenerationError("本章生成失败。");
      setLoading(false);
      return;
    }

    setLoading(true);
  }, [chapterId]);

  const tutor = useTutor(course, chapterId);
  const revise = useRevise(course, chapterId, applyCourseUpdate);

  const ensureChapterContent = useCallback(async (stored: Course, options: { retry?: boolean } = {}) => {
    const current = stored.chapters.find((item) => item.id === chapterId);
    if (!current) {
      setLoading(false);
      return;
    }

    if (isChapterReadable(current) || isChapterAwaitingQuality(current)) {
      applyCourseUpdate(stored);
      return;
    }

    if (isWaitingForBackgroundGeneration(current)) {
      applyCourseUpdate(stored);
      return;
    }

    current.status = "generating";
    applyCourseUpdate({ ...stored });

    apiFetch(`/api/chapters/${current.id}/generate`, {
      method: "POST",
      body: JSON.stringify({ courseId: stored.id, retry: options.retry === true }),
    })
      .then(async (response) => {
        const data = (await response.json()) as ChapterGenerateResponse & { course?: Course; queued?: boolean; retryBlocked?: boolean; error?: string };
        if (!response.ok && !data.retryBlocked) throw new Error(data.error ?? "本章生成失败");
        return data;
      })
      .then((data: ChapterGenerateResponse & { course?: Course; queued?: boolean; retryBlocked?: boolean; error?: string }) => {
        if (data.retryBlocked) {
          if (data.course) applyCourseUpdate(data.course);
          setGenerationError(data.error ?? "当前章节已有后台任务，请等待任务完成后再重新生成。");
          return;
        }
        if (data.queued) {
          if (data.course) {
            applyCourseUpdate(data.course);
          } else {
            current.status = "queued";
            current.generationJobId = data.job?.id;
            applyCourseUpdate({ ...stored });
          }
          return;
        }
        if (!data.content) throw new Error("本章生成失败");
        current.content = data.content;
        current.sections = data.sections;
        current.review = data.review;
        current.qualityReport = data.qualityReport;
        current.generationJobId = data.job?.id;
        current.status = data.qualityReport?.status === "failed" ? "quality_failed" : "ready";
        applyCourseUpdate({ ...stored });
      })
      .catch((error) => {
        current.status = "failed";
        applyCourseUpdate({ ...stored });
        setGenerationError(publicSafeErrorMessage(error, "本章生成失败，请刷新后重试。"));
      })
      .finally(() => setLoading(false));
  }, [applyCourseUpdate, chapterId]);

  const regenerateCurrentChapter = useCallback(() => {
    if (!course || !chapter) return;
    setGenerationError("");
    setLoading(true);
    void ensureChapterContent({
      ...course,
      chapters: course.chapters.map((item) =>
        item.id === chapter.id
          ? { ...item, status: undefined, generationJobId: undefined, content: undefined, sections: undefined, review: undefined, qualityReport: undefined }
          : item,
      ),
    }, { retry: true });
  }, [chapter, course, ensureChapterContent]);

  const requalityChapter = useCallback(async () => {
    if (!course || !chapter || requalitying) return;
    setRequalitying(true);
    try {
      const response = await apiFetch(`/api/chapters/${chapter.id}/requality`, {
        method: "POST",
        body: JSON.stringify({ courseId: course.id }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        course?: Course;
        report?: { score: number; status: string };
        error?: string;
      };
      if (!response.ok) throw new Error(data.error ?? "重新质检失败。");
      if (data.course) applyCourseUpdate(data.course);
      if (data.report) {
        toast.success(
          data.report.status === "failed"
            ? `重新质检完成：${data.report.score} / 100，仍未通过，可尝试整章重新生成。`
            : `重新质检通过：${data.report.score} / 100，本章已开放阅读。`,
        );
      }
    } catch (error) {
      toast.error(publicSafeErrorMessage(error, "重新质检失败，请稍后重试。"));
    } finally {
      setRequalitying(false);
    }
  }, [applyCourseUpdate, chapter, course, requalitying]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setGenerationError("");

    tutor.reloadAnnotations();
    revise.reloadRevisions();

    apiFetch(`/api/courses/${id}`)
      .then((response) => (response.ok ? response.json() : undefined))
      .then((data) => {
        if (cancelled) return;
        const courseData = data?.course as Course | undefined;
        if (!courseData) {
          setLoading(false);
          return;
        }
        void ensureChapterContent(courseData);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterId, id]);

  useEffect(() => {
    let cancelled = false;

    const applyJobs = (jobs: GenerationJob[]) => {
      if (cancelled || jobs.length === 0) return;
      setJobEvents((current) => ({
        ...current,
        ...Object.fromEntries(jobs.map((job) => [job.id, job.events ?? []])),
      }));
    };

    const subscription = subscribeToSse(`/api/courses/${id}/events`, {
      onMessage(message) {
        if (cancelled) return;

        if (message.event === "snapshot") {
          const snapshot = message.data as { course?: Course; jobs?: GenerationJob[] } | undefined;
          if (snapshot?.course) applyCourseUpdate(snapshot.course);
          if (snapshot?.jobs) applyJobs(snapshot.jobs);
          return;
        }

        if (message.event === "course") {
          const payload = message.data as { course?: Course } | undefined;
          if (payload?.course) applyCourseUpdate(payload.course);
          return;
        }

        if (message.event === "job") {
          const payload = message.data as { job?: GenerationJob } | undefined;
          if (payload?.job) applyJobs([payload.job]);
        }
      },
    });

    return () => {
      cancelled = true;
      subscription.close();
    };
  }, [applyCourseUpdate, id]);

  useEffect(() => {
    if (!chapter) return;
    if (chapterReadable) return;
    if (!chapterGenerationJobId && chapterStatus !== "queued" && chapterStatus !== "generating" && chapterStatus !== "draft_ready") return;

    let cancelled = false;
    const refresh = () => {
      apiFetch(`/api/courses/${id}`)
        .then((response) => (response.ok ? response.json() : undefined))
        .then((data) => {
          if (!cancelled && data?.course) applyCourseUpdate(data.course as Course);
        })
        .catch(() => undefined);
    };

    const timer = window.setInterval(refresh, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [applyCourseUpdate, chapter, chapterGenerationJobId, chapterReadable, chapterStatus, id]);

  const openTutorFromChooser = useCallback(() => {
    if (!chooser) return;
    tutor.startAnchored(chooser.text, chooser.sectionId);
    revise.clear();
    setPanel("tutor");
    setChooser(null);
  }, [chooser, tutor, revise]);

  const openReviseFromChooser = useCallback(() => {
    if (!chooser) return;
    revise.start(chooser.text, chooser.sectionId);
    tutor.clear();
    setPanel("revise");
    setChooser(null);
  }, [chooser, tutor, revise]);

  function captureSelection(event: MouseEvent<HTMLElement>) {
    const selection = window.getSelection();
    const text = selection?.toString().trim() ?? "";
    if (text.length > 2 && event.currentTarget.contains(selection?.anchorNode ?? null)) {
      setChooser({ text, sectionId: closestSectionId(selection?.anchorNode ?? null) });
    }
  }

  function captureParagraph(event: MouseEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    const block = target.closest("p, li, blockquote, h2, h3");
    const text = block?.textContent?.trim() ?? "";
    if (text.length > 2) {
      setChooser({ text, sectionId: closestSectionId(block) });
    }
  }

  if (!course || !chapter) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground font-mono">
        LOADING COURSE DATA...
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background print:block print:h-auto print:overflow-visible print:bg-white">
      {/* TOC Sidebar */}
      <aside className={`shrink-0 border-r border-border bg-card transition-all duration-300 print:hidden ${tocOpen ? "w-64" : "w-0 overflow-hidden"}`}>
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-border px-4 py-4">
            <Link href="/" className="font-mono text-sm font-bold text-foreground tracking-widest uppercase">
              Learn<span className="text-muted-foreground">By</span>AI
            </Link>
            <button onClick={() => setTocOpen(false)} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
              <X size={14} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto py-2">
            <div className="px-4 py-2 text-[10px] font-mono font-bold text-muted-foreground uppercase tracking-widest">课程目录</div>
            {course.chapters.map((ch, idx) => {
              const isActive = ch.id === chapterId;
              const readable = isChapterReadable(ch);
              const chapterSections = ch.sections ?? [];
              const sectionsExpanded = expandedChapters[ch.id] ?? isActive;
              return (
                <div key={ch.id}>
                <button
                  key={ch.id}
                  onClick={() => {
                    if (readable || isActive) router.push(`/courses/${id}/chapters/${ch.id}`);
                  }}
                  disabled={!readable && !isActive}
                  className={`w-full px-4 py-3 text-left transition-colors ${
                    isActive ? "border-l-2 border-foreground bg-foreground/5" : readable ? "border-l-2 border-transparent hover:bg-muted/30" : "cursor-not-allowed border-l-2 border-transparent opacity-55"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span className={`font-mono text-xs ${isActive ? "text-foreground" : "text-muted-foreground"}`}>{String(idx + 1).padStart(2, "0")}.</span>
                    <span className={`text-xs ${isActive ? "font-medium text-foreground" : "text-muted-foreground"}`}>{ch.title}</span>
                  </div>
                  <div className="mt-1 pl-6 text-[10px] font-mono text-muted-foreground uppercase">{chapterStatusLabel(ch)}</div>
                </button>
                {isTextbook && chapterSections.length > 0 && (
                  <div className={`border-l-2 ${isActive ? "border-foreground bg-foreground/5" : "border-transparent"}`}>
                    <button
                      type="button"
                      onClick={() => toggleChapterSections(ch.id)}
                      className="ml-8 flex items-center gap-1 py-1 text-[10px] text-muted-foreground hover:text-foreground"
                    >
                      <ChevronDown size={12} className={`transition-transform ${sectionsExpanded ? "" : "-rotate-90"}`} />
                      {sectionsExpanded ? "收起小节" : "展开小节"}
                    </button>
                    {sectionsExpanded && (
                      <div className="pb-2 pl-9 pr-3">
                        {chapterSections.map((section) => (
                          <button
                            key={section.id}
                            type="button"
                            onClick={() => {
                              if (readable || isActive) openSection(ch, section.id);
                            }}
                            disabled={!readable && !isActive}
                            className="block w-full rounded px-2 py-1.5 text-left text-[11px] leading-snug text-muted-foreground hover:bg-muted/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <span className="mr-1 font-mono">{idx + 1}.{section.order + 1}</span>
                            {section.title}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                </div>
              );
            })}
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto bg-background print:overflow-visible print:bg-white print:text-black">
        <div className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-background/95 px-6 py-3 backdrop-blur print:hidden">
          <div className="flex items-center gap-3">
            {!tocOpen && (
              <button onClick={() => setTocOpen(true)} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
                <Menu size={16} />
              </button>
            )}
            <button onClick={() => router.push(`/courses/${id}`)} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
              <ArrowLeft size={16} />
            </button>
            <span className="font-mono text-xs font-medium text-muted-foreground hidden md:inline-block">{course.topic}</span>
          </div>
          <div className="flex items-center gap-4">
            <ModelSettings showLabel />
            <ThemeToggle />
            <span className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
              <Clock size={12} />
              {formatMinutes(totalMinutes(chapter.time))}
            </span>
            <div className="h-4 w-px bg-border" />
            <button
              onClick={exportChapter}
              disabled={!canPrint || exporting}
              className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download size={14} /> {exporting ? "导出中…" : "导出 PDF"}
            </button>
            <div className="h-4 w-px bg-border" />
            <div className="flex items-center gap-1">
              {prevChapter && (
                <button onClick={() => router.push(`/courses/${id}/chapters/${prevChapter.id}`)} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
                  <ChevronLeft size={16} />
                </button>
              )}
              {nextChapter && (
                <button onClick={() => router.push(`/courses/${id}/chapters/${nextChapter.id}`)} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
                  <ChevronRight size={16} />
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-3xl px-6 py-12 lg:px-8">
          <div className="mb-12 border-l-2 border-foreground bg-muted/20 p-6">
            <h1 className="mb-4 text-3xl font-bold tracking-tight text-foreground md:text-4xl">{chapter.title}</h1>
            <div className="flex flex-wrap items-center gap-4 font-mono text-xs text-muted-foreground">
              <span>{loading ? (waitMessage || "生成中...") : `✓ ${review}`}</span>
            </div>
            <div className="mt-4 text-sm text-muted-foreground leading-relaxed border-t border-border/50 pt-4">
              <p>承接：{chapter.connectionFromPrevious ?? "这是课程起点。"}</p>
              <p className="mt-1">铺垫：{chapter.setupForNext ?? "自然引出下一章。"}</p>
            </div>
          </div>

          {chapter && effectiveChapterStatus(chapter) === "quality_failed" && hasChapterBody(chapter) ? (
            <div className="mb-8 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                    本章质量检查未通过{chapter.qualityReport ? `（${chapter.qualityReport.score} / 100）` : ""}，正文展示的是当前最佳草稿。
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    「重新质检与修复」会用最新的确定性修复规则治愈格式问题并重新评分（不消耗额度）；仍不达标时可整章重新生成。
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => void requalityChapter()}
                    disabled={requalitying}
                    className="rounded-md border border-amber-500/40 bg-background px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-500/10 disabled:opacity-50 dark:text-amber-300"
                  >
                    {requalitying ? "重新质检中…" : "重新质检与修复"}
                  </button>
                  <button
                    type="button"
                    onClick={regenerateCurrentChapter}
                    className="rounded-md border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                  >
                    重新生成本章
                  </button>
                </div>
              </div>
              {(chapter.qualityReport?.issues?.length ?? 0) > 0 && (
                <ul className="mt-3 space-y-2 border-t border-amber-500/20 pt-3">
                  {chapter.qualityReport!.issues.slice(0, 8).map((issue, issueIndex) => (
                    <li key={issueIndex} className="text-xs leading-relaxed">
                      <span className={`mr-2 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                        issue.severity === "error"
                          ? "bg-destructive/10 text-destructive"
                          : "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                      }`}>
                        {issue.severity === "error" ? "错误" : issue.severity === "warning" ? "警告" : "提示"}
                      </span>
                      <span className="text-foreground">{issue.message}</span>
                      {issue.suggestion && <span className="ml-1 text-muted-foreground">建议：{issue.suggestion}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : generationError && hasChapterBody(chapter) ? (
            <div className="mb-8 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{generationError}</div>
          ) : null}

          {loading ? (
            <div className="rounded-lg border border-dashed border-border py-24 text-center">
              <Clock size={32} className="mx-auto mb-4 animate-pulse text-muted-foreground/50" />
              <p className="font-mono text-sm text-muted-foreground">{waitMessage || "AI 正在编写本章..."}</p>
              <p className="mt-2 text-xs text-muted-foreground/60">
                {chapterAwaitingQuality ? "质检结束后，本章会自动开放阅读。" : "AI 正在根据课程全局设定编写本章。"}
              </p>
              {latestChapterEvent?.message && (
                <p className="mx-auto mt-4 max-w-lg text-xs leading-relaxed text-muted-foreground">最近事件：{latestChapterEvent.message}</p>
              )}
            </div>
          ) : generationError && !hasChapterBody(chapter) ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 py-12 text-center text-destructive">
              <p className="font-mono text-sm">{generationError}</p>
              <button
                type="button"
                onClick={regenerateCurrentChapter}
                className="mt-5 rounded-md border border-destructive/30 bg-background px-4 py-2 text-xs font-medium text-destructive hover:bg-destructive/10"
              >
                重新生成本章
              </button>
            </div>
          ) : (
            <article
              className="prose prose-invert max-w-none text-foreground prose-headings:font-bold prose-headings:tracking-tight prose-a:text-primary prose-code:font-mono prose-code:text-sm prose-pre:border prose-pre:border-border"
              onDoubleClick={captureParagraph}
              onMouseUp={captureSelection}
              title="选中文字或双击段落，选择问导师或改写此处"
            >
              {sections.length > 0 ? (
                <div className="space-y-8">
                  {sections.map((section) => (
                    <section key={section.id} id={`section-${section.id}`} data-section-id={section.id}>
                      <MarkdownContent content={section.content} />
                    </section>
                  ))}
                </div>
              ) : (
                <MarkdownContent content={content} />
              )}
            </article>
          )}

          <div className="mt-16 flex flex-col gap-4 border-t border-border pt-8 sm:flex-row sm:items-center sm:justify-between print:hidden">
            {prevChapter ? (
              <button
                onClick={() => {
                  if (isChapterReadable(prevChapter)) router.push(`/courses/${id}/chapters/${prevChapter.id}`);
                }}
                disabled={!isChapterReadable(prevChapter)}
                className="flex flex-1 items-center gap-3 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-foreground/30 hover:bg-muted/20 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border disabled:hover:bg-card"
              >
                <ChevronLeft size={20} className="text-muted-foreground" />
                <div>
                  <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">上一章</div>
                  <div className="text-sm font-medium text-foreground">{prevChapter.title}</div>
                </div>
              </button>
            ) : <div className="flex-1" />}

            {nextChapter ? (
              <button
                onClick={() => {
                  if (isChapterReadable(nextChapter)) router.push(`/courses/${id}/chapters/${nextChapter.id}`);
                }}
                disabled={!isChapterReadable(nextChapter)}
                className="flex flex-1 items-center justify-end gap-3 rounded-lg border border-border bg-card p-4 text-right transition-colors hover:border-foreground/30 hover:bg-muted/20 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border disabled:hover:bg-card"
              >
                <div>
                  <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">下一章</div>
                  <div className="text-sm font-medium text-foreground">{nextChapter.title}</div>
                </div>
                <ChevronRight size={20} className="text-muted-foreground" />
              </button>
            ) : <div className="flex-1" />}
          </div>
        </div>
      </main>

      {/* Right drawer: mutually-exclusive Tutor / Revise panels */}
      <aside className={`shrink-0 border-l border-border bg-muted/30 transition-all duration-300 print:hidden ${panel ? "w-80 lg:w-[400px]" : "w-0 overflow-hidden"}`}>
        {panel === "tutor" && <TutorPanel tutor={tutor} onClose={() => setPanel(null)} />}
        {panel === "revise" && <RevisePanel revise={revise} onClose={() => setPanel(null)} />}
      </aside>

      {/* Collapsed launchers */}
      {!panel && (
        <div className="fixed right-0 top-1/2 z-40 flex -translate-y-1/2 flex-col gap-2 print:hidden">
          <button
            onClick={() => setPanel("tutor")}
            className="flex h-12 w-12 items-center justify-center rounded-l-md border border-r-0 border-border bg-card text-muted-foreground shadow-lg transition-colors hover:text-primary"
            title="导师问答"
          >
            <Bot size={18} />
          </button>
          <button
            onClick={() => setPanel("revise")}
            className="flex h-12 w-12 items-center justify-center rounded-l-md border border-r-0 border-border bg-card text-muted-foreground shadow-lg transition-colors hover:text-primary"
            title="局部改写"
          >
            <PencilLine size={18} />
          </button>
        </div>
      )}

      {/* Selection chooser */}
      {chooser && (
        <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 shadow-xl print:hidden">
          <span className="max-w-[160px] truncate font-mono text-[10px] text-muted-foreground" title={chooser.text}>已选中：{chooser.text}</span>
          <button onClick={openTutorFromChooser} className="flex items-center gap-1 rounded border border-primary/40 bg-primary/10 px-2 py-1 font-mono text-[10px] text-primary hover:bg-primary/15">
            <Bot size={12} /> 问导师
          </button>
          <button onClick={openReviseFromChooser} className="flex items-center gap-1 rounded border border-primary/40 bg-primary/10 px-2 py-1 font-mono text-[10px] text-primary hover:bg-primary/15">
            <PencilLine size={12} /> 改写此处
          </button>
          <button onClick={() => setChooser(null)} className="rounded p-1 text-muted-foreground hover:text-foreground">
            <X size={12} />
          </button>
        </div>
      )}
    </div>
  );
}
