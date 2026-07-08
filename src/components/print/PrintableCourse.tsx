"use client";

import { isValidElement, useEffect, useState } from "react";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github.css";
import { normalizeMermaidCode } from "@/lib/mermaid";

/**
 * Print-only renderer for PDF export. Deliberately light-themed (white page,
 * dark text) — the on-screen reader is dark, but a printed document should be
 * clean and ink-friendly. Rendered inside an internal /internal/print route
 * that a headless Chromium navigates to; it sets window.__printReady once every
 * Mermaid diagram has finished so the generator knows when to call page.pdf().
 */

type PrintChapter = { id?: string; title: string; content?: string };
type PrintCourse = {
  topic: string;
  goal?: string;
  profile?: string;
  chapters: PrintChapter[];
};

declare global {
  interface Window {
    __printReady?: boolean;
  }
}

// Module-scoped diagram tracker (one print document per page load).
const mermaidTracker = { pending: 0 };

const UNGENERATED = "（本章尚未生成内容。）";

function getCodeText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(getCodeText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return getCodeText(node.props.children);
  return "";
}

let mermaidLoader: Promise<typeof import("mermaid").default> | null = null;
function loadMermaid() {
  if (!mermaidLoader) {
    mermaidLoader = import("mermaid").then(async (mod) => {
      mod.default.initialize({
        startOnLoad: false,
        theme: "neutral",
        securityLevel: "loose",
        fontFamily: "inherit",
        // SVG text (not clipped) + fonts loaded before measuring — see reader.
        flowchart: { htmlLabels: false },
        suppressErrorRendering: true,
      });
      if (typeof document !== "undefined" && document.fonts?.ready) {
        try {
          await document.fonts.ready;
        } catch {
          // non-fatal
        }
      }
      return mod.default;
    });
  }
  return mermaidLoader;
}

function PrintMermaid({ code }: { code: string }) {
  const [svg, setSvg] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    mermaidTracker.pending += 1;
    loadMermaid()
      .then((mermaid) => mermaid.render(`pmmd-${Math.random().toString(36).slice(2)}`, normalizeMermaidCode(code.trim())))
      .then(({ svg: out }) => {
        if (!cancelled) setSvg(out);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        mermaidTracker.pending = Math.max(0, mermaidTracker.pending - 1);
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (failed) {
    return <pre className="pdf-pre">{code}</pre>;
  }
  return (
    <div className="pdf-diagram" dangerouslySetInnerHTML={{ __html: svg }} />
  );
}

function Markdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[[remarkGfm, { singleTilde: false }], remarkMath]}
      rehypePlugins={[
        [rehypeKatex, { throwOnError: false, strict: false, errorColor: "currentColor" }],
        rehypeHighlight,
      ]}
      components={{
        pre: ({ children }) => {
          const code = getCodeText(children);
          const child = Array.isArray(children) ? children[0] : children;
          const childClass = isValidElement<{ className?: string }>(child) ? child.props.className ?? "" : "";
          if (/\blanguage-mermaid\b/.test(childClass)) {
            return <PrintMermaid code={code} />;
          }
          return <pre className="pdf-pre">{children}</pre>;
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

export default function PrintableCourse({
  course,
  chapterId,
}: {
  course: PrintCourse;
  chapterId?: string;
}) {
  const chapters = chapterId
    ? course.chapters.filter((chapter) => chapter.id === chapterId)
    : course.chapters;
  const wholeCourse = !chapterId;

  useEffect(() => {
    let cancelled = false;
    const settle = async () => {
      if (document.fonts?.ready) {
        try {
          await document.fonts.ready;
        } catch {
          // non-fatal
        }
      }
      // Wait for all diagrams, then a couple of frames for layout to settle.
      const start = Date.now();
      while (mermaidTracker.pending > 0 && Date.now() - start < 20000) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (!cancelled) window.__printReady = true;
    };
    settle();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="pdf-root">
      {wholeCourse && (
        <section className="pdf-cover">
          <div className="pdf-cover-kicker">LearnByAI · 个性化学习教材</div>
          <h1 className="pdf-cover-title">{course.topic}</h1>
          {course.goal && <p className="pdf-cover-goal">{course.goal}</p>}
          <div className="pdf-cover-meta">
            <span>{course.chapters.length} 章</span>
            <span>{new Date().toLocaleDateString("zh-CN")}</span>
          </div>
        </section>
      )}

      {wholeCourse && course.chapters.length > 1 && (
        <nav className="pdf-toc">
          <h2 className="pdf-toc-title">目录</h2>
          <ol>
            {course.chapters.map((chapter, index) => (
              <li key={chapter.id ?? index}>
                <span className="pdf-toc-num">{String(index + 1).padStart(2, "0")}</span>
                {chapter.title}
              </li>
            ))}
          </ol>
        </nav>
      )}

      {chapters.map((chapter, index) => (
        <article className="pdf-chapter" key={chapter.id ?? index}>
          <h1 className="pdf-chapter-title">
            {wholeCourse && <span className="pdf-chapter-num">{String(course.chapters.indexOf(chapter) + 1).padStart(2, "0")}</span>}
            {chapter.title}
          </h1>
          <div className="pdf-prose">
            <Markdown content={chapter.content?.trim() || UNGENERATED} />
          </div>
        </article>
      ))}
    </div>
  );
}
