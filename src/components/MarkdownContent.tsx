"use client";

import { Check, Copy } from "lucide-react";
import { isValidElement, useEffect, useRef, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github-dark.css";
import { postRepairMarkdown } from "@/lib/prompts/formatGuard";
import { normalizeMermaidCode } from "@/lib/mermaid";

interface MarkdownContentProps {
  content: string;
  onTextSelect?: (selectedText: string) => void;
  onParagraphDoubleClick?: (text: string) => void;
}

function getCodeText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") {
    return "";
  }
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(getCodeText).join("");
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return getCodeText(node.props.children);
  }
  return "";
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall back for browsers that expose clipboard but deny the write.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const didCopy = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!didCopy) {
    throw new Error("Copy command failed");
  }
}

function CodeCopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<number | null>(null);
  const hasCode = code.trim().length > 0;

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const handleCopy = async () => {
    if (!hasCode) return;

    try {
      await copyText(code);
      setCopied(true);
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  const Icon = copied ? Check : Copy;

  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={!hasCode}
      aria-label={copied ? "Copied code" : "Copy code"}
      title={copied ? "Copied" : "Copy code"}
      className="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/10 bg-white/5 text-slate-300 shadow-sm transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}

let mermaidLoader: Promise<typeof import("mermaid").default> | null = null;
function loadMermaid() {
  if (!mermaidLoader) {
    mermaidLoader = import("mermaid").then(async (mod) => {
      mod.default.initialize({
        startOnLoad: false,
        theme: "dark",
        securityLevel: "loose",
        fontFamily: "inherit",
        flowchart: { htmlLabels: true },
        // Don't let Mermaid inject its own error "bomb" graphic into the DOM on a
        // parse failure — we render our own source fallback below instead.
        suppressErrorRendering: true,
      });
      // Mermaid sizes each node to the measured label width. If it measures
      // before the async web fonts (Inter/Outfit/JetBrains) finish loading, it
      // uses the narrower fallback metrics; the real font then swaps in wider
      // and the trailing characters overflow and clip. Wait for fonts so the
      // measured box matches what actually renders.
      if (typeof document !== "undefined" && document.fonts?.ready) {
        try {
          await document.fonts.ready;
        } catch {
          // Non-fatal — fall back to rendering immediately.
        }
      }
      return mod.default;
    });
  }
  return mermaidLoader;
}

function MermaidDiagram({ code }: { code: string }) {
  const [svg, setSvg] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSvg("");
    setFailed(false);
    loadMermaid()
      .then((mermaid) => mermaid.render(`mmd-${Math.random().toString(36).slice(2)}`, normalizeMermaidCode(code.trim())))
      .then(({ svg }) => {
        if (!cancelled) setSvg(svg);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  // Render failure (invalid diagram syntax) falls back to showing the source.
  if (failed) {
    return (
      <pre className="my-4 overflow-x-auto rounded-lg bg-[#0d1117] p-4 text-xs text-[#c9d1d9]">
        {code}
      </pre>
    );
  }
  if (!svg) {
    return (
      <div className="my-4 rounded-lg border border-border bg-muted/30 p-4 text-xs text-muted-foreground">
        正在渲染图示…
      </div>
    );
  }
  return (
    <div
      className="my-4 flex justify-center overflow-x-auto rounded-lg border border-border bg-muted/20 p-4 [&_svg]:h-auto [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export function MarkdownContent({
  content,
  onTextSelect,
  onParagraphDoubleClick,
}: MarkdownContentProps) {
  const handleMouseUp = () => {
    const selection = window.getSelection();
    if (selection && selection.toString().trim().length > 0) {
      onTextSelect?.(selection.toString().trim());
    }
  };

  const handleDoubleClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const paragraph = target.closest("p, li, td");
    if (paragraph) {
      onParagraphDoubleClick?.(paragraph.textContent || "");
    }
  };

  return (
    <div
      className="prose prose-invert max-w-none font-mono text-sm leading-relaxed"
      onMouseUp={handleMouseUp}
      onDoubleClick={handleDoubleClick}
    >
      <ReactMarkdown
        remarkPlugins={[[remarkGfm, { singleTilde: false }], remarkMath]}
        rehypePlugins={[
          [
            rehypeKatex,
            {
              throwOnError: false,
              strict: false,
              errorColor: "currentColor",
            },
          ],
          rehypeHighlight,
        ]}
        components={{
          h1: ({ children }) => (
            <h1 className="mb-4 mt-8 text-xl font-bold text-foreground first:mt-0">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mb-3 mt-6 text-lg font-semibold text-foreground">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mb-2 mt-4 text-base font-semibold text-foreground">
              {children}
            </h3>
          ),
          p: ({ children }) => (
            <p className="mb-4 text-muted-foreground leading-7">{children}</p>
          ),
          blockquote: ({ children }) => (
            <blockquote className="mb-4 border-l-2 border-primary bg-muted/50 pl-4 py-2 text-sm italic text-muted-foreground">
              {children}
            </blockquote>
          ),
          pre: ({ children }) => {
            const code = getCodeText(children);
            const child = Array.isArray(children) ? children[0] : children;
            const childClass = isValidElement<{ className?: string }>(child)
              ? child.props.className ?? ""
              : "";
            if (/\blanguage-mermaid\b/.test(childClass)) {
              return <MermaidDiagram code={code} />;
            }
            return (
              <div className="group relative my-4">
                <pre className="my-0 overflow-x-auto rounded-lg bg-[#0d1117] p-4 pr-14 [&_*]:!bg-transparent [&_code]:!p-0 [&_code]:text-xs [&_code]:text-[#c9d1d9]">
                  {children}
                </pre>
                <CodeCopyButton code={code} />
              </div>
            );
          },
          code: ({ children, className, ...props }) => {
            const text = String(children ?? "");
            const isBlock = Boolean(className) || text.includes("\n");
            if (isBlock) {
              return (
                <code className={`${className ?? ""} !bg-transparent`} {...props}>
                  {children}
                </code>
              );
            }
            return (
              <code
                className="rounded bg-muted px-1.5 py-0.5 text-xs text-foreground"
                {...props}
              >
                {children}
              </code>
            );
          },
          table: ({ children }) => (
            <div className="my-4 overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-muted">{children}</thead>
          ),
          th: ({ children }) => (
            <th className="border border-border px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-border px-3 py-2 text-muted-foreground">
              {children}
            </td>
          ),
          ul: ({ children }) => (
            <ul className="mb-4 ml-4 list-disc space-y-1 text-muted-foreground">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="mb-4 ml-4 list-decimal space-y-1 text-muted-foreground">
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li className="text-muted-foreground">{children}</li>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-foreground">{children}</strong>
          ),
          a: ({ children, href }) => (
            <a
              href={href}
              className="text-primary underline underline-offset-2 hover:text-primary/80"
              target="_blank"
              rel="noopener noreferrer"
            >
              {children}
            </a>
          ),
          hr: () => <hr className="my-6 border-border" />,
        }}
      >
        {postRepairMarkdown(content)}
      </ReactMarkdown>
    </div>
  );
}
