import "server-only";

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { getSupabaseExportsBucket, hasSupabaseServerConfig } from "./config";
import { resolveLocalExportPath } from "./exportPaths";
import { createSupabaseServiceClient } from "./supabase/server";
import { Course, ExportAsset, ExportJob } from "./types";

const exportJobs = new Map<string, ExportJob>();
const UNGENERATED_CHAPTER_TEXT = "本章节尚未生成。";
const TEX_CONTENT_TYPE = "text/plain; charset=utf-8";
const PDF_LINES_PER_PAGE = 52;
const PDF_WRAP_WIDTH = 42;

type ExportStorageTarget = {
  fileName?: string;
  storagePath?: string;
  storageProvider?: "local" | "supabase";
  content?: string;
  contentType?: string;
  encoding?: "utf8" | "base64";
  format?: ExportJob["format"];
};

export async function createCourseExport(course: Course, format: ExportJob["format"], userId?: string) {
  const now = new Date().toISOString();
  const exportId = crypto.randomUUID();
  const baseName = sanitize(course.topic) || "learnbyai-course";
  const tex = toTex(course);
  const content = format === "tex" ? tex : await createPdfBytes(course);
  const job: ExportJob = {
    id: exportId,
    userId,
    courseId: course.id,
    format,
    status: "succeeded",
    fileName: `${baseName}.${format}`,
    storagePath: `${pathSegment(userId ?? "local-beta-user")}/${pathSegment(course.id)}/${exportId}.${format}`,
    contentType: format === "tex" ? TEX_CONTENT_TYPE : "application/pdf",
    encoding: format === "tex" ? "utf8" : "base64",
    createdAt: now,
    updatedAt: now,
  };

  if (format === "pdf") {
    const texAsset: ExportAsset = {
      format: "tex",
      fileName: `${baseName}.tex`,
      storagePath: `${pathSegment(userId ?? "local-beta-user")}/${pathSegment(course.id)}/${exportId}.tex`,
      contentType: TEX_CONTENT_TYPE,
      encoding: "utf8",
    };
    await writeExportAsset(texAsset, tex, userId);
    job.assets = [texAsset];
  }

  await writeExportContent(job, content);
  exportJobs.set(job.id, job);
  return job;
}

export function getExportJob(id: string) {
  return exportJobs.get(id);
}

export function findExportAsset(job: ExportJob, format: ExportJob["format"]) {
  if (job.format === format) return undefined;
  return job.assets?.find((asset) => asset.format === format);
}

export async function readExportContent(job: ExportJob, asset?: ExportAsset) {
  return readStoredExportFile(asset ?? job);
}

async function readStoredExportFile(target: ExportStorageTarget) {
  if (target.content) {
    return target.encoding === "base64"
      ? Buffer.from(target.content, "base64")
      : Buffer.from(target.content, "utf8");
  }

  if (target.storageProvider === "supabase" && target.storagePath) {
    const remote = await readSupabaseExportContent(target);
    if (remote) return remote;
  }

  return readFile(localExportPath(target));
}

async function writeExportContent(job: ExportJob, content: string | Buffer) {
  job.storageProvider = await writeStoredExportFile(job, content, job.userId);
}

async function writeExportAsset(asset: ExportAsset, content: string | Buffer, userId?: string) {
  asset.storageProvider = await writeStoredExportFile(asset, content, userId);
}

async function writeStoredExportFile(target: ExportStorageTarget, content: string | Buffer, userId?: string) {
  const bytes = typeof content === "string" ? Buffer.from(content, "utf8") : content;
  const remoteStored = await writeSupabaseExportContent(target, bytes, userId);
  if (remoteStored) return "supabase";

  if (hasSupabaseServerConfig() && isUuid(userId)) {
    throw new Error("Supabase export upload failed.");
  }

  const path = localExportPath(target);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
  return "local";
}

async function writeSupabaseExportContent(target: ExportStorageTarget, bytes: Buffer, userId?: string) {
  if (!target.storagePath) return false;
  if (!isUuid(userId)) return false;
  const supabase = createSupabaseServiceClient();
  if (!supabase) return false;

  const { error } = await supabase.storage
    .from(getSupabaseExportsBucket())
    .upload(target.storagePath, bytes, {
      contentType: target.contentType ?? "application/octet-stream",
      upsert: true,
    });

  if (error) {
    throw new Error(`Supabase export upload failed: ${error.message}`);
  }

  return !error;
}

async function readSupabaseExportContent(target: ExportStorageTarget) {
  if (!target.storagePath) return undefined;
  const supabase = createSupabaseServiceClient();
  if (!supabase) return undefined;

  const { data, error } = await supabase.storage
    .from(getSupabaseExportsBucket())
    .download(target.storagePath);
  if (error) {
    throw new Error(`Supabase export download failed: ${error.message}`);
  }
  if (!data) {
    throw new Error("Supabase export download failed: no data returned.");
  }

  return Buffer.from(await data.arrayBuffer());
}

function localExportPath(target: ExportStorageTarget) {
  return resolveLocalExportPath(target.storagePath, target.fileName ?? `export.${target.format ?? "pdf"}`);
}

function toTex(course: Course) {
  const chapters = course.chapters
    .map((chapter, index) => {
      const title = chapter.title || `第 ${index + 1} 章`;
      const body = chapter.content?.trim() || chapter.sections?.map((section) => section.content).join("\n\n").trim();
      return `\\section{${escapeTexText(stripMarkdownInline(title))}}\n${markdownToTex(body || UNGENERATED_CHAPTER_TEXT, title)}`;
    })
    .join("\n\n");
  return `\\documentclass[UTF8]{ctexart}
\\usepackage[a4paper,margin=2.2cm]{geometry}
\\usepackage{amsmath,amssymb}
\\usepackage{hyperref}
\\usepackage{listings}
\\lstset{basicstyle=\\ttfamily\\small,breaklines=true,columns=fullflexible}
\\title{${escapeTexText(stripMarkdownInline(course.topic))}}
\\author{LearnByAI}
\\date{\\today}

\\begin{document}
\\maketitle

\\begin{abstract}
${escapeTexTextPreservingMath(course.goal || course.profile || "")}
\\end{abstract}

${chapters || escapeTexText(UNGENERATED_CHAPTER_TEXT)}

\\end{document}
`;
}

async function createPdfBytes(course: Course) {
  if (process.env.LEARNBYAI_PDF_RENDERER !== "plain") {
    try {
      return await createBrowserPdfBytes(toHtml(course));
    } catch (error) {
      console.warn("[exports] Browser PDF render failed; falling back to plain PDF.", error);
    }
  }
  return createPlainPdfBytes(toPdfText(course));
}

async function createBrowserPdfBytes(html: string) {
  if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync("/opt/ms-playwright")) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = "/opt/ms-playwright";
  }
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: {
        top: "18mm",
        right: "17mm",
        bottom: "18mm",
        left: "17mm",
      },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

function toHtml(course: Course) {
  const chapters = course.chapters
    .map((chapter, index) => {
      const body = chapter.content?.trim() || chapter.sections?.map((section) => section.content).join("\n\n").trim();
      return `<section class="chapter">
<h1>${escapeHtml(chapter.title || `第 ${index + 1} 章`)}</h1>
${markdownToHtml(body || UNGENERATED_CHAPTER_TEXT, chapter.title)}
</section>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(course.topic)}</title>
  <style>
    @page { size: A4; margin: 18mm 17mm; }
    * { box-sizing: border-box; }
    body {
      color: #111827;
      font-family: "Noto Sans CJK SC", "Source Han Sans SC", "Microsoft YaHei", "PingFang SC", "WenQuanYi Micro Hei", "DejaVu Sans", sans-serif;
      font-size: 12px;
      line-height: 1.68;
      margin: 0;
    }
    .cover { break-after: page; padding-top: 28mm; }
    .brand { color: #6b7280; font-size: 11px; letter-spacing: .04em; text-transform: uppercase; }
    .title { color: #0f172a; font-size: 28px; line-height: 1.25; margin: 12px 0 18px; }
    .goal { color: #374151; font-size: 14px; max-width: 150mm; }
    .chapter { break-before: page; }
    .chapter:first-of-type { break-before: auto; }
    h1, h2, h3, h4 { color: #0f172a; line-height: 1.35; margin: 18px 0 8px; page-break-after: avoid; }
    h1 { font-size: 22px; border-bottom: 1px solid #d1d5db; padding-bottom: 8px; }
    h2 { font-size: 17px; }
    h3 { font-size: 14px; }
    p { margin: 7px 0; }
    ul, ol { margin: 7px 0 7px 20px; padding: 0; }
    li { margin: 3px 0; }
    pre {
      background: #f3f4f6;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      color: #111827;
      font-family: "DejaVu Sans Mono", "SFMono-Regular", Consolas, monospace;
      font-size: 10px;
      line-height: 1.5;
      overflow-wrap: anywhere;
      padding: 9px;
      white-space: pre-wrap;
    }
    code { font-family: "DejaVu Sans Mono", "SFMono-Regular", Consolas, monospace; }
    blockquote { border-left: 3px solid #d1d5db; color: #4b5563; margin: 9px 0; padding-left: 10px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #d1d5db; padding: 4px 6px; }
  </style>
</head>
<body>
  <section class="cover">
    <div class="brand">LearnByAI Export</div>
    <h1 class="title">${escapeHtml(course.topic)}</h1>
    <p class="goal">${escapeHtml(course.goal || course.profile || "")}</p>
  </section>
  ${chapters || `<p>${escapeHtml(UNGENERATED_CHAPTER_TEXT)}</p>`}
</body>
</html>`;
}

function toPdfText(course: Course) {
  return [
    `LearnByAI Export: ${course.topic}`,
    course.goal,
    ...course.chapters.map((chapter) => {
      const body = chapter.content?.trim() || chapter.sections?.map((section) => section.content).join("\n\n").trim();
      return `\n# ${chapter.title}\n${body || UNGENERATED_CHAPTER_TEXT}`;
    }),
  ].join("\n\n");
}

function createPlainPdfBytes(text: string) {
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .flatMap((line) => wrapLine(line, PDF_WRAP_WIDTH));
  const pages = chunk(lines.length ? lines : [""], PDF_LINES_PER_PAGE);
  const pageCount = pages.length;
  const fontObjectId = 3 + pageCount * 2;
  const cidFontObjectId = fontObjectId + 1;
  const descriptorObjectId = fontObjectId + 2;
  const pageObjectIds = pages.map((_, index) => 3 + index * 2);
  const contentObjectIds = pages.map((_, index) => 4 + index * 2);

  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageCount} >>`,
  ];

  pages.forEach((pageLines, index) => {
    const stream = [
      "BT",
      "/F1 10 Tf",
      "50 790 Td",
      "14 TL",
      ...pageLines.map((line, lineIndex) => `${lineIndex === 0 ? "" : "T* "}${pdfHexString(line)} Tj`),
      "ET",
    ].join("\n");
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontObjectId} 0 R >> >> /Contents ${contentObjectIds[index]} 0 R >>`,
      `<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream`,
    );
  });

  objects.push(
    `<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [${cidFontObjectId} 0 R] >>`,
    `<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 2 >> /FontDescriptor ${descriptorObjectId} 0 R >>`,
    "<< /Type /FontDescriptor /FontName /STSong-Light /Flags 6 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 880 /StemV 80 >>",
  );

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "utf8");
}

function markdownToHtml(markdown: string, chapterTitle?: string) {
  const lines = markdown.replace(/\r/g, "").split("\n");
  const html: string[] = [];
  let inCode = false;
  let codeLines: string[] = [];
  let list: "ul" | "ol" | "" = "";
  let skippedFirstHeading = false;

  const closeList = () => {
    if (list) {
      html.push(`</${list}>`);
      list = "";
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const fence = trimmed.match(/^```/u);
    if (fence) {
      closeList();
      if (inCode) {
        html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        codeLines = [];
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (!trimmed) {
      closeList();
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/u);
    if (heading) {
      const text = stripMarkdownInline(heading[2] ?? "");
      if (!skippedFirstHeading && chapterTitle && sameHeading(text, chapterTitle)) {
        skippedFirstHeading = true;
        continue;
      }
      closeList();
      const depth = Math.min((heading[1]?.length ?? 1) + 1, 4);
      html.push(`<h${depth}>${escapeHtml(text)}</h${depth}>`);
      continue;
    }

    const unordered = trimmed.match(/^[-*+]\s+(.+)$/u);
    if (unordered) {
      if (list !== "ul") {
        closeList();
        list = "ul";
        html.push("<ul>");
      }
      html.push(`<li>${inlineMarkdownToHtml(unordered[1] ?? "")}</li>`);
      continue;
    }

    const ordered = trimmed.match(/^\d+[.)]\s+(.+)$/u);
    if (ordered) {
      if (list !== "ol") {
        closeList();
        list = "ol";
        html.push("<ol>");
      }
      html.push(`<li>${inlineMarkdownToHtml(ordered[1] ?? "")}</li>`);
      continue;
    }

    closeList();
    if (trimmed.startsWith(">")) {
      html.push(`<blockquote>${inlineMarkdownToHtml(trimmed.replace(/^>\s?/u, ""))}</blockquote>`);
    } else {
      html.push(`<p>${inlineMarkdownToHtml(line)}</p>`);
    }
  }

  closeList();
  if (inCode) {
    html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  }
  return html.join("\n");
}

function markdownToTex(markdown: string, chapterTitle?: string) {
  const lines = markdown.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  let inCode = false;
  let inDisplayMath = false;
  let list: "itemize" | "enumerate" | "" = "";
  let skippedFirstHeading = false;

  const closeList = () => {
    if (list) {
      out.push(`\\end{${list}}`);
      list = "";
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^```/u.test(trimmed)) {
      closeList();
      out.push(inCode ? "\\end{verbatim}" : "\\begin{verbatim}");
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      out.push(line);
      continue;
    }
    if (trimmed === "$$") {
      closeList();
      out.push(inDisplayMath ? "\\]" : "\\[");
      inDisplayMath = !inDisplayMath;
      continue;
    }
    if (inDisplayMath) {
      out.push(line);
      continue;
    }
    if (!trimmed) {
      closeList();
      out.push("");
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/u);
    if (heading) {
      const text = stripMarkdownInline(heading[2] ?? "");
      if (!skippedFirstHeading && chapterTitle && sameHeading(text, chapterTitle)) {
        skippedFirstHeading = true;
        continue;
      }
      closeList();
      out.push(`${headingCommand(heading[1]?.length ?? 1)}{${escapeTexText(text)}}`);
      continue;
    }

    const unordered = trimmed.match(/^[-*+]\s+(.+)$/u);
    if (unordered) {
      if (list !== "itemize") {
        closeList();
        list = "itemize";
        out.push("\\begin{itemize}");
      }
      out.push(`\\item ${escapeTexTextPreservingMath(unordered[1] ?? "")}`);
      continue;
    }

    const ordered = trimmed.match(/^\d+[.)]\s+(.+)$/u);
    if (ordered) {
      if (list !== "enumerate") {
        closeList();
        list = "enumerate";
        out.push("\\begin{enumerate}");
      }
      out.push(`\\item ${escapeTexTextPreservingMath(ordered[1] ?? "")}`);
      continue;
    }

    closeList();
    out.push(escapeTexTextPreservingMath(line));
  }

  closeList();
  if (inCode) out.push("\\end{verbatim}");
  if (inDisplayMath) out.push("\\]");
  return out.join("\n");
}

function inlineMarkdownToHtml(value: string) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/gu, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/gu, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/gu, "<em>$1</em>");
}

function headingCommand(depth: number) {
  if (depth <= 2) return "\\subsection";
  if (depth === 3) return "\\subsubsection";
  return "\\paragraph";
}

function stripMarkdownInline(value: string) {
  return value
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/\*\*([^*]+)\*\*/gu, "$1")
    .replace(/\*([^*]+)\*/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
    .trim();
}

function sameHeading(left: string, right: string) {
  return normalizeHeading(left).includes(normalizeHeading(right)) || normalizeHeading(right).includes(normalizeHeading(left));
}

function normalizeHeading(value: string) {
  return stripMarkdownInline(value).replace(/\s+/gu, "").replace(/^第[一二三四五六七八九十\d]+章[:：.\s-]*/u, "");
}

function wrapLine(line: string, width: number) {
  if (!line) return [""];
  const chunks: string[] = [];
  for (let index = 0; index < line.length; index += width) {
    chunks.push(line.slice(index, index + width));
  }
  return chunks;
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function pdfHexString(value: string) {
  const utf16Le = Buffer.from(value, "utf16le");
  const utf16Be = Buffer.alloc(utf16Le.length);
  for (let index = 0; index < utf16Le.length; index += 2) {
    utf16Be[index] = utf16Le[index + 1];
    utf16Be[index + 1] = utf16Le[index];
  }
  return `<${utf16Be.toString("hex").toUpperCase()}>`;
}

function sanitize(value: string) {
  return value.replace(/[^\w\u4e00-\u9fa5-]+/gu, "-").replace(/-+/gu, "-").replace(/^-|-$/gu, "");
}

function pathSegment(value: string) {
  return value.replace(/[^\w-]+/gu, "-").replace(/-+/gu, "-").replace(/^-|-$/gu, "").slice(0, 120) || "export";
}

function escapeHtml(value: string) {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

function escapeTexTextPreservingMath(value: string) {
  const parts = value.split(/(\$[^$\n]+\$)/gu);
  return parts.map((part) => (part.startsWith("$") && part.endsWith("$") ? part : escapeTexText(part))).join("");
}

function escapeTexText(value: string) {
  return value
    .replace(/\\/gu, "\\textbackslash{}")
    .replace(/([&%$#_{}])/gu, "\\$1")
    .replace(/\^/gu, "\\textasciicircum{}")
    .replace(/~/gu, "\\textasciitilde{}");
}

function isUuid(value?: string) {
  return Boolean(
    value?.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
  );
}
