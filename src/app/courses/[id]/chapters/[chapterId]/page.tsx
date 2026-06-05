"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, MouseEvent, useEffect, useState } from "react";
import { MarkdownContent } from "@/components/MarkdownContent";
import { createMockAnswer } from "@/lib/mock";
import { getAnnotations, getCourse, saveAnnotation, saveCourse } from "@/lib/storage";
import { formatMinutes, totalMinutes } from "@/lib/time";
import { Annotation, Course } from "@/lib/types";

const quickQuestions = ["解释得更简单", "给我一个具体例子", "展示推导过程", "质疑这段内容"];

export default function ReaderPage() {
  const { id, chapterId } = useParams<{ id: string; chapterId: string }>();
  const [course, setCourse] = useState<Course>();
  const [content, setContent] = useState("");
  const [review, setReview] = useState("");
  const [selectedText, setSelectedText] = useState("");
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [active, setActive] = useState<Annotation>();
  const [loading, setLoading] = useState(true);
  const [answering, setAnswering] = useState(false);
  const [generationError, setGenerationError] = useState("");

  const chapter = course?.chapters.find((item) => item.id === chapterId);

  useEffect(() => {
    const stored = getCourse(id);
    if (!stored) return;
    setCourse(stored);
    setAnnotations(getAnnotations(chapterId));
    const current = stored.chapters.find((item) => item.id === chapterId);
    const currentIndex = stored.chapters.findIndex((item) => item.id === chapterId);
    if (current?.content) {
      setContent(current.content);
      setReview(current.review ?? "已完成结构、术语与公式一致性检查。");
      setLoading(false);
      return;
    }

    if (!current) return;
    current.status = "generating";
    saveCourse(stored);

    fetch("/api/chapters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: stored.topic,
        title: current.title,
        description: current.description,
        purpose: current.purpose,
        connectionFromPrevious: current.connectionFromPrevious,
        setupForNext: current.setupForNext,
        time: current.time,
        goal: stored.goal,
        background: stored.background,
        preference: stored.preference,
        courseBible: stored.courseBible,
        chapters: stored.chapters.map((item) => ({
          id: item.id,
          title: item.title,
          description: item.description,
          purpose: item.purpose,
          connectionFromPrevious: item.connectionFromPrevious,
          setupForNext: item.setupForNext,
          time: item.time,
          status: item.status,
        })),
        chapterIndex: currentIndex,
      }),
    })
      .then((response) => response.json())
      .then((data) => {
        if (!data.content) throw new Error("Chapter generation failed");
        setContent(data.content);
        setReview(data.review);
        current.content = data.content;
        current.review = data.review;
        current.status = "ready";
        saveCourse(stored);
        setCourse({ ...stored });
      })
      .catch(() => {
        current.status = "failed";
        saveCourse(stored);
        setGenerationError("AI 模型暂时无法生成本章，请刷新页面重试。");
      })
      .finally(() => setLoading(false));
  }, [chapterId, id]);

  function captureSelection(event: MouseEvent<HTMLElement>) {
    const selection = window.getSelection();
    const text = selection?.toString().trim() ?? "";
    if (text.length > 2 && event.currentTarget.contains(selection?.anchorNode ?? null)) {
      setSelectedText(text);
      setActive(undefined);
    }
  }

  function captureParagraph(event: MouseEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    const block = target.closest("p, li, blockquote, h2, h3");
    const text = block?.textContent?.trim() ?? "";
    if (text.length > 2) {
      setSelectedText(text);
      setActive(undefined);
    }
  }

  async function ask(question: string) {
    if (!course || (!selectedText && !active) || !question.trim()) return;
    setAnswering(true);
    const annotation: Annotation =
      active ??
      ({
        id: crypto.randomUUID(),
        chapterId,
        selectedText,
        question,
        messages: [],
        createdAt: new Date().toISOString(),
      } satisfies Annotation);

    annotation.messages.push({ id: crypto.randomUUID(), role: "user", content: question });
    setActive({ ...annotation });

    let answer: string;
    try {
      const response = await fetch("/api/annotations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: course.topic,
          selectedText: annotation.selectedText,
          question,
          history: annotation.messages,
        }),
      });
      const data = await response.json();
      answer = data.answer;
    } catch {
      answer = createMockAnswer(annotation.selectedText, question);
    }

    annotation.messages.push({ id: crypto.randomUUID(), role: "assistant", content: answer });
    saveAnnotation(annotation);
    const next = getAnnotations(chapterId);
    setAnnotations(next);
    setActive({ ...annotation });
    setAnswering(false);
  }

  function submitQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.elements.namedItem("question") as HTMLInputElement;
    void ask(input.value);
    input.value = "";
  }

  if (!course || !chapter) return <main className="shell page">正在打开教材…</main>;

  return (
    <main className="reader-layout">
      <aside className="reader-sidebar">
        <Link href="/" className="brand">
          Learn<span>By</span>AI
        </Link>
        <div className="sidebar-title">课程目录</div>
        {course.chapters.map((item, index) => (
          <Link
            className={`sidebar-chapter ${item.id === chapterId ? "active" : ""}`}
            href={`/courses/${id}/chapters/${item.id}`}
            key={item.id}
          >
            {index + 1}. {item.title}
            <br />
            <span>{item.status === "ready" ? "可阅读" : "待生成"}</span>
          </Link>
        ))}
        <div className="sidebar-title">本章讨论 · {annotations.length}</div>
        {annotations.map((annotation) => (
          <button
            className={`sidebar-chapter ${active?.id === annotation.id ? "active" : ""}`}
            key={annotation.id}
            onClick={() => {
              setActive(annotation);
              setSelectedText("");
            }}
          >
            “{annotation.selectedText.slice(0, 28)}…”
          </button>
        ))}
      </aside>

      <section className="reader-main">
        <div className="reader-toolbar">
          <Link href={`/courses/${id}`}>← 返回课程目录</Link>
          <span>{loading ? "正在编写并审核教材…" : `✓ ${review}`}</span>
        </div>
        <article
          className="article"
          onDoubleClick={captureParagraph}
          onMouseUp={captureSelection}
          title="选中文字或双击段落，在右侧展开讨论"
        >
          <div className="profile">
            <strong>本章学习时间：{formatMinutes(totalMinutes(chapter.time))}</strong>
            <p>
              阅读 {chapter.time.readingMinutes} 分钟 · 练习 {chapter.time.exerciseMinutes} 分钟 ·
              实践 {chapter.time.practiceMinutes} 分钟 · 拓展阅读{" "}
              {chapter.time.extensionMinutes} 分钟
            </p>
            <p>承接：{chapter.connectionFromPrevious ?? "这是课程起点。"}</p>
            <p>铺垫：{chapter.setupForNext ?? "自然引出下一章。"}</p>
          </div>
          {loading ? (
            <p className="muted">AI 模型正在根据 Course Bible 编写本章，并进行格式检查…</p>
          ) : generationError ? (
            <p style={{ color: "#a33" }}>{generationError}</p>
          ) : (
            <MarkdownContent content={content} />
          )}
        </article>
      </section>

      <aside className="discussion">
        <div className="discussion-header">
          <h3>原文讨论</h3>
          <span className="muted">支持 Markdown、公式和代码</span>
        </div>
        {selectedText || active ? (
          <>
            <div className="selection-box">“{active?.selectedText ?? selectedText}”</div>
            <div className="messages">
              {active?.messages.map((message) => (
                <div className={`message ${message.role}`} key={message.id}>
                  <MarkdownContent content={message.content} />
                </div>
              ))}
              {answering && <div className="message">正在思考这段原文与你的问题…</div>}
            </div>
            <form className="question-box" onSubmit={submitQuestion}>
              <div className="quick-actions">
                {quickQuestions.map((question) => (
                  <button type="button" key={question} onClick={() => void ask(question)}>
                    {question}
                  </button>
                ))}
              </div>
              <div className="question-input">
                <input name="question" placeholder="针对这段内容继续提问…" autoComplete="off" />
                <button className="button" disabled={answering} type="submit">
                  询问
                </button>
              </div>
            </form>
          </>
        ) : (
          <div className="empty-discussion">
            在教材中选中任意一段文字，
            <br />
            或双击段落，在这里展开独立讨论。
          </div>
        )}
      </aside>
    </main>
  );
}
