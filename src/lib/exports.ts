import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getSupabaseExportsBucket, hasSupabaseServerConfig } from "./config";
import { resolveLocalExportPath } from "./exportPaths";
import { createFigureMarkdownRe } from "./figures";
import { ILLUSTRATION_URL_PREFIX, readIllustrationImage } from "./illustration";
import { createSupabaseServiceClient } from "./supabase/server";
import { rasterizeSvg, renderCoursePdf } from "./pdf";
import { compileLatexProject, TeXCompileError } from "./texCompiler";
import { Course, ExportJob } from "./types";

const exportJobs = new Map<string, ExportJob>();
const UNGENERATED_CHAPTER_TEXT = "This chapter has not been generated yet.";

export async function createCourseExport(
  course: Course,
  format: ExportJob["format"],
  userId?: string,
  options: { chapterId?: string } = {},
) {
  const now = new Date().toISOString();
  const exportId = crypto.randomUUID();
  const chapter = options.chapterId
    ? course.chapters.find((item) => item.id === options.chapterId)
    : undefined;
  const content =
    format === "tex"
      ? await toTex(course)
      : course.contentMode === "textbook" && !chapter
        ? await renderTextbookPdf(course, exportId)
        : await renderCoursePdf(course.id, { chapterId: chapter?.id });
  const baseName = chapter
    ? `${sanitize(course.topic)}-${sanitize(chapter.title)}`
    : sanitize(course.topic);
  const job: ExportJob = {
    id: exportId,
    userId,
    courseId: course.id,
    format,
    status: "succeeded",
    fileName: `${baseName}.${format}`,
    storagePath: `${pathSegment(userId ?? "local-beta-user")}/${pathSegment(course.id)}/${exportId}.${format}`,
    contentType: format === "tex" ? "application/x-tex" : "application/pdf",
    encoding: format === "tex" ? "utf8" : "base64",
    createdAt: now,
    updatedAt: now,
  };

  await writeExportContent(job, content);
  exportJobs.set(job.id, job);
  return job;
}

export function getExportJob(id: string) {
  return exportJobs.get(id);
}

export async function readExportContent(job: ExportJob) {
  if (job.content) {
    return job.encoding === "base64"
      ? Buffer.from(job.content, "base64")
      : Buffer.from(job.content, "utf8");
  }

  if (job.storageProvider === "supabase" && job.storagePath) {
    const remote = await readSupabaseExportContent(job);
    if (remote) return remote;
  }

  return readFile(localExportPath(job));
}

async function writeExportContent(job: ExportJob, content: string | Buffer) {
  const bytes = typeof content === "string" ? Buffer.from(content, "utf8") : content;
  const remoteStored = await writeSupabaseExportContent(job, bytes);
  if (remoteStored) {
    job.storageProvider = "supabase";
    return;
  }

  if (hasSupabaseServerConfig() && isUuid(job.userId)) {
    throw new Error("Supabase export upload failed.");
  }

  job.storageProvider = "local";
  const path = localExportPath(job);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

async function writeSupabaseExportContent(job: ExportJob, bytes: Buffer) {
  if (!job.storagePath) return false;
  if (!isUuid(job.userId)) return false;
  const supabase = createSupabaseServiceClient();
  if (!supabase) return false;

  const { error } = await supabase.storage
    .from(getSupabaseExportsBucket())
    .upload(job.storagePath, bytes, {
      contentType: job.contentType ?? "application/octet-stream",
      upsert: true,
    });

  if (error) {
    throw new Error(`Supabase export upload failed: ${error.message}`);
  }

  return !error;
}

async function readSupabaseExportContent(job: ExportJob) {
  if (!job.storagePath) return undefined;
  const supabase = createSupabaseServiceClient();
  if (!supabase) return undefined;

  const { data, error } = await supabase.storage
    .from(getSupabaseExportsBucket())
    .download(job.storagePath);
  if (error) {
    throw new Error(`Supabase export download failed: ${error.message}`);
  }
  if (!data) {
    throw new Error("Supabase export download failed: no data returned.");
  }

  return Buffer.from(await data.arrayBuffer());
}

function localExportPath(job: ExportJob) {
  return resolveLocalExportPath(job.storagePath, `${job.id}.${job.format}`);
}

async function renderTextbookPdf(course: Course, exportId: string) {
  const projectDir = join(process.cwd(), ".next", "tex-exports", exportId);
  const assetDir = join(projectDir, "assets");
  await mkdir(assetDir, { recursive: true });
  const tex = await toTex(course, { assetDir });
  const mainTexPath = join(projectDir, "main.tex");
  await writeFile(mainTexPath, tex, "utf8");

  try {
    const result = await compileLatexProject(mainTexPath);
    return result.pdf;
  } catch (error) {
    if (error instanceof TeXCompileError) {
      throw new Error(
        [
          error.message,
          `TeX project kept at: ${error.projectDir ?? projectDir}`,
          error.log ? lastInterestingLogLines(error.log) : "",
        ].filter(Boolean).join("\n"),
      );
    }
    throw error;
  }
}

async function toTex(course: Course, options: { assetDir?: string } = {}) {
  if (course.contentMode === "textbook") return toTextbookTex(course, options);

  const chapters = course.chapters
    .map((chapter) => `\\section{${escapeTex(chapter.title)}}\n${escapeTex(chapter.content ?? UNGENERATED_CHAPTER_TEXT)}`)
    .join("\n\n");
  return `\\documentclass{article}
\\usepackage{ctex}
\\begin{document}
\\title{${escapeTex(course.topic)}}
\\maketitle
${chapters}
\\end{document}
`;
}

async function toTextbookTex(course: Course, options: { assetDir?: string } = {}) {
  const meta = course.textbookMeta;
  const title = meta?.title || course.topic;
  const subtitle = meta?.subtitle || course.goal;
  const map = meta?.textbookMap;
  const chapters = course.chapters.map(async (chapter) => [
      `\\chapter{${escapeTex(chapter.title)}}`,
      chapter.description ? `\\begin{quote}\\small ${escapeTex(chapter.description)}\\end{quote}` : "",
      await markdownToTex(chapter.content ?? chapter.sections?.map((section) => section.content).join("\n\n") ?? UNGENERATED_CHAPTER_TEXT, options),
    ].filter(Boolean).join("\n\n"));
  const chapterTex = (await Promise.all(chapters)).join("\n\n");

  return `\\documentclass[UTF8,oneside]{ctexbook}
\\usepackage[a4paper,margin=2.6cm]{geometry}
\\usepackage{amsmath,amssymb,amsthm}
\\usepackage{booktabs,longtable,graphicx}
\\usepackage[hidelinks]{hyperref}
\\numberwithin{figure}{chapter}
\\numberwithin{table}{chapter}
\\newtheorem{definition}{定义}[chapter]
\\newtheorem{example}{例}[chapter]
\\newtheorem{theorem}{定理}[chapter]
\\newtheorem{algorithm}{算法}[chapter]
\\title{${escapeTex(title)}}
\\author{LearnByAI}
\\date{${escapeTex(new Date(course.createdAt).toLocaleDateString("zh-CN"))}}
\\begin{document}
\\frontmatter
\\begin{titlepage}
\\centering
\\vspace*{0.28\\textheight}
{\\Huge\\bfseries ${escapeTex(title)}\\par}
\\vspace{1.2em}
{\\Large ${escapeTex(subtitle)}\\par}
\\vfill
{\\small LearnByAI · 个性化学习教材\\par}
\\vspace{0.8em}
{\\small ${course.chapters.length} 章 · ${escapeTex(new Date(course.createdAt).toLocaleDateString("zh-CN"))}\\par}
\\end{titlepage}
\\tableofcontents
${map ? await textbookMapTex(map.caption, map.url, options) : ""}
\\mainmatter
${chapterTex}
\\backmatter
\\chapter*{术语与符号}
${terminologyTex(course)}
\\end{document}
`;
}

async function textbookMapTex(caption: string, url?: string, options: { assetDir?: string } = {}) {
  const image = url ? await imageTex(url, caption, options) : `\\fbox{\\parbox{0.82\\textwidth}{\\centering ${escapeTex(caption)}}}`;
  return `\\chapter*{教材地图}
\\addcontentsline{toc}{chapter}{教材地图}
\\begin{figure}[htbp]
\\centering
${image}
\\caption*{${escapeTex(caption)}}
\\end{figure}
`;
}

function terminologyTex(course: Course) {
  const terms = course.courseBible.terminology ?? [];
  const notation = course.courseBible.notation ?? [];
  if (terms.length === 0 && notation.length === 0) return "本教材暂未生成独立术语表。";
  const termLines = terms.map((item) => `\\item[${escapeTex(item.term)}] ${escapeTex(item.definition)}`).join("\n");
  const notationLines = notation.map((item) => `\\item[${item.symbol}] ${escapeTex(item.meaning)}`).join("\n");
  return [
    termLines ? `\\section*{术语}\\begin{description}\n${termLines}\n\\end{description}` : "",
    notationLines ? `\\section*{符号}\\begin{description}\n${notationLines}\n\\end{description}` : "",
  ].filter(Boolean).join("\n\n");
}

/**
 * Block-based Markdown → LaTeX conversion for the textbook export. Handles
 * headings (numbering stripped — TeX counters own all numbers), fenced code →
 * verbatim, pipe tables → booktabs longtable, bullet/numbered lists →
 * itemize/enumerate, blockquotes → quote, display math passthrough, and
 * figures via the shared figure regex. HTML comments (failed-figure markers)
 * are dropped.
 */
export async function markdownToTex(markdown: string, options: { assetDir?: string } = {}) {
  const rawBlocks: string[] = [];
  const figureProtected = await replaceFiguresWithRawBlocks(markdown, rawBlocks, options);
  const lines = figureProtected.split(/\r?\n/u);
  const out: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";

    const raw = line.match(/^@@RAW_TEX_(\d+)@@$/u);
    if (raw) {
      out.push(rawBlocks[Number(raw[1])] ?? "");
      index += 1;
      continue;
    }

    // Fenced code block → verbatim.
    const fence = line.match(/^\s*(```|~~~)/u);
    if (fence) {
      const token = fence[1] ?? "```";
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? "").trimStart().startsWith(token)) {
        body.push(lines[index] ?? "");
        index += 1;
      }
      index += 1; // closing fence
      if (body.join("").trim()) {
        out.push(`\\begin{verbatim}\n${body.join("\n").replace(/\\end\{verbatim\}/gu, "")}\n\\end{verbatim}`);
      }
      continue;
    }

    // Display math ($$ ... $$) passes through untouched.
    if (/^\s*\$\$/u.test(line)) {
      const single = /^\s*\$\$[^$]+\$\$\s*$/u.test(line);
      out.push(line);
      index += 1;
      if (!single) {
        while (index < lines.length) {
          out.push(lines[index] ?? "");
          const closed = /\$\$\s*$/u.test(lines[index] ?? "");
          index += 1;
          if (closed) break;
        }
      }
      continue;
    }

    // Pipe table → booktabs longtable.
    if (/^\s*\|.*\|\s*$/u.test(line)) {
      const tableLines: string[] = [];
      while (index < lines.length && /^\s*\|.*\|\s*$/u.test(lines[index] ?? "")) {
        tableLines.push(lines[index] ?? "");
        index += 1;
      }
      out.push(tableToTex(tableLines));
      continue;
    }

    // Headings. The first line of every chapter is the mandated "# 第 N 章 …"
    // which duplicates the \chapter{} already emitted — drop it. TeX counters
    // number sections, so strip any leading "N.M" the writer put in the text.
    const h3 = line.match(/^###\s+(.+)$/u);
    if (h3) {
      out.push(`\\subsubsection{${escapeTex(stripHeadingNumber(h3[1] ?? ""))}}`);
      index += 1;
      continue;
    }
    const h2 = line.match(/^##\s+(.+)$/u);
    if (h2) {
      out.push(`\\section{${escapeTex(stripHeadingNumber(h2[1] ?? ""))}}`);
      index += 1;
      continue;
    }
    const h1 = line.match(/^#\s+(.+)$/u);
    if (h1) {
      const text = h1[1] ?? "";
      if (!/^第\s*[0-9一二三四五六七八九十百]+\s*章/u.test(text.trim())) {
        out.push(`\\section*{${escapeTex(stripHeadingNumber(text))}}`);
      }
      index += 1;
      continue;
    }

    // Bullet / numbered lists.
    if (/^\s*[-*]\s+/u.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*]\s+/u.test(lines[index] ?? "")) {
        items.push(escapeMarkdownText((lines[index] ?? "").replace(/^\s*[-*]\s+/u, "")));
        index += 1;
      }
      out.push(`\\begin{itemize}\n${items.map((item) => `\\item ${item}`).join("\n")}\n\\end{itemize}`);
      continue;
    }
    if (/^\s*\d+[.)]\s+/u.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/u.test(lines[index] ?? "")) {
        items.push(escapeMarkdownText((lines[index] ?? "").replace(/^\s*\d+[.)]\s+/u, "")));
        index += 1;
      }
      out.push(`\\begin{enumerate}\n${items.map((item) => `\\item ${item}`).join("\n")}\n\\end{enumerate}`);
      continue;
    }

    // Blockquote (includes failed-figure notes).
    if (/^\s*>\s?/u.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length && /^\s*>\s?/u.test(lines[index] ?? "")) {
        quoted.push(escapeMarkdownText((lines[index] ?? "").replace(/^\s*>\s?/u, "")));
        index += 1;
      }
      out.push(`\\begin{quote}\\small ${quoted.join(" ")}\\end{quote}`);
      continue;
    }

    // HTML comments (e.g. failed-figure retry markers) never reach the PDF.
    if (/^\s*<!--[\s\S]*?-->\s*$/u.test(line)) {
      index += 1;
      continue;
    }

    if (!line.trim()) {
      out.push("");
      index += 1;
      continue;
    }
    if (/^\s*\\\[/u.test(line) || /^\s*\\\(/u.test(line)) {
      out.push(line);
      index += 1;
      continue;
    }
    out.push(escapeMarkdownText(line));
    index += 1;
  }

  return out.join("\n");
}

function stripHeadingNumber(text: string) {
  return text.trim().replace(/^\d+(?:\.\d+)*\s*/u, "");
}

function tableToTex(tableLines: string[]) {
  const rows = tableLines
    .map((line) => line.trim().replace(/^\|/u, "").replace(/\|$/u, "").split("|").map((cell) => cell.trim()))
    .filter((cells) => cells.some((cell) => cell.length > 0));
  if (rows.length === 0) return "";

  const isSeparator = (cells: string[]) => cells.every((cell) => /^:?-{2,}:?$/u.test(cell) || cell === "");
  const header = rows[0] ?? [];
  const bodyRows = rows.slice(1).filter((cells) => !isSeparator(cells));
  const columnCount = Math.max(header.length, ...bodyRows.map((cells) => cells.length), 1);
  const spec = Array.from({ length: columnCount }, () => "l").join("");
  const renderRow = (cells: string[]) =>
    Array.from({ length: columnCount }, (_, i) => escapeMarkdownText(cells[i] ?? "")).join(" & ") + " \\\\";

  return [
    `\\begin{longtable}{${spec}}`,
    "\\toprule",
    renderRow(header),
    "\\midrule",
    ...bodyRows.map(renderRow),
    "\\bottomrule",
    "\\end{longtable}",
  ].join("\n");
}

async function replaceFiguresWithRawBlocks(markdown: string, rawBlocks: string[], options: { assetDir?: string }) {
  const figureRe = createFigureMarkdownRe();
  let output = "";
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = figureRe.exec(markdown))) {
    output += markdown.slice(last, match.index);
    const caption = (match[4] ?? match[2] ?? "插图").trim();
    const url = (match[3] ?? "").trim();
    const raw = [
      "\\begin{figure}[htbp]",
      "\\centering",
      await imageTex(url, caption, options),
      `\\caption{${escapeTex(caption)}}`,
      "\\end{figure}",
    ].join("\n");
    rawBlocks.push(raw);
    output += `\n@@RAW_TEX_${rawBlocks.length - 1}@@\n`;
    last = match.index + match[0].length;
  }
  output += markdown.slice(last);
  return output;
}

async function imageTex(url: string, caption: string, options: { assetDir?: string } = {}) {
  const asset = await copyIllustrationAsset(url, options.assetDir);
  if (asset) return `\\includegraphics[width=0.82\\textwidth]{${asset}}`;
  return `\\fbox{\\parbox{0.78\\textwidth}{\\centering ${escapeTex(caption)}\\\\\\small\\url{${escapeUrlTex(url)}}}}`;
}

let texAssetCounter = 0;
async function copyIllustrationAsset(url: string, assetDir?: string) {
  if (!assetDir || !url.startsWith(ILLUSTRATION_URL_PREFIX)) return undefined;
  const storagePath = decodeURIComponent(url.slice(ILLUSTRATION_URL_PREFIX.length));
  const ext = storagePath.split(".").at(-1)?.toLowerCase();
  if (ext !== "png" && ext !== "jpg" && ext !== "jpeg" && ext !== "svg") return undefined;
  const image = await readIllustrationImage(storagePath);
  if (!image) return undefined;
  await mkdir(assetDir, { recursive: true });
  texAssetCounter += 1;

  // LaTeX cannot \includegraphics an SVG (code-rendered figures) — rasterize
  // it to PNG with the headless Chromium that already backs the PDF export.
  if (ext === "svg") {
    const png = await rasterizeSvg(image.bytes.toString("utf8"));
    const fileName = `figure-${String(texAssetCounter).padStart(3, "0")}.png`;
    await writeFile(join(assetDir, fileName), png);
    return `assets/${fileName}`;
  }

  const fileName = `figure-${String(texAssetCounter).padStart(3, "0")}.${ext === "jpeg" ? "jpg" : ext}`;
  await writeFile(join(assetDir, fileName), image.bytes);
  return `assets/${fileName}`;
}

function lastInterestingLogLines(log: string) {
  return log
    .split(/\r?\n/u)
    .filter((line) => /^!|^l\.\d+|LaTeX Error|Package .* Error/u.test(line))
    .slice(-12)
    .join("\n");
}

function sanitize(value: string) {
  return value.replace(/[^\w\u4e00-\u9fa5-]+/gu, "-").replace(/-+/gu, "-");
}

function pathSegment(value: string) {
  return value.replace(/[^\w-]+/gu, "-").replace(/-+/gu, "-").slice(0, 120);
}

function escapeTex(value: string) {
  return value.replace(/[&%$#_{}]/gu, (char) => `\\${char}`);
}

function escapeMarkdownText(value: string) {
  const math: string[] = [];
  // \\\([\s\S]*?\\\) (non-greedy to the literal "\)") also matches inline math
  // that itself contains parens, e.g. \(f(x)\).
  const protectedText = value.replace(/(\$\$[\s\S]*?\$\$|\$[^$\n]+\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\))/gu, (match) => {
    math.push(match);
    return `@@MATH${math.length - 1}@@`;
  });
  const escaped = escapeTex(protectedText)
    .replace(/\*\*([^*]+)\*\*/gu, "\\textbf{$1}")
    .replace(/`([^`]+)`/gu, "\\texttt{$1}");
  return escaped.replace(/@@MATH(\d+)@@/gu, (_match, index) => math[Number(index)] ?? "");
}

function escapeUrlTex(value: string) {
  return value.replace(/[{}\\]/gu, "");
}

function isUuid(value?: string) {
  return Boolean(
    value?.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
  );
}
