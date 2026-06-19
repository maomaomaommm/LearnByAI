"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, MouseEvent, useCallback, useEffect, useState } from "react";
import { MarkdownContent } from "@/components/MarkdownContent";
import { apiFetch, subscribeToSse } from "@/lib/clientApi";
import { publicSafeErrorMessage } from "@/lib/publicSafeError";
import { formatMinutes, totalMinutes } from "@/lib/time";
import { Annotation, AgentEvent, Chapter, ChapterGenerateResponse, Course, EntityStatus, GenerationJob, Section } from "@/lib/types";
import { effectiveChapterStatus, hasChapterBody, isChapterAwaitingQuality, isChapterReadable } from "@/lib/chapterReadiness";
import { stageForEvent } from "@/components/generation-studio/helpers";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ModelSettings } from "@/components/ModelSettings";
import { ArrowLeft, ChevronLeft, ChevronRight, Menu, X, Clock, MessageSquareQuote, Bot, Download } from "lucide-react";

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
  const [selectedText, setSelectedText] = useState("");
  const [selectedSectionId, setSelectedSectionId] = useState<string>();
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [active, setActive] = useState<Annotation>();
  const [repair, setRepair] = useState<RepairSuggestion>();
  const [repairing, setRepairing] = useState(false);
  const [repairError, setRepairError] = useState("");
  const [jobEvents, setJobEvents] = useState<Record<string, AgentEvent[]>>({});
  const [loading, setLoading] = useState(true);
  const [answering, setAnswering] = useState(false);
  const [generationError, setGenerationError] = useState("");

  const [tocOpen, setTocOpen] = useState(true);
  const [tutorOpen, setTutorOpen] = useState(true);

  const chapter = course?.chapters.find((item) => item.id === chapterId);
  const currentIndex = course?.chapters.findIndex((c) => c.id === chapterId) ?? -1;
  const prevChapter = currentIndex > 0 && course ? course.chapters[currentIndex - 1] : null;
  const nextChapter = currentIndex < (course?.chapters.length ?? 0) - 1 && course ? course.chapters[currentIndex + 1] : null;
  const canPrint = Boolean(chapter && !loading && isChapterReadable(chapter));
  const chapterReadable = Boolean(chapter && isChapterReadable(chapter));
  const chapterAwaitingQuality = Boolean(chapter && isChapterAwaitingQuality(chapter));
  const chapterGenerationJobId = chapter?.generationJobId;
  const chapterStatus = chapter?.status;
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
      setGenerationError(effectiveChapterStatus(current) === "quality_failed" ? "\u672c\u7ae0\u8d28\u91cf\u68c0\u67e5\u672a\u901a\u8fc7\uff0c\u4e0b\u9762\u4ecd\u5c55\u793a\u5df2\u751f\u6210\u8349\u7a3f\u3002" : "");
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

  const ensureChapterContent = useCallback(async (stored: Course) => {
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
      handleTextSelect(text, closestSectionId(selection?.anchorNode ?? null));
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
    const annotation: Annotation =
      active ??
      ({
        id: crypto.randomUUID(),
        courseId: course.id,
        chapterId,
        sectionId: selectedSectionId,
        selectedText,
        question,
        messages: [],
        createdAt: new Date().toISOString(),
      } satisfies Annotation);

    annotation.messages.push({ id: crypto.randomUUID(), role: "user", content: question });
    setActive({ ...annotation });

    // Show a pending assistant message immediately for streaming
    const pendingMessageId = crypto.randomUUID();
    const pendingMessage = { id: pendingMessageId, role: "assistant" as const, content: "" };
    annotation.messages.push(pendingMessage);
    setActive({ ...annotation });

    let savedAnnotation: Annotation | undefined;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), TUTOR_REQUEST_TIMEOUT_MS);
    try {
      savedAnnotation = await askTutorStreaming({
        topic: course.topic,
        selectedText: annotation.selectedText,
        question,
        history: annotation.messages.filter((m) => m.id !== pendingMessageId),
        sectionId: annotation.sectionId,
        annotation,
        signal: controller.signal,
        onToken: (chunk) => {
          annotation.messages = annotation.messages.map((m) =>
            m.id === pendingMessageId ? { ...m, content: m.content + chunk } : m,
          );
          setActive({ ...annotation });
        },
      });
    } catch (error) {
      const message = controller.signal.aborted
        ? "导师回答超时，请稍后重试。"
        : publicSafeErrorMessage(error, "导师暂时无法回答，请稍后重试。");
      annotation.messages = annotation.messages.map((m) =>
        m.id === pendingMessageId
          ? { ...m, content: message }
          : m,
      );
      setActive({ ...annotation });
    } finally {
      window.clearTimeout(timeout);
      setAnswering(false);
    }

    if (savedAnnotation) {
      setAnnotations((current) => upsertAnnotation(current, savedAnnotation));
    }
    setActive({ ...(savedAnnotation ?? annotation) });
  }

  function submitQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.elements.namedItem("question") as HTMLInputElement;
    void ask(input.value);
    input.value = "";
  }

  async function requestRepair(userMessage: string) {
    const targetText = (active?.selectedText ?? selectedText).trim();
    if (!course || !chapter || !targetText || !userMessage.trim()) return;

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REPAIR_REQUEST_TIMEOUT_MS);
    setRepairing(true);
    setRepairError("");
    setRepair(undefined);

    try {
      const response = await apiFetch("/api/repairs", {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify({
          courseId: course.id,
          chapterId: chapter.id,
          sectionId: active?.sectionId ?? selectedSectionId,
          selectedText: targetText,
          userMessage,
        }),
      });
      const data = await response.json().catch(() => null) as { repair?: RepairSuggestion; error?: string } | null;
      if (!response.ok) throw new Error(data?.error ?? `Repair request failed (${response.status}).`);
      if (!data?.repair) throw new Error("Repair suggestion is empty.");
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
    if (!repair || repair.status === "applied") return;

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
      const data = await response.json().catch(() => null) as { course?: Course; error?: string } | null;
      if (!response.ok) throw new Error(data?.error ?? `Apply repair failed (${response.status}).`);
      if (data?.course) applyCourseUpdate(data.course);
      setRepair({ ...repair, status: "applied" });
      setSelectedText(repair.afterText);
      setSelectedSectionId(repair.sectionId);
      setActive(undefined);
    } catch (error) {
      setRepairError(publicSafeErrorMessage(error, "应用修复失败，请稍后重试。"));
    } finally {
      setRepairing(false);
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
            <div className="px-4 py-2 text-[10px] font-mono font-bold text-muted-foreground uppercase tracking-widest">
              课程目录
            </div>
            {course.chapters.map((ch, idx) => {
              const isActive = ch.id === chapterId;
              const readable = isChapterReadable(ch);
              return (
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
              <span>{loading ? (waitMessage || "生成中...") : `\u2713 ${review}`}</span>
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
              <p className="font-mono text-sm text-muted-foreground">
                {waitMessage || "AI 正在编写本章..."}
              </p>
              <p className="mt-2 text-xs text-muted-foreground/60">
                {chapterAwaitingQuality ? "质检结束后，本章会自动开放阅读。" : "AI 正在根据课程全局设定编写本章。"}
              </p>
              {latestChapterEvent?.message && (
                <p className="mx-auto mt-4 max-w-lg text-xs leading-relaxed text-muted-foreground">
                  最近事件：{latestChapterEvent.message}
                </p>
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
              </div>

              {(repair || repairError) && (
                <div className="space-y-3 border border-border bg-background/70 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-[10px] text-primary uppercase tracking-wider">REPAIR_SUGGESTION</span>
                    {repair?.status === "applied" && (
                      <span className="font-mono text-[10px] text-muted-foreground">APPLIED</span>
                    )}
                  </div>
                  {repairError && (
                    <p className="text-xs leading-relaxed text-destructive">{repairError}</p>
                  )}
                  {repair && (
                    <>
                      <div>
                        <p className="mb-1 font-mono text-[10px] text-muted-foreground">DIAGNOSIS</p>
                        <p className="text-xs leading-relaxed text-muted-foreground">{repair.diagnosis}</p>
                      </div>
                      <div>
                        <p className="mb-1 font-mono text-[10px] text-muted-foreground">PATCH_PREVIEW</p>
                        <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap border border-border bg-muted/40 p-2 text-xs leading-relaxed text-foreground">{repair.afterText}</pre>
                      </div>
                      <button
                        type="button"
                        onClick={applyRepair}
                        disabled={repairing || repair.status === "applied"}
                        className="w-full border border-primary/50 bg-primary/10 px-3 py-2 font-mono text-[11px] text-primary transition-colors hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {repair.status === "applied" ? "已应用修复" : repairing ? "应用中..." : "应用修复"}
                      </button>
                    </>
                  )}
                </div>
              )}
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
            <div className="mb-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => requestRepair("请检查这段内容是否有公式、Markdown 或概念错误，先给出修复建议。")}
                disabled={repairing}
                className="border border-border bg-background px-2 py-1.5 font-mono text-[10px] text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {repairing ? "检查中..." : "检查/建议"}
              </button>
              <button
                type="button"
                onClick={() => requestRepair("请修复这段内容中的格式、公式或明显表述问题，只做最小必要修改。")}
                disabled={repairing}
                className="border border-border bg-background px-2 py-1.5 font-mono text-[10px] text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {repairing ? "修复中..." : "最小修复"}
              </button>
            </div>
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
            </div>
            <form onSubmit={submitQuestion} className="relative flex items-center">
              <span className="absolute left-3 font-mono text-[12px] text-primary">{">"}</span>
              <input
                name="question"
                placeholder="\u8f93\u5165\u95ee\u9898..."
                autoComplete="off"
                disabled={answering}
                className="w-full bg-background border border-border py-2 pl-7 pr-3 font-mono text-[12px] text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none disabled:opacity-50"
              />
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

async function askTutorStreaming(input: {
  topic: string;
  selectedText: string;
  question: string;
  history: { role: string; content: string }[];
  sectionId?: string;
  annotation: Annotation;
  signal?: AbortSignal;
  onToken: (chunk: string) => void;
}): Promise<Annotation | undefined> {
  const response = await apiFetch("/api/annotations", {
    method: "POST",
    signal: input.signal,
    body: JSON.stringify({
      topic: input.topic,
      selectedText: input.selectedText,
      question: input.question,
      history: input.history,
      sectionId: input.sectionId,
      annotation: input.annotation,
      stream: true,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(errorData?.error ?? `Tutor request failed (${response.status}).`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("Streaming not supported.");

  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Split by double newline (SSE message boundary)
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      const lines = part.split("\n");
      let eventType = "message";
      let data = "";

      for (const line of lines) {
        if (line.startsWith("event: ")) {
          eventType = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          data = line.slice(6);
        }
      }

      if (!data) continue;

      try {
        const parsed = JSON.parse(data);
        if (eventType === "token") {
          input.onToken(parsed.text ?? "");
        } else if (eventType === "done") {
          return parsed.annotation ?? undefined;
        } else if (eventType === "error") {
          throw new Error(parsed.error ?? "Tutor request failed.");
        }
      } catch (error) {
        if (error instanceof SyntaxError) continue;
        throw error;
      }
    }
  }

  return undefined;
}
