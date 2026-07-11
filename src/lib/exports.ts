import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getSupabaseExportsBucket, hasSupabaseServerConfig } from "./config";
import { getTexProjectStoreDir, resolveLocalExportPath } from "./exportPaths";
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

type TexOptions = { assetDir?: string };
type ImageTexOptions = { width?: string; height?: string; keepAspectRatio?: boolean };

async function renderTextbookPdf(course: Course, exportId: string) {
  const projectDir = join(getTexProjectStoreDir(), exportId);
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

export async function toTex(course: Course, options: TexOptions = {}) {
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

async function toTextbookTex(course: Course, options: TexOptions = {}) {
  const meta = course.textbookMeta;
  const title = meta?.title || course.topic;
  const subtitle = meta?.subtitle || course.goal;
  const createdDate = formatCourseDate(course.createdAt);
  const map = meta?.textbookMap;
  const chapters = course.chapters.map(async (chapter) => [
      `\\chapter{${escapeTex(chapter.title)}}`,
      chapter.description ? `\\begin{quote}\\small\\itshape ${escapeMarkdownText(chapter.description)}\\end{quote}` : "",
      await markdownToTex(chapter.content ?? chapter.sections?.map((section) => section.content).join("\n\n") ?? UNGENERATED_CHAPTER_TEXT, options),
    ].filter(Boolean).join("\n\n"));
  const chapterTex = (await Promise.all(chapters)).join("\n\n");

  return `\\documentclass[UTF8,openany,oneside,12pt]{ctexbook}
\\usepackage[a4paper,top=2.8cm,bottom=2.8cm,left=3.0cm,right=2.6cm,headheight=15pt]{geometry}
\\usepackage{amsmath,amssymb,amsthm,mathtools}
\\usepackage{booktabs,longtable,array,ragged2e,colortbl,graphicx,float}
\\usepackage{caption}
\\usepackage{enumitem}
\\usepackage{fancyhdr}
\\usepackage{xcolor}
\\usepackage{listings,upquote}
\\usepackage{needspace}
\\usepackage{pdflscape}
\\usepackage[hidelinks]{hyperref}
\\makeatletter
\\providecommand{\\cmrsideswitch}{}
\\makeatother
\\hypersetup{pdftitle={${escapeTex(title)}},pdfauthor={LearnByAI}}
\\setcounter{tocdepth}{3}
\\setcounter{secnumdepth}{3}
\\linespread{1.16}
\\setlength{\\parindent}{2em}
\\setlength{\\parskip}{0pt}
\\setlist[itemize]{leftmargin=2.2em,itemsep=0.25em,topsep=0.35em}
\\setlist[enumerate]{leftmargin=2.2em,itemsep=0.25em,topsep=0.35em}
\\captionsetup{font=small,labelfont=bf,labelsep=quad}
\\definecolor{LearnByAITableHeader}{HTML}{F1F3F5}
\\definecolor{LearnByAICodeBackground}{HTML}{F5F7FA}
\\definecolor{LearnByAICodeBorder}{HTML}{B9C1CC}
\\definecolor{LearnByAICodeKeyword}{HTML}{9B3328}
\\definecolor{LearnByAICodeComment}{HTML}{55705A}
\\definecolor{LearnByAICodeString}{HTML}{285D86}
\\definecolor{LearnByAICodeMeta}{HTML}{5F6977}
\\newcolumntype{L}[1]{>{\\RaggedRight\\arraybackslash}p{\\dimexpr#1\\linewidth-2\\tabcolsep\\relax}}
\\lstdefinestyle{learnbyai}{
  backgroundcolor=\\color{LearnByAICodeBackground},
  basicstyle=\\small\\ttfamily,
  keywordstyle=\\bfseries\\color{LearnByAICodeKeyword},
  commentstyle=\\itshape\\color{LearnByAICodeComment},
  stringstyle=\\color{LearnByAICodeString},
  frame=single,
  framerule=0.5pt,
  rulecolor=\\color{LearnByAICodeBorder},
  framesep=8pt,
  xleftmargin=0.4em,
  xrightmargin=0.4em,
  framexleftmargin=0.4em,
  framexrightmargin=0.4em,
  breaklines=true,
  breakatwhitespace=false,
  columns=fullflexible,
  keepspaces=true,
  showstringspaces=false,
  upquote=true,
  tabsize=4,
  aboveskip=1em,
  belowskip=1em,
  captionpos=t
}
\\renewcommand{\\figurename}{图}
\\renewcommand{\\tablename}{表}
\\numberwithin{figure}{chapter}
\\numberwithin{table}{chapter}
\\numberwithin{equation}{chapter}
\\newtheorem{definition}{定义}[chapter]
\\newtheorem{example}{例}[chapter]
\\newtheorem{theorem}{定理}[chapter]
\\newtheorem{algorithm}{算法}[chapter]
\\pagestyle{fancy}
\\fancyhf{}
\\fancyhead[C]{\\small\\nouppercase{\\leftmark}}
\\fancyfoot[C]{\\thepage}
\\renewcommand{\\headrulewidth}{0.4pt}
\\fancypagestyle{plain}{\\fancyhf{}\\fancyfoot[C]{\\thepage}\\renewcommand{\\headrulewidth}{0pt}}
\\emergencystretch=2em
\\sloppy
\\begin{document}
\\frontmatter
\\pagenumbering{roman}
\\begin{titlepage}
\\thispagestyle{empty}
\\centering
\\vspace*{0.28\\textheight}
{\\Huge\\bfseries\\begin{minipage}{0.84\\textwidth}\\centering\\linespread{1.12}\\selectfont ${escapeTex(title)}\\end{minipage}\\par}
\\vspace{1.2em}
{\\Large\\begin{minipage}{0.72\\textwidth}\\centering ${escapeTex(subtitle)}\\end{minipage}\\par}
\\vfill
{\\normalsize LearnByAI\\par}
\\vspace{0.8em}
{\\small 个性化学习教材 · ${course.chapters.length} 章 · ${escapeTex(createdDate)}\\par}
\\end{titlepage}
\\cleardoublepage
${prefaceTex(course, title, createdDate)}
\\cleardoublepage
\\tableofcontents
\\cleardoublepage
${map ? await textbookMapTex(map.caption, map.url, options) : ""}
\\mainmatter
${chapterTex}
\\backmatter
\\chapter*{术语与符号}
\\markboth{术语与符号}{术语与符号}
\\addcontentsline{toc}{chapter}{术语与符号}
${terminologyTex(course)}
\\end{document}
`;
}

async function textbookMapTex(caption: string, url?: string, options: TexOptions = {}) {
  const image = url
    ? await imageTex(url, caption, options, { width: "0.96\\textwidth", height: "0.58\\textheight" })
    : `\\fbox{\\parbox{0.9\\textwidth}{\\centering ${escapeTex(caption)}}}`;
  return `\\chapter*{全书结构地图}
\\markboth{全书结构地图}{全书结构地图}
\\addcontentsline{toc}{chapter}{全书结构地图}
\\begin{center}
${image}
\\par\\vspace{0.6em}
{\\small\\bfseries ${escapeTex(caption)}}
\\end{center}
\\vspace{1em}
${textbookMapOverviewTex(caption)}
\\par\\smallskip
{\\small\\itshape 注：本页为全书导读地图，不占用正文图编号；章节内插图仍按“图 N.M”连续编号。}
\\cleardoublepage
`;
}

function prefaceTex(course: Course, title: string, createdDate: string) {
  const bible = course.courseBible;
  const outcomes = (bible.finalOutcomes ?? []).slice(0, 5);
  const prerequisites = (bible.prerequisites ?? []).slice(0, 5);
  const outcomeItems = outcomes.map((item) => `\\item ${escapeMarkdownText(item)}`).join("\n");
  const prerequisiteItems = prerequisites.map((item) => `\\item ${escapeMarkdownText(item)}`).join("\n");
  const audience = bible.targetLearner || course.profile || "希望系统学习该主题的读者";

  return `\\chapter*{前言}
\\markboth{前言}{前言}
\\addcontentsline{toc}{chapter}{前言}
${escapeMarkdownText(title)} 是一本由 LearnByAI 生成并排版的个性化教材。本教材围绕读者的学习目标组织内容，力求在概念、数学表达、例子和实践线索之间建立连续的学习路径。

\\medskip
\\noindent\\textbf{读者对象。} ${escapeMarkdownText(audience)}

${course.goal ? `\\medskip\n\\noindent\\textbf{学习目标。} ${escapeMarkdownText(course.goal)}` : ""}

${outcomeItems ? `\\medskip\n\\noindent\\textbf{完成本教材后，读者应能：}\n\\begin{itemize}\n${outcomeItems}\n\\end{itemize}` : ""}

${prerequisiteItems ? `\\medskip\n\\noindent\\textbf{建议预备知识：}\n\\begin{itemize}\n${prerequisiteItems}\n\\end{itemize}` : ""}

本教材的正文按章节推进，前后章节会尽量保持概念承接和问题延续。读者可以先通读“全书结构地图”把握整体路线，再进入各章细读。

\\begin{flushright}
LearnByAI\\\\
${escapeTex(createdDate)}
\\end{flushright}
`;
}

function textbookMapOverviewTex(caption: string) {
  return [
    "上图概览了本教材的章节结构和学习路径。它适合在开始阅读前快速建立全局感，也适合在学习中途回看自己所处的位置。",
    `地图标题为“${escapeMarkdownText(caption)}”。读者可以先沿主线阅读，再根据自己的目标回到相关章节补充概念、例子或方法细节。`,
  ].join("\n\n");
}

function terminologyTex(course: Course) {
  const terms = course.courseBible.terminology ?? [];
  const notation = course.courseBible.notation ?? [];
  if (terms.length === 0 && notation.length === 0) return "本教材暂未生成独立术语表。";
  const termLines = terms.map((item) => `\\item[${escapeMarkdownText(item.term)}] ${escapeMarkdownText(item.definition)}`).join("\n");
  const notationLines = notation.map((item) => `\\item[${notationSymbolTex(item.symbol)}] ${escapeMarkdownText(item.meaning)}`).join("\n");
  return [
    termLines ? `\\section*{术语}\\begin{description}\n${termLines}\n\\end{description}` : "",
    notationLines ? `\\section*{符号}\\begin{description}\n${notationLines}\n\\end{description}` : "",
  ].filter(Boolean).join("\n\n");
}

function notationSymbolTex(symbol: string) {
  const trimmed = symbol.trim();
  if (!trimmed) return "";
  if (/^(?:\$[\s\S]*\$|\\\([\s\S]*\\\)|\\\[[\s\S]*\\\])$/u.test(trimmed)) return trimmed;
  return `$${trimmed.replace(/\$/gu, "")}$`;
}

/**
 * Block-based Markdown → LaTeX conversion for the textbook export. Handles
 * headings (numbering stripped — TeX counters own all numbers), fenced code →
 * verbatim, pipe tables → booktabs longtable, bullet/numbered lists →
 * itemize/enumerate, blockquotes → quote, display math passthrough, and
 * figures via the shared figure regex. HTML comments (failed-figure markers)
 * are dropped.
 */
export async function markdownToTex(markdown: string, options: TexOptions = {}) {
  const rawBlocks: string[] = [];
  const figureProtected = await replaceFiguresWithRawBlocks(markdown, rawBlocks, options);
  const lines = figureProtected.split(/\r?\n/u);
  const out: string[] = [];
  let index = 0;
  let fixedListKind: "exercise" | "reading" | undefined;

  while (index < lines.length) {
    const line = lines[index] ?? "";

    const raw = line.match(/^@@RAW_TEX_(\d+)@@$/u);
    if (raw) {
      out.push(rawBlocks[Number(raw[1])] ?? "");
      index += 1;
      continue;
    }

    // Fenced code block → framed, line-wrapping textbook listing.
    const fence = line.match(/^\s*(```|~~~)\s*([A-Za-z0-9_+#.-]*)\s*$/u);
    if (fence) {
      const token = fence[1] ?? "```";
      const language = fence[2] ?? "";
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? "").trimStart().startsWith(token)) {
        body.push(lines[index] ?? "");
        index += 1;
      }
      index += 1; // closing fence
      if (body.join("").trim()) {
        out.push(codeBlockToTex(body.join("\n"), language));
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
      const heading = stripHeadingNumber(h3[1] ?? "");
      fixedListKind = fixedListKindForHeading(heading);
      out.push(`\\subsubsection{${escapeMarkdownText(heading)}}`);
      index += 1;
      continue;
    }
    const h2 = line.match(/^##\s+(.+)$/u);
    if (h2) {
      const heading = stripHeadingNumber(h2[1] ?? "");
      fixedListKind = fixedListKindForHeading(heading);
      out.push(`\\section{${escapeMarkdownText(heading)}}`);
      index += 1;
      continue;
    }
    const h1 = line.match(/^#\s+(.+)$/u);
    if (h1) {
      const text = h1[1] ?? "";
      fixedListKind = fixedListKindForHeading(stripHeadingNumber(text));
      if (!/^第\s*[0-9一二三四五六七八九十百]+\s*章/u.test(text.trim())) {
        out.push(`\\section*{${escapeMarkdownText(stripHeadingNumber(text))}}`);
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
      if (fixedListKind) {
        const parsed = await fixedSectionListToTex(lines, index, fixedListKind, options);
        out.push(parsed.tex);
        index = parsed.nextIndex;
        continue;
      }
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

function fixedListKindForHeading(heading: string) {
  const normalized = heading.replace(/\s+/gu, "");
  if (/^(?:(?:课后)?(?:练习|习题)(?:与思考)?|思考与(?:练习|习题))$/u.test(normalized)) {
    return "exercise" as const;
  }
  if (/^拓展阅读$/u.test(normalized)) return "reading" as const;
  return undefined;
}

async function fixedSectionListToTex(
  lines: string[],
  startIndex: number,
  kind: "exercise" | "reading",
  options: TexOptions,
) {
  const items: string[] = [];
  let current: string[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (/^#{1,3}\s+/u.test(line)) break;

    const marker = line.match(/^\s*\d+[.)]\s+([\s\S]*)$/u);
    if (marker) {
      if (current.length) items.push(current.join("\n").trim());
      current = [marker[1] ?? ""];
    } else {
      current.push(line);
    }
    index += 1;
  }
  if (current.length) items.push(current.join("\n").trim());

  const convertedItems = await Promise.all(
    items
      .filter(Boolean)
      .map(async (item) => `\\item ${await markdownToTex(item, options)}`),
  );
  const settings = kind === "exercise"
    ? "label=\\arabic*.,leftmargin=2.8em,itemsep=0.9em,topsep=0.6em"
    : "label=\\arabic*.,leftmargin=2.4em,itemsep=0.75em,topsep=0.55em";
  return {
    tex: `\\begin{enumerate}[${settings}]\n${convertedItems.join("\n\n")}\n\\end{enumerate}`,
    nextIndex: index,
  };
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
  const widths = tableColumnWidths(header, bodyRows, columnCount);
  const landscape = tableNeedsLandscape(header, bodyRows, widths);
  const spec = `@{}${widths.map((width) => `L{${width.toFixed(4)}}`).join("")}@{}`;
  const renderRow = (cells: string[], bold = false) =>
    Array.from({ length: columnCount }, (_, i) => {
      const content = escapeMarkdownText(cells[i] ?? "");
      return bold && content ? `\\textbf{${content}}` : content;
    }).join(" & ") + " \\\\";
  const fontSize = landscape
    ? "\\small"
    : columnCount >= 7
      ? "\\scriptsize"
      : columnCount >= 4
        ? "\\footnotesize"
        : "\\small";
  const tabColumnSeparation = landscape ? "4pt" : columnCount >= 6 ? "2.5pt" : columnCount >= 4 ? "3.5pt" : "4pt";
  const headerRow = renderRow(header, true);

  const table = [
    "\\begingroup",
    fontSize,
    `\\setlength{\\tabcolsep}{${tabColumnSeparation}}`,
    "\\renewcommand{\\arraystretch}{1.28}",
    "\\setlength{\\LTleft}{0pt}",
    "\\setlength{\\LTright}{0pt}",
    `\\begin{longtable}{${spec}}`,
    "\\toprule",
    "\\rowcolor{LearnByAITableHeader}",
    headerRow,
    "\\midrule",
    "\\endfirsthead",
    "\\toprule",
    "\\rowcolor{LearnByAITableHeader}",
    headerRow,
    "\\midrule",
    "\\endhead",
    ...bodyRows.map((row) => renderRow(row)),
    "\\bottomrule",
    "\\end{longtable}",
    "\\endgroup",
  ].join("\n");
  const landscapeSpacing = bodyRows.length <= 12 ? "\\vspace*{\\fill}\n" : "";
  return landscape
    ? `\\clearpage\n\\begin{landscape}\n\\pagestyle{empty}\n${landscapeSpacing}${table}\n${landscapeSpacing}\\end{landscape}\n\\pagestyle{fancy}\n\\clearpage`
    : table;
}

function codeBlockToTex(body: string, language: string) {
  const codeLanguage = normalizeCodeLanguage(language);
  const options = [
    "style=learnbyai",
    codeLanguage.listingsLanguage ? `language=${codeLanguage.listingsLanguage}` : "",
    codeLanguage.label
      ? `title={\\footnotesize\\sffamily\\bfseries\\color{LearnByAICodeMeta}${escapeTex(codeLanguage.label)}}`
      : "",
  ].filter(Boolean).join(",");
  const safeBody = body.replace(/\\end\{lstlisting\}/gu, "\\end{listing}");
  return `\\Needspace{10\\baselineskip}\n\\begin{lstlisting}[${options}]\n${safeBody}\n\\end{lstlisting}`;
}

function normalizeCodeLanguage(language: string) {
  const normalized = language.trim().toLowerCase();
  const languages: Record<string, { label: string; listingsLanguage?: string }> = {
    bash: { label: "Bash", listingsLanguage: "bash" },
    c: { label: "C", listingsLanguage: "C" },
    cpp: { label: "C++", listingsLanguage: "C++" },
    "c++": { label: "C++", listingsLanguage: "C++" },
    html: { label: "HTML", listingsLanguage: "HTML" },
    java: { label: "Java", listingsLanguage: "Java" },
    latex: { label: "LaTeX", listingsLanguage: "TeX" },
    matlab: { label: "MATLAB", listingsLanguage: "Matlab" },
    py: { label: "Python", listingsLanguage: "Python" },
    python: { label: "Python", listingsLanguage: "Python" },
    r: { label: "R", listingsLanguage: "R" },
    sh: { label: "Shell", listingsLanguage: "bash" },
    shell: { label: "Shell", listingsLanguage: "bash" },
    sql: { label: "SQL", listingsLanguage: "SQL" },
    tex: { label: "TeX", listingsLanguage: "TeX" },
    xml: { label: "XML", listingsLanguage: "XML" },
  };
  const labels: Record<string, string> = {
    javascript: "JavaScript",
    js: "JavaScript",
    json: "JSON",
    jsx: "JSX",
    pseudocode: "Pseudocode",
    text: "Text",
    ts: "TypeScript",
    tsx: "TSX",
    typescript: "TypeScript",
    yaml: "YAML",
    yml: "YAML",
  };
  return languages[normalized] ?? { label: labels[normalized] ?? language.trim() };
}

function tableColumnWidths(header: string[], bodyRows: string[][], columnCount: number) {
  const rows = [header, ...bodyRows];
  const scores = Array.from({ length: columnCount }, (_, columnIndex) => {
    const cellScores = rows.map((row) => tableCellWidthScore(row[columnIndex] ?? "")).sort((a, b) => b - a);
    const largest = cellScores[0] ?? 1;
    const secondLargest = cellScores[1] ?? largest;
    return Math.max(4, Math.min(42, largest * 0.7 + secondLargest * 0.3));
  });
  const minWidth = columnCount >= 6 ? 0.1 : columnCount >= 4 ? 0.12 : 0.16;
  const maxWidth = columnCount === 2 ? 0.7 : columnCount === 3 ? 0.52 : 0.42;
  return distributeColumnWidths(scores, minWidth, maxWidth);
}

function tableNeedsLandscape(header: string[], bodyRows: string[][], widths: number[]) {
  const columnCount = widths.length;
  if (columnCount <= 5) return false;
  if (columnCount >= 8) return true;

  const rows = [header, ...bodyRows];
  const unbreakableScores = widths.map((_width, columnIndex) =>
    Math.max(...rows.map((row) => tableCellUnbreakableWidthScore(row[columnIndex] ?? "")), 1));
  const portraitCapacity = 92;
  const overflowRatios = unbreakableScores.map((score, index) =>
    score / Math.max((widths[index] ?? 0) * portraitCapacity, 1));
  const worstOverflow = Math.max(...overflowRatios);
  const requiredWidth = unbreakableScores.reduce(
    (sum, score) => sum + Math.max(0.075, Math.min(0.42, (score + 2) / portraitCapacity)),
    0,
  );

  // Six-column comparison tables are common in textbooks. Keep them in the
  // normal reading flow unless several rows contain formulas or identifiers
  // that genuinely cannot wrap cleanly in portrait.
  if (columnCount === 6) {
    return bodyRows.length >= 5 && worstOverflow > 1.75 && requiredWidth > 1.2;
  }

  // Seven-column tables may still fit in portrait when their cells are short.
  // Dense algorithm matrices with long formulas use a dedicated landscape page.
  return bodyRows.length >= 5
    || (bodyRows.length >= 4 && (worstOverflow > 1.25 || requiredWidth > 1.08));
}

function tableCellWidthScore(value: string) {
  const plain = value
    .replace(/\$\$?([\s\S]*?)\$\$?/gu, "$1")
    .replace(/\\\(([\s\S]*?)\\\)/gu, "$1")
    .replace(/\\[A-Za-z]+/gu, "x")
    .replace(/[*_`{}]/gu, "");
  return Array.from(plain).reduce((width, char) => width + (/[\u2e80-\u9fff]/u.test(char) ? 2 : 1), 0);
}

function tableCellUnbreakableWidthScore(value: string) {
  const tokens = value.match(
    /\$\$?[\s\S]*?\$\$?|\\\([\s\S]*?\\\)|`[^`]*`|[A-Za-z0-9][A-Za-z0-9_.:+/'-]*/gu,
  ) ?? [];
  return Math.max(2, ...tokens.map((token) => tableCellWidthScore(token)));
}

function distributeColumnWidths(scores: number[], minWidth: number, maxWidth: number) {
  if (scores.length === 1) return [1];
  const widths = Array(scores.length).fill(0) as number[];
  const remaining = new Set(scores.map((_score, index) => index));
  let remainingWidth = 1;

  while (remaining.size > 0) {
    const remainingScore = [...remaining].reduce((sum, index) => sum + (scores[index] ?? 1), 0);
    let constrained = false;

    for (const index of [...remaining]) {
      const proposed = remainingWidth * (scores[index] ?? 1) / Math.max(remainingScore, 1);
      if (proposed < minWidth) {
        widths[index] = minWidth;
      } else if (proposed > maxWidth) {
        widths[index] = maxWidth;
      } else {
        continue;
      }
      remainingWidth -= widths[index] ?? 0;
      remaining.delete(index);
      constrained = true;
    }

    if (!constrained) {
      for (const index of remaining) {
        widths[index] = remainingWidth * (scores[index] ?? 1) / Math.max(remainingScore, 1);
      }
      break;
    }
  }

  const total = widths.reduce((sum, width) => sum + width, 0);
  return widths.map((width) => width / total);
}

async function replaceFiguresWithRawBlocks(markdown: string, rawBlocks: string[], options: TexOptions) {
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

async function imageTex(url: string, caption: string, options: TexOptions = {}, imageOptions: ImageTexOptions = {}) {
  const asset = await copyIllustrationAsset(url, options.assetDir);
  const width = imageOptions.width ?? "0.82\\textwidth";
  const graphicOptions = [
    `width=${width}`,
    imageOptions.height ? `height=${imageOptions.height}` : "",
    imageOptions.keepAspectRatio === false ? "" : "keepaspectratio",
  ].filter(Boolean).join(",");
  if (asset) return `\\includegraphics[${graphicOptions}]{${asset}}`;
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

function formatCourseDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toLocaleDateString("zh-CN");
  return date.toLocaleDateString("zh-CN");
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
  const bareMathProtected = protectBareLatexMath(protectedText, math);
  const escaped = escapeTex(bareMathProtected)
    .replace(/[ΑΒΓΔΘΛΞΠΣΦΨΩαβγδεζηθικλμνξπρστυφχψω]/gu, (char) => unicodeGreekTex(char))
    .replace(/\*\*([^*]+)\*\*/gu, "\\textbf{$1}")
    .replace(/`([^`]+)`/gu, "\\texttt{$1}");
  return escaped.replace(/@@MATH(\d+)@@/gu, (_match, index) => math[Number(index)] ?? "");
}

/**
 * Course metadata reaches the exporter without the chapter format guard.
 * Wrap compact, command-bearing TeX tokens so commands such as `\leq` never
 * leak into ordinary CJK text mode during XeLaTeX compilation.
 */
function protectBareLatexMath(value: string, math: string[]) {
  const command =
    String.raw`(?:alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|lambda|mu|nu|xi|pi|rho|sigma|tau|phi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Phi|Psi|Omega|le|leq|ge|geq|lt|gt|ne|neq|approx|sim|mid|times|cdot|div|pm|mp|infty|partial|nabla|sum|prod|int|lim|log|ln|exp|max|min|argmax|argmin|frac|dfrac|tfrac|sqrt|hat|bar|tilde|vec|mathcal|mathbb|mathbf|mathrm|operatorname|text|left|right|begin|end|quad|qquad)`;
  const token = new RegExp(
    String.raw`(?:[0-9A-Za-z()[\]{}_^.,+\-*/=<>|'|]*\\${command}\b[0-9A-Za-z()[\]{}_^.,+\-*/=<>|'|\\]*)`,
    "gu",
  );

  return value.replace(token, (candidate) => {
    const punctuation = /[.,]$/u.test(candidate) ? candidate.at(-1) ?? "" : "";
    const formula = punctuation ? candidate.slice(0, -1) : candidate;
    math.push(`$${formula}$`);
    return `@@MATH${math.length - 1}@@${punctuation}`;
  });
}

function unicodeGreekTex(char: string) {
  const greek: Record<string, string> = {
    Α: "A",
    Β: "B",
    Γ: "\\Gamma",
    Δ: "\\Delta",
    Θ: "\\Theta",
    Λ: "\\Lambda",
    Ξ: "\\Xi",
    Π: "\\Pi",
    Σ: "\\Sigma",
    Φ: "\\Phi",
    Ψ: "\\Psi",
    Ω: "\\Omega",
    α: "\\alpha",
    β: "\\beta",
    γ: "\\gamma",
    δ: "\\delta",
    ε: "\\varepsilon",
    ζ: "\\zeta",
    η: "\\eta",
    θ: "\\theta",
    ι: "\\iota",
    κ: "\\kappa",
    λ: "\\lambda",
    μ: "\\mu",
    ν: "\\nu",
    ξ: "\\xi",
    π: "\\pi",
    ρ: "\\rho",
    σ: "\\sigma",
    τ: "\\tau",
    υ: "\\upsilon",
    φ: "\\phi",
    χ: "\\chi",
    ψ: "\\psi",
    ω: "\\omega",
  };
  return `$${greek[char] ?? char}$`;
}

function escapeUrlTex(value: string) {
  return value.replace(/[{}\\]/gu, "");
}

function isUuid(value?: string) {
  return Boolean(
    value?.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
  );
}
