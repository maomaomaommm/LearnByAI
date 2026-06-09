"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, MouseEvent, useCallback, useEffect, useState } from "react";
import { MarkdownContent } from "@/components/MarkdownContent";
import { apiFetch, subscribeToSse } from "@/lib/clientApi";
import { publicSafeErrorMessage } from "@/lib/publicSafeError";
import { getAnnotations, getCourse, saveAnnotation, saveCourse } from "@/lib/storage";
import { formatMinutes, totalMinutes } from "@/lib/time";
import { Annotation, Chapter, ChapterGenerateResponse, Course, Section } from "@/lib/types";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ModelSettings } from "@/components/ModelSettings";
import { ArrowLeft, ChevronLeft, ChevronRight, Menu, X, Clock, MessageSquareQuote, Bot, Download } from "lucide-react";

const quickQuestions = ["解释得更简单", "给我一个具体例子", "展示推导过程", "质疑这段内容"];
const DEFAULT_REVIEW = "已完成结构、术语与公式一致性检查。";

function hasChapterBody(chapter: Chapter) {
  return Boolean(chapter.content || chapter.sections?.length);
}

function getChapterBody(chapter: Chapter) {
  return chapter.content ?? chapter.sections?.map((section) => section.content).join("\n\n") ?? "";
}

function isWaitingForBackgroundGeneration(chapter: Chapter) {
  return Boolean(chapter.generationJobId);
}

function chapterStatusLabel(chapter: Chapter) {
  if (chapter.status === "ready") return "READY";
  if (chapter.status === "failed") return "FAILED";
  if (chapter.status === "generating") return "GENERATING";
  if (chapter.status === "queued") return "QUEUED";
  return "PENDING";
}

export default function ReaderPage() {
  const { id, chapterId } = useParams<{ id: string; chapterId: string }>();
  const router = useRouter();
  const [course, setCourse] = useState<Course>();
  const [content, setContent] = useState("");
  const [sections, setSections] = useState<Section[]>([]);
  const [review, setReview] = useState("");
  const [selectedText, setSelectedText] = useState("");
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [active, setActive] = useState<Annotation>();
  const [loading, setLoading] = useState(true);
  const [answering, setAnswering] = useState(false);
  const [generationError, setGenerationError] = useState("");

  const [tocOpen, setTocOpen] = useState(true);
  const [tutorOpen, setTutorOpen] = useState(true);

  const chapter = course?.chapters.find((item) => item.id === chapterId);
  const currentIndex = course?.chapters.findIndex((c) => c.id === chapterId) ?? -1;
  const prevChapter = currentIndex > 0 && course ? course.chapters[currentIndex - 1] : null;
  const nextChapter = currentIndex < (course?.chapters.length ?? 0) - 1 && course ? course.chapters[currentIndex + 1] : null;
  const canPrint = Boolean(chapter && !loading && !generationError && hasChapterBody(chapter));

  const applyCourseUpdate = useCallback((nextCourse: Course) => {
    saveCourse(nextCourse);
    setCourse(nextCourse);
    setGenerationError("");

    const current = nextCourse.chapters.find((item) => item.id === chapterId);
    if (!current) {
      setLoading(false);
      return;
    }

    if (hasChapterBody(current)) {
      setContent(getChapterBody(current));
      setSections(current.sections ?? []);
      setReview(current.review ?? DEFAULT_REVIEW);
      setLoading(false);
      return;
    }

    setContent("");
    setSections([]);
    setReview(current.review ?? "");

    if (current.status === "failed") {
      setGenerationError("Chapter generation failed.");
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
      body: JSON.stringify({ courseId: stored.id, course: stored }),
    })
      .then(async (response) => {
        const data = (await response.json()) as ChapterGenerateResponse & { error?: string };
        if (!response.ok) throw new Error(data.error ?? "Chapter generation failed");
        return data;
      })
      .then((data: ChapterGenerateResponse) => {
        if (!data.content) throw new Error("Chapter generation failed");
        current.content = data.content;
        current.sections = data.sections;
        current.review = data.review;
        current.qualityReport = data.qualityReport;
        current.generationJobId = data.job?.id;
        current.status = data.qualityReport?.status === "failed" ? "failed" : "ready";
        applyCourseUpdate({ ...stored });
      })
      .catch((error) => {
        current.status = "failed";
        applyCourseUpdate({ ...stored });
        setGenerationError(publicSafeErrorMessage(error, "Chapter generation failed. Please refresh and try again."));
      })
      .finally(() => setLoading(false));
  }, [applyCourseUpdate, chapterId]);

  useEffect(() => {
    const stored = getCourse(id);
    if (stored) applyCourseUpdate(stored);
    setAnnotations(getAnnotations(chapterId));

    apiFetch(`/api/annotations?chapterId=${chapterId}`)
      .then((response) => (response.ok ? response.json() : undefined))
      .then((data) => {
        if (data?.annotations) {
          data.annotations.forEach((annotation: Annotation) => saveAnnotation(annotation));
          setAnnotations(getAnnotations(chapterId));
        }
      })
      .catch(() => undefined);

    apiFetch(`/api/courses/${id}`)
      .then((response) => (response.ok ? response.json() : undefined))
      .then((data) => {
        const courseData = (data?.course as Course | undefined) ?? stored;
        if (!courseData) {
          setLoading(false);
          return;
        }
        void ensureChapterContent(courseData);
      })
      .catch(() => {
        if (stored) void ensureChapterContent(stored);
        else setLoading(false);
      });
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

  const handleTextSelect = useCallback((text: string) => {
    if (text.length > 2) {
      setSelectedText(text);
      setActive(undefined);
      setTutorOpen(true);
    }
  }, []);

  const handleParagraphDoubleClick = useCallback((text: string) => {
    if (text.length > 2) {
      setSelectedText(text);
      setActive(undefined);
      setTutorOpen(true);
    }
  }, []);

  function captureSelection(event: MouseEvent<HTMLElement>) {
    const selection = window.getSelection();
    const text = selection?.toString().trim() ?? "";
    if (text.length > 2 && event.currentTarget.contains(selection?.anchorNode ?? null)) {
      handleTextSelect(text);
    }
  }

  function captureParagraph(event: MouseEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    const block = target.closest("p, li, blockquote, h2, h3");
    const text = block?.textContent?.trim() ?? "";
    if (text.length > 2) {
      handleParagraphDoubleClick(text);
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
        selectedText,
        question,
        messages: [],
        createdAt: new Date().toISOString(),
      } satisfies Annotation);

    annotation.messages.push({ id: crypto.randomUUID(), role: "user", content: question });
    setActive({ ...annotation });

    let answer: string;
    let savedAnnotation: Annotation | undefined;
    try {
      const response = await apiFetch("/api/annotations", {
        method: "POST",
        body: JSON.stringify({
          topic: course.topic,
          selectedText: annotation.selectedText,
          question,
          history: annotation.messages,
          sectionId: annotation.sectionId,
          annotation,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Tutor request failed.");
      }
      answer = data.answer;
      savedAnnotation = data.annotation;
    } catch (error) {
      answer = publicSafeErrorMessage(error, "Tutor request failed.");
    }

    if (savedAnnotation) {
      saveAnnotation(savedAnnotation);
    } else {
      annotation.messages.push({ id: crypto.randomUUID(), role: "assistant", content: answer });
      saveAnnotation(annotation);
    }
    const next = getAnnotations(chapterId);
    setAnnotations(next);
    setActive({ ...(savedAnnotation ?? annotation) });
    setAnswering(false);
  }

  function submitQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.elements.namedItem("question") as HTMLInputElement;
    void ask(input.value);
    input.value = "";
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
              <span>{loading ? "GENERATING..." : `✓ ${review}`}</span>
            </div>
            <div className="mt-4 text-sm text-muted-foreground leading-relaxed border-t border-border/50 pt-4">
              <p>承接：{chapter.connectionFromPrevious ?? "这是课程起点。"}</p>
              <p className="mt-1">铺垫：{chapter.setupForNext ?? "自然引出下一章。"}</p>
            </div>
          </div>

          {loading ? (
            <div className="rounded-lg border border-dashed border-border py-24 text-center">
              <Clock size={32} className="mx-auto mb-4 animate-pulse text-muted-foreground/50" />
              <p className="font-mono text-sm text-muted-foreground">AI IS WRITING THE TEXTBOOK...</p>
              <p className="mt-2 text-xs text-muted-foreground/60">AI 正在根据 Course Bible 编写本章</p>
            </div>
          ) : generationError ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 py-12 text-center text-destructive">
              <p className="font-mono text-sm">{generationError}</p>
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
            <span className="font-mono text-[11px] font-medium text-primary uppercase tracking-wider">Tutor Terminal</span>
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
                    <span className="font-mono text-[10px] animate-pulse">PROCESSING...</span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center text-center text-muted-foreground">
              <MessageSquareQuote size={32} className="mb-4 opacity-50" />
              <p className="font-mono text-xs leading-relaxed max-w-[200px]">
                SELECT TEXT OR DOUBLE-CLICK PARAGRAPH TO INITIATE INQUIRY
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
            </div>
            <form onSubmit={submitQuestion} className="relative flex items-center">
              <span className="absolute left-3 font-mono text-[12px] text-primary">{">"}</span>
              <input
                name="question"
                placeholder="INPUT QUERY..."
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
