"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, MouseEvent, useCallback, useEffect, useState } from "react";
import { MarkdownContent } from "@/components/MarkdownContent";
import { apiFetch, subscribeToSse } from "@/lib/clientApi";
import { publicSafeErrorMessage } from "@/lib/publicSafeError";
import { formatMinutes, totalMinutes } from "@/lib/time";
import { Annotation, Chapter, ChapterGenerateResponse, Course, EntityStatus, Section } from "@/lib/types";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ModelSettings } from "@/components/ModelSettings";
import { ArrowLeft, ChevronLeft, ChevronRight, Menu, X, Clock, MessageSquareQuote, Bot, Download, Send } from "lucide-react";

const quickQuestions = [
  "\u89e3\u91ca\u5f97\u66f4\u7b80\u5355",
  "\u7ed9\u6211\u4e00\u4e2a\u5177\u4f53\u4f8b\u5b50",
  "\u5c55\u793a\u63a8\u5bfc\u8fc7\u7a0b",
  "\u8d28\u7591\u8fd9\u6bb5\u5185\u5bb9",
];
const DEFAULT_REVIEW = "\u5df2\u5b8c\u6210\u7ed3\u6784\u3001\u672f\u8bed\u4e0e\u516c\u5f0f\u4e00\u81f4\u6027\u68c0\u67e5\u3002";
const DRAFT_REVIEW = "\u8349\u7a3f\u5df2\u4fdd\u5b58\uff0c\u683c\u5f0f\u4fee\u590d\u548c\u8d28\u91cf\u68c0\u67e5\u4ecd\u5728\u7ee7\u7eed\u3002";
const FORMAT_GUARD_REVIEW = "\u5df2\u901a\u8fc7\u683c\u5f0f\u4fee\u590d\uff0c\u5b8c\u6210 Markdown\u3001\u516c\u5f0f\u3001\u4ee3\u7801\u5757\u4e0e\u6807\u9898\u683c\u5f0f\u68c0\u67e5\u3002";
const QUALITY_FAILED_REVIEW = "\u5df2\u751f\u6210\u8349\u7a3f\uff0c\u4f46\u8d28\u91cf\u68c0\u67e5\u672a\u901a\u8fc7\uff0c\u4e0b\u9762\u4ecd\u5c55\u793a\u5df2\u751f\u6210\u5185\u5bb9\u3002";
const TUTOR_REQUEST_TIMEOUT_MS = 70_000;
const REPAIR_REQUEST_TIMEOUT_MS = 70_000;

const CHAPTER_STATUS_LABEL: Record<EntityStatus, string> = {
  pending: "\u5f85\u751f\u6210",
  queued: "\u961f\u5217\u4e2d",
  generating: "\u751f\u6210\u4e2d",
  draft_ready: "\u5f85\u8d28\u68c0\u8349\u7a3f",
  quality_failed: "\u8d28\u68c0\u672a\u901a\u8fc7",
  ready: "\u8d28\u68c0\u901a\u8fc7",
  failed: "\u751f\u6210\u5931\u8d25",
};

const QUALITY_STATUS_LABEL: Record<string, string> = {
  passed: "\u8d28\u68c0\u901a\u8fc7",
  warning: "\u8d28\u68c0\u901a\u8fc7",
  failed: "\u8d28\u68c0\u672a\u901a\u8fc7",
};

type RepairSuggestion = {
  id: string;
  courseId: string;
  chapterId: string;
  sectionId?: string;
  selectedText: string;
  userMessage: string;
  issueType: string;
  diagnosis: string;
  beforeText: string;
  afterText: string;
  confidence: "low" | "medium" | "high";
  status: "proposed" | "applied";
  createdAt: string;
};

function hasChapterBody(chapter: Chapter) {
  return Boolean(chapter.content || chapter.sections?.length);
}

function getChapterBody(chapter: Chapter) {
  return chapter.content ?? chapter.sections?.map((section) => section.content).join("\n\n") ?? "";
}

function isWaitingForBackgroundGeneration(chapter: Chapter) {
  return Boolean(chapter.generationJobId);
}

function effectiveChapterStatus(chapter: Chapter): EntityStatus {
  if (hasChapterBody(chapter)) {
    if (chapter.qualityReport?.status === "failed" || chapter.status === "quality_failed") return "quality_failed";
    if (chapter.status === "ready" || chapter.qualityReport?.status === "passed" || chapter.qualityReport?.status === "warning") return "ready";
    return "draft_ready";
  }
  return chapter.status ?? "pending";
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
    .replace(
      "AUTHOR draft saved. Format Guard and quality review are still running.",
      DRAFT_REVIEW,
    )
    .replace(
      "Format Guard completed Markdown, formula, code block, and heading repairs.",
      FORMAT_GUARD_REVIEW,
    )
    .replace(
      "\u5df2\u901a\u8fc7 Format Guard \u5b8c\u6210 Markdown\u3001\u516c\u5f0f\u3001\u4ee3\u7801\u5757\u4e0e\u6807\u9898\u683c\u5f0f\u4fee\u590d\u3002",
      FORMAT_GUARD_REVIEW,
    )
    .replace(
      "Chapter generation failed.",
      "\u672c\u7ae0\u751f\u6210\u5931\u8d25\u3002",
    );
}

function chapterStatusLabel(chapter: Chapter) {
  if (hasChapterBody(chapter) && chapter.qualityReport?.status) {
    return QUALITY_STATUS_LABEL[chapter.qualityReport.status] ?? CHAPTER_STATUS_LABEL[effectiveChapterStatus(chapter)];
  }
  return CHAPTER_STATUS_LABEL[effectiveChapterStatus(chapter)];
}

export default function ReaderPage() {
  const { id, chapterId } = useParams<{ id: string; chapterId: string }>();
  const router = useRouter();
  const [course, setCourse] = useState<Course>();
  const [content, setContent] = useState("");
  const [sections, setSections] = useState<Section[]>([]);
  const [review, setReview] = useState("");
  const [selectedText, setSelectedText] = useState("");
  const [selectedSectionId, setSelectedSectionId] = useState<string | undefined>();
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [active, setActive] = useState<Annotation>();
  const [repair, setRepair] = useState<RepairSuggestion>();
  const [repairing, setRepairing] = useState(false);
  const [repairError, setRepairError] = useState("");
  const [loading, setLoading] = useState(true);
  const [answering, setAnswering] = useState(false);
  const [question, setQuestion] = useState("");
  const [generationError, setGenerationError] = useState("");

  const [tocOpen, setTocOpen] = useState(true);
  const [tutorOpen, setTutorOpen] = useState(true);

  const chapter = course?.chapters.find((item) => item.id === chapterId);
  const currentIndex = course?.chapters.findIndex((c) => c.id === chapterId) ?? -1;
  const prevChapter = currentIndex > 0 && course ? course.chapters[currentIndex - 1] : null;
  const nextChapter = currentIndex < (course?.chapters.length ?? 0) - 1 && course ? course.chapters[currentIndex + 1] : null;
  const canPrint = Boolean(chapter && !loading && hasChapterBody(chapter));
  const chapterHasBody = Boolean(chapter && hasChapterBody(chapter));
  const chapterGenerationJobId = chapter?.generationJobId;
  const chapterStatus = chapter?.status;

  const applyCourseUpdate = useCallback((nextCourse: Course) => {
    setCourse(nextCourse);

    const current = nextCourse.chapters.find((item) => item.id === chapterId);
    if (!current) {
      setGenerationError("");
      setLoading(false);
      return;
    }

    if (hasChapterBody(current)) {
      setGenerationError(effectiveChapterStatus(current) === "quality_failed" ? "\u672c\u7ae0\u8d28\u91cf\u68c0\u67e5\u672a\u901a\u8fc7\uff0c\u4e0b\u9762\u4ecd\u5c55\u793a\u5df2\u751f\u6210\u8349\u7a3f\u3002" : "");
      setContent(getChapterBody(current));
      setSections(current.sections ?? []);
      setReview(localizeReviewText(current.review, current));
      setLoading(false);
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

  const ensureChapterContent = useCallback(async (stored: Course) => {
    const current = stored.chapters.find((item) => item.id === chapterId);
    if (!current) {
      setLoading(false);
      return;
    }

    if (hasChapterBody(current)) {
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
      body: JSON.stringify({ courseId: stored.id }),
    })
      .then(async (response) => {
        const data = (await response.json()) as ChapterGenerateResponse & { course?: Course; queued?: boolean; error?: string };
        if (!response.ok) throw new Error(data.error ?? "本章生成失败");
        return data;
      })
      .then((data: ChapterGenerateResponse & { course?: Course; queued?: boolean }) => {
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
          ? {
              ...item,
              status: undefined,
              generationJobId: undefined,
              content: undefined,
              sections: undefined,
              review: undefined,
              qualityReport: undefined,
            }
          : item,
      ),
    });
  }, [chapter, course, ensureChapterContent]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setGenerationError("");
    setAnnotations([]);

    apiFetch(`/api/annotations?chapterId=${chapterId}`)
      .then((response) => (response.ok ? response.json() : undefined))
      .then((data) => {
        if (!cancelled && data?.annotations) setAnnotations(data.annotations);
      })
      .catch(() => undefined);

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
  }, [applyCourseUpdate, chapterId, ensureChapterContent, id]);

  useEffect(() => {
    let cancelled = false;

    const subscription = subscribeToSse(`/api/courses/${id}/events`, {
      onMessage(message) {
        if (cancelled) return;

        if (message.event === "snapshot") {
          const snapshot = message.data as { course?: Course } | undefined;
          if (snapshot?.course) applyCourseUpdate(snapshot.course);
          return;
        }

        if (message.event === "course") {
          const payload = message.data as { course?: Course } | undefined;
          if (payload?.course) applyCourseUpdate(payload.course);
        }
      },
    });

    return () => {
      cancelled = true;
      subscription.close();
    };
  }, [applyCourseUpdate, id]);

  useEffect(() => {
    if (!chapter || chapterHasBody) return;
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
  }, [applyCourseUpdate, chapter, chapterGenerationJobId, chapterHasBody, chapterStatus, id]);

  const handleTextSelect = useCallback((text: string, sectionId?: string) => {
    if (text.length > 2) {
      setSelectedText(text);
      setSelectedSectionId(sectionId);
      setActive(undefined);
      setRepair(undefined);
      setRepairError("");
      setTutorOpen(true);
    }
  }, []);

  const handleParagraphDoubleClick = useCallback((text: string, sectionId?: string) => {
    if (text.length > 2) {
      setSelectedText(text);
      setSelectedSectionId(sectionId);
      setActive(undefined);
      setRepair(undefined);
      setRepairError("");
      setTutorOpen(true);
    }
  }, []);

  function captureSelection(event: MouseEvent<HTMLElement>) {
    const selection = window.getSelection();
    const text = selection?.toString().trim() ?? "";
    if (text.length > 2 && event.currentTarget.contains(selection?.anchorNode ?? null)) {
      const sectionId = closestSectionId(selection?.anchorNode);
      handleTextSelect(text, sectionId);
    }
  }

  function captureParagraph(event: MouseEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    const block = target.closest("p, li, blockquote, h2, h3");
    const text = block?.textContent?.trim() ?? "";
    if (text.length > 2) {
      handleParagraphDoubleClick(text, closestSectionId(block));
    }
  }

  async function ask(question: string) {
    if (!course || (!selectedText && !active) || !question.trim()) return;
    setAnswering(true);
    const baseAnnotation: Annotation =
      active
        ? { ...active, messages: [...active.messages] }
        : ({
            id: crypto.randomUUID(),
            courseId: course.id,
            chapterId,
            sectionId: selectedSectionId,
            selectedText,
            question,
            messages: [],
            createdAt: new Date().toISOString(),
          } satisfies Annotation);
    const userMessage = { id: crypto.randomUUID(), role: "user" as const, content: question };
    const pendingAnnotation = {
      ...baseAnnotation,
      question: baseAnnotation.question || question,
      messages: [...baseAnnotation.messages, userMessage],
    };

    setActive(pendingAnnotation);

    let answer: string;
    let savedAnnotation: Annotation | undefined;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), TUTOR_REQUEST_TIMEOUT_MS);
    try {
      const response = await apiFetch("/api/annotations", {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify({
          topic: course.topic,
          selectedText: pendingAnnotation.selectedText,
          question,
          history: pendingAnnotation.messages,
          sectionId: pendingAnnotation.sectionId,
          annotation: pendingAnnotation,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Tutor request failed.");
      }
      answer = data.answer;
      savedAnnotation = data.annotation;
    } catch (error) {
      answer = controller.signal.aborted
        ? "导师回答超时，请稍后重试。"
        : publicSafeErrorMessage(error, "导师暂时无法回答，请稍后重试。");
    } finally {
      window.clearTimeout(timeout);
      setAnswering(false);
    }

    if (savedAnnotation) {
      setAnnotations((current) => upsertAnnotation(current, savedAnnotation));
    } else {
      pendingAnnotation.messages = [
        ...pendingAnnotation.messages,
        { id: crypto.randomUUID(), role: "assistant", content: answer },
      ];
    }
    setActive(savedAnnotation ?? pendingAnnotation);
  }

  async function requestRepair(userMessage: string) {
    if (!course || (!selectedText && !active)) return;
    setRepairing(true);
    setRepairError("");
    setRepair(undefined);
    const targetText = active?.selectedText ?? selectedText;
    const sectionId = active?.sectionId ?? selectedSectionId;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REPAIR_REQUEST_TIMEOUT_MS);

    try {
      const response = await apiFetch("/api/repairs", {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify({
          courseId: course.id,
          chapterId,
          sectionId,
          selectedText: targetText,
          userMessage,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Repair suggestion failed.");
      setRepair(data.repair);
    } catch (error) {
      setRepairError(
        controller.signal.aborted
          ? "修复建议生成超时，请稍后重试。"
          : publicSafeErrorMessage(error, "暂时无法生成修复建议，请稍后重试。"),
      );
    } finally {
      window.clearTimeout(timeout);
      setRepairing(false);
    }
  }

  async function applyRepair() {
    if (!repair) return;
    setRepairing(true);
    setRepairError("");

    try {
      const response = await apiFetch("/api/repairs/apply", {
        method: "POST",
        body: JSON.stringify({
          courseId: repair.courseId,
          chapterId: repair.chapterId,
          sectionId: repair.sectionId,
          beforeText: repair.beforeText,
          afterText: repair.afterText,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Apply repair failed.");
      if (data.course) applyCourseUpdate(data.course as Course);
      setRepair({ ...repair, status: "applied" });
      setSelectedText(repair.afterText);
      setRepairError("");
    } catch (error) {
      setRepairError(publicSafeErrorMessage(error, "Apply repair failed."));
    } finally {
      setRepairing(false);
    }
  }

  function submitQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submittedQuestion = question.trim();
    if (!submittedQuestion || answering) return;
    setQuestion("");
    void ask(submittedQuestion);
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
            <div className="px-4 py-2 text-[10px] font-mono font-bold text-muted-foreground uppercase tracking-widest">
              课程目录
            </div>
            {course.chapters.map((ch, idx) => {
              const isActive = ch.id === chapterId;
              return (
                <button
                  key={ch.id}
                  onClick={() => router.push(`/courses/${id}/chapters/${ch.id}`)}
                  className={`w-full px-4 py-3 text-left transition-colors ${
                    isActive ? "border-l-2 border-foreground bg-foreground/5" : "border-l-2 border-transparent hover:bg-muted/30"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span className={`font-mono text-xs ${isActive ? "text-foreground" : "text-muted-foreground"}`}>{String(idx + 1).padStart(2, '0')}.</span>
                    <span className={`text-xs ${isActive ? "font-medium text-foreground" : "text-muted-foreground"}`}>{ch.title}</span>
                  </div>
                  <div className="mt-1 pl-6 text-[10px] font-mono text-muted-foreground uppercase">
                    {chapterStatusLabel(ch)}
                  </div>
                </button>
              );
            })}

            <div className="mt-6 px-4 py-2 text-[10px] font-mono font-bold text-muted-foreground uppercase tracking-widest">
              本章讨论档案 · {annotations.length}
            </div>
            {annotations.map((annotation) => (
              <button
                key={annotation.id}
                onClick={() => {
                  setActive(annotation);
                  setSelectedText("");
                  setSelectedSectionId(annotation.sectionId);
                  setRepair(undefined);
                  setRepairError("");
                  setTutorOpen(true);
                }}
                className={`w-full px-4 py-2 text-left transition-colors ${
                  active?.id === annotation.id ? "bg-muted/50 text-foreground" : "text-muted-foreground hover:bg-muted/30 hover:text-foreground"
                }`}
              >
                <div className="text-xs line-clamp-2 leading-relaxed">
                  &quot;{annotation.selectedText}&quot;
                </div>
              </button>
            ))}
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto bg-background print:overflow-visible print:bg-white print:text-black">
        {/* Toolbar */}
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
              onClick={() => window.print()}
              disabled={!canPrint}
              className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download size={14} /> 导出 PDF
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

        {/* Content */}
        <div className="mx-auto max-w-3xl px-6 py-12 lg:px-8">
          <div className="mb-12 border-l-2 border-foreground bg-muted/20 p-6">
            <h1 className="mb-4 text-3xl font-bold tracking-tight text-foreground md:text-4xl">{chapter.title}</h1>
            <div className="flex flex-wrap items-center gap-4 font-mono text-xs text-muted-foreground">
              <span>{loading ? "\u751f\u6210\u4e2d..." : `\u2713 ${review}`}</span>
            </div>
            <div className="mt-4 text-sm text-muted-foreground leading-relaxed border-t border-border/50 pt-4">
              <p>承接：{chapter.connectionFromPrevious ?? "这是课程起点。"}</p>
              <p className="mt-1">铺垫：{chapter.setupForNext ?? "自然引出下一章。"}</p>
            </div>
          </div>

          {generationError && hasChapterBody(chapter) && (
            <div className="mb-8 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {generationError}
            </div>
          )}

          {loading ? (
            <div className="rounded-lg border border-dashed border-border py-24 text-center">
              <Clock size={32} className="mx-auto mb-4 animate-pulse text-muted-foreground/50" />
              <p className="font-mono text-sm text-muted-foreground">AI {"\u6b63\u5728\u7f16\u5199\u672c\u7ae0..."}</p>
              <p className="mt-2 text-xs text-muted-foreground/60">AI {"\u6b63\u5728\u6839\u636e\u8bfe\u7a0b\u5168\u5c40\u8bbe\u5b9a\u7f16\u5199\u672c\u7ae0"}</p>
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
              title="选中文字或双击段落，在右侧展开讨论"
            >
              {sections.length > 0 ? (
                <div className="space-y-8">
                  {sections.map((section) => (
                    <section key={section.id} data-section-id={section.id}>
                      <MarkdownContent content={section.content} />
                    </section>
                  ))}
                </div>
              ) : (
                <MarkdownContent content={content} />
              )}
            </article>
          )}

          {/* Chapter Nav */}
          <div className="mt-16 flex flex-col gap-4 border-t border-border pt-8 sm:flex-row sm:items-center sm:justify-between print:hidden">
            {prevChapter ? (
              <button onClick={() => router.push(`/courses/${id}/chapters/${prevChapter.id}`)} className="flex flex-1 items-center gap-3 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-foreground/30 hover:bg-muted/20">
                <ChevronLeft size={20} className="text-muted-foreground" />
                <div>
                  <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">上一章</div>
                  <div className="text-sm font-medium text-foreground">{prevChapter.title}</div>
                </div>
              </button>
            ) : <div className="flex-1" />}
            
            {nextChapter ? (
              <button onClick={() => router.push(`/courses/${id}/chapters/${nextChapter.id}`)} className="flex flex-1 items-center justify-end gap-3 rounded-lg border border-border bg-card p-4 text-right transition-colors hover:border-foreground/30 hover:bg-muted/20">
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

      {/* Tutor Sidebar (Terminal Style) */}
      <aside className={`shrink-0 border-l border-border bg-muted/30 flex flex-col transition-all duration-300 print:hidden ${tutorOpen ? "w-80 lg:w-[400px]" : "w-0 overflow-hidden"}`}>
        <div className="flex items-center justify-between border-b border-border bg-card px-4 py-3">
          <div className="flex items-center gap-2">
            <Bot size={14} className="text-primary" />
            <span className="font-mono text-[11px] font-medium text-primary uppercase tracking-wider">{"\u5bfc\u5e08\u7ec8\u7aef"}</span>
          </div>
          <button onClick={() => setTutorOpen(false)} className="rounded p-1 text-muted-foreground hover:text-foreground">
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent">
          {selectedText || active ? (
            <div className="space-y-6">
              <div className="border-l-2 border-primary pl-3">
                <p className="font-mono text-[10px] text-muted-foreground mb-1">TARGET_TEXT</p>
                <div className="text-sm leading-relaxed text-foreground italic">
                  &quot;{active?.selectedText ?? selectedText}&quot;
                </div>
              </div>

              <div className="space-y-4">
                {active?.messages.map((message) => (
                  <div key={message.id} className="flex flex-col gap-1">
                    <span className={`font-mono text-[10px] ${message.role === "user" ? "text-primary" : "text-muted-foreground"}`}>
                      {message.role === "user" ? "> USER" : "> TUTOR_AI"}
                    </span>
                    <div className={`prose prose-invert prose-sm max-w-none ${message.role === "user" ? "text-foreground" : "text-muted-foreground"}`}>
                      <MarkdownContent content={message.content} />
                    </div>
                  </div>
                ))}
                {answering && (
                  <div className="flex items-center gap-2 text-primary">
                    <span className="font-mono text-[10px] animate-pulse">{"\u5904\u7406\u4e2d..."}</span>
                  </div>
                )}
                {repair && (
                  <div className="rounded-md border border-primary/30 bg-background p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="font-mono text-[10px] uppercase tracking-wider text-primary">
                        REPAIR · {repair.confidence}
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {repair.status === "applied" ? "已应用" : "待确认"}
                      </span>
                    </div>
                    <p className="mb-3 text-xs leading-relaxed text-muted-foreground">{repair.diagnosis}</p>
                    <div className="space-y-2">
                      <div>
                        <p className="mb-1 font-mono text-[10px] text-muted-foreground">原文</p>
                        <div className="max-h-28 overflow-y-auto rounded border border-border bg-muted/30 p-2 text-xs leading-relaxed text-muted-foreground">
                          <MarkdownContent content={repair.beforeText} />
                        </div>
                      </div>
                      <div>
                        <p className="mb-1 font-mono text-[10px] text-muted-foreground">修复后</p>
                        <div className="max-h-36 overflow-y-auto rounded border border-primary/20 bg-primary/5 p-2 text-xs leading-relaxed text-foreground">
                          <MarkdownContent content={repair.afterText} />
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => void applyRepair()}
                        disabled={repairing || repair.status === "applied"}
                        className="rounded border border-primary/40 bg-primary/10 px-2 py-1 font-mono text-[10px] text-primary hover:bg-primary/15 disabled:opacity-50"
                      >
                        应用修改
                      </button>
                      <button
                        type="button"
                        onClick={() => setRepair(undefined)}
                        disabled={repairing}
                        className="rounded border border-border bg-background px-2 py-1 font-mono text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                )}
                {repairing && (
                  <div className="flex items-center gap-2 text-primary">
                    <span className="font-mono text-[10px] animate-pulse">{"\u4fee\u590d\u5efa\u8bae\u5904\u7406\u4e2d..."}</span>
                  </div>
                )}
                {repairError && (
                  <div className="rounded border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
                    {repairError}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center text-center text-muted-foreground">
              <MessageSquareQuote size={32} className="mb-4 opacity-50" />
              <p className="font-mono text-xs leading-relaxed max-w-[200px]">
                {"\u9009\u4e2d\u6587\u5b57\u6216\u53cc\u51fb\u6bb5\u843d\u540e\u53d1\u8d77\u95ee\u7b54"}
              </p>
            </div>
          )}
        </div>

        {(selectedText || active) && (
          <div className="border-t border-border bg-card p-4">
            <div className="mb-3 flex flex-wrap gap-2">
              {quickQuestions.map((q) => (
                <button
                  key={q}
                  onClick={() => ask(q)}
                  disabled={answering}
                  className="rounded border border-border bg-background px-2 py-1 font-mono text-[10px] text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-50 transition-colors"
                >
                  {q}
                </button>
              ))}
              <button
                type="button"
                onClick={() => void requestRepair("请检查这段内容是否有公式、Markdown 或概念错误，先给出修复建议。")}
                disabled={repairing}
                className="rounded border border-border bg-background px-2 py-1 font-mono text-[10px] text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-50 transition-colors"
              >
                {repairing ? "检查中..." : "检查问题"}
              </button>
              <button
                type="button"
                onClick={() => void requestRepair("请修复这段内容中的格式、公式或明显表述问题，只做最小必要修改。")}
                disabled={repairing}
                className="rounded border border-primary/40 bg-primary/10 px-2 py-1 font-mono text-[10px] text-primary hover:bg-primary/15 disabled:opacity-50 transition-colors"
              >
                {repairing ? "修复中..." : "修复这段"}
              </button>
            </div>
            <form onSubmit={submitQuestion} className="flex items-stretch gap-2">
              <div className="relative flex-1">
                <span className="absolute left-3 font-mono text-[12px] text-primary">{">"}</span>
                <input
                  name="question"
                  placeholder="\u8f93\u5165\u95ee\u9898..."
                  autoComplete="off"
                  disabled={answering}
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  className="h-full w-full bg-background border border-border py-2 pl-7 pr-3 font-mono text-[12px] text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none disabled:opacity-50"
                />
              </div>
              <button
                type="submit"
                disabled={answering || !question.trim()}
                className="inline-flex min-w-16 items-center justify-center gap-1.5 rounded border border-primary/50 bg-primary/10 px-3 font-mono text-[11px] text-primary hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
                aria-label={answering ? "正在发送问题" : "发送问题"}
              >
                <Send size={13} />
                {answering ? "回答中" : "发送"}
              </button>
            </form>
          </div>
        )}
      </aside>

      {!tutorOpen && (
        <button onClick={() => setTutorOpen(true)} className="fixed right-0 top-1/2 z-40 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-l-md border border-r-0 border-border bg-card text-muted-foreground shadow-lg hover:text-foreground transition-colors print:hidden" title="展开终端">
          <MessageSquareQuote size={18} />
        </button>
      )}
    </div>
  );
}

function upsertAnnotation(annotations: Annotation[], annotation: Annotation) {
  const index = annotations.findIndex((item) => item.id === annotation.id);
  if (index === -1) return [...annotations, annotation];
  return annotations.map((item) => (item.id === annotation.id ? annotation : item));
}

function closestSectionId(node: Node | null | undefined) {
  const element = node instanceof Element ? node : node?.parentElement;
  return element?.closest<HTMLElement>("[data-section-id]")?.dataset.sectionId;
}
