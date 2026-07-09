import "server-only";

import { generateIllustrationImage, getUserImageModelConfig, saveIllustrationImage } from "./illustration";
import { safeErrorMessage } from "./safeError";
import type { ModelOverrides } from "./modelOverrides";
import type { Chapter, Course, FigureAsset, FigurePlaceholder, ImageGenerationMode } from "./types";

const FIGURE_BLOCK_RE = /:::learnbyai-figure[^\n]*\n([\s\S]*?)\n:::/gu;
const MAX_FIGURE_CAPTION = 80;

/**
 * Matches a rendered figure in chapter Markdown: `![图 N.M caption](url)` plus
 * the optional `*图 N.M caption*` line below it. Accepts both the current dot
 * label (图 1.2) and the legacy dash label (图 1-2) written by the earlier
 * illustration beta, so retry and TeX export keep working on old chapters.
 * A factory (not a shared const) because /g regexes carry lastIndex state.
 */
export function createFigureMarkdownRe() {
  return /!\[(图\s*\d+[.\-]\d+)[\s　]+([^\]\n]+)\]\(([^)\n]+)\)(?:\s*\n\s*\*\1[\s　]+([^*\n]+)\*)?/gu;
}

type GeneratedFigureImage = {
  bytes: Buffer;
  contentType: string;
  ext: "png" | "jpg" | "webp" | "svg";
};

export type FigureReplacementResult = {
  content: string;
  assets: FigureAsset[];
  skipped: { caption: string; reason: string; mode: ImageGenerationMode }[];
};

type FigureBlock = {
  start: number;
  end: number;
  placeholder: FigurePlaceholder;
};

export function hasFigurePlaceholders(content: string) {
  FIGURE_BLOCK_RE.lastIndex = 0;
  return FIGURE_BLOCK_RE.test(content);
}

export function parseFigurePlaceholders(content: string): FigureBlock[] {
  const blocks: FigureBlock[] = [];
  FIGURE_BLOCK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FIGURE_BLOCK_RE.exec(content))) {
    const placeholder = parseFigureBlockBody(match[1] ?? "");
    if (placeholder) {
      blocks.push({
        start: match.index,
        end: match.index + match[0].length,
        placeholder,
      });
    }
  }
  return blocks;
}

export async function processChapterFigures(input: {
  course: Course;
  chapter: Chapter;
  content: string;
  overrides?: ModelOverrides;
}): Promise<FigureReplacementResult> {
  const blocks = parseFigurePlaceholders(input.content);
  if (blocks.length === 0) return { content: input.content, assets: [], skipped: [] };

  const mode: ImageGenerationMode = getUserImageModelConfig(input.overrides) ? "model" : "code";
  const chapterIndex = Math.max(0, input.course.chapters.findIndex((item) => item.id === input.chapter.id));
  const chapterNumber = chapterIndex + 1;
  const assets: FigureAsset[] = [];
  const skipped: FigureReplacementResult["skipped"] = [];
  let next = "";
  let last = 0;
  let figureNumber = 1;

  for (const block of blocks) {
    next += input.content.slice(last, block.start);
    const placeholder = block.placeholder;
    const label = `图 ${chapterNumber}.${figureNumber}`;
    const now = new Date().toISOString();
    try {
      const generated = mode === "model"
        ? await generateModelFigure(placeholder, input.overrides)
        : generateCodeFigure(placeholder, label);
      const stored = await saveIllustrationImage({
        courseId: input.course.id,
        chapterId: input.chapter.id,
        ...generated,
      });
      const asset: FigureAsset = {
        id: crypto.randomUUID(),
        courseId: input.course.id,
        chapterId: input.chapter.id,
        order: figureNumber,
        label,
        caption: normalizeCaption(placeholder.caption),
        prompt: placeholder.prompt,
        diagramSpec: placeholder.diagramSpec,
        textLabelsAllowed: placeholder.textLabelsAllowed,
        generationMode: mode,
        status: "ready",
        url: stored.url,
        storagePath: stored.storagePath,
        createdAt: now,
        updatedAt: now,
      };
      assets.push(asset);
      next += buildFigureMarkdown(asset);
      figureNumber += 1;
    } catch (error) {
      const reason = safeErrorMessage(error, `${mode} figure generation failed`);
      skipped.push({ caption: normalizeCaption(placeholder.caption), reason, mode });
      next += buildFigureFailureNote(placeholder, mode, reason);
    }
    last = block.end;
  }

  next += input.content.slice(last);
  return { content: next, assets, skipped };
}

export async function createTextbookMapFigure(course: Course, overrides?: ModelOverrides): Promise<FigureAsset> {
  const mode: ImageGenerationMode = getUserImageModelConfig(overrides) ? "model" : "code";
  const caption = "全书结构地图";
  const chapterNames = course.chapters.map((chapter, index) => `${index + 1}. ${chapter.title}`).join("；");
  const placeholder: FigurePlaceholder = {
    caption,
    prompt: `为《${course.textbookMeta?.title ?? course.topic}》绘制全书结构地图，展示章节之间的学习路径：${chapterNames}`,
    diagramSpec: chapterNames,
    textLabelsAllowed: true,
  };
  const generated = mode === "model"
    ? await generateModelFigure(placeholder, overrides)
    : generateCodeFigure(placeholder, "教材地图");
  const stored = await saveIllustrationImage({
    courseId: course.id,
    chapterId: "book-map",
    ...generated,
  });
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    courseId: course.id,
    chapterId: "book-map",
    order: 0,
    label: "教材地图",
    caption,
    prompt: placeholder.prompt,
    diagramSpec: placeholder.diagramSpec,
    textLabelsAllowed: true,
    generationMode: mode,
    status: "ready",
    url: stored.url,
    storagePath: stored.storagePath,
    createdAt: now,
    updatedAt: now,
  };
}

export async function regenerateChapterFigure(input: {
  course: Course;
  chapter: Chapter;
  label: string;
  order: number;
  placeholder: FigurePlaceholder;
  overrides?: ModelOverrides;
}): Promise<FigureAsset> {
  const mode: ImageGenerationMode = getUserImageModelConfig(input.overrides) ? "model" : "code";
  const generated = mode === "model"
    ? await generateModelFigure(input.placeholder, input.overrides)
    : generateCodeFigure(input.placeholder, input.label);
  const stored = await saveIllustrationImage({
    courseId: input.course.id,
    chapterId: input.chapter.id,
    ...generated,
  });
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    courseId: input.course.id,
    chapterId: input.chapter.id,
    order: input.order,
    label: input.label,
    caption: normalizeCaption(input.placeholder.caption),
    prompt: input.placeholder.prompt,
    diagramSpec: input.placeholder.diagramSpec,
    textLabelsAllowed: input.placeholder.textLabelsAllowed,
    generationMode: mode,
    status: "ready",
    url: stored.url,
    storagePath: stored.storagePath,
    createdAt: now,
    updatedAt: now,
  };
}

function parseFigureBlockBody(body: string): FigurePlaceholder | undefined {
  const trimmed = body.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("{")) {
    try {
      return normalizePlaceholder(JSON.parse(trimmed));
    } catch {
      // Fall through to key-value parsing.
    }
  }

  const record: Record<string, string | boolean> = {};
  for (const line of trimmed.split(/\r?\n/u)) {
    const match = line.match(/^\s*([a-zA-Z][\w-]*)\s*:\s*(.*?)\s*$/u);
    if (!match) continue;
    const key = normalizeKey(match[1] ?? "");
    const value = (match[2] ?? "").trim().replace(/^["']|["']$/gu, "");
    if (key === "textLabelsAllowed") record[key] = /^(true|yes|1|是|允许)$/iu.test(value);
    else record[key] = value;
  }
  return normalizePlaceholder(record);
}

function normalizePlaceholder(value: unknown): FigurePlaceholder | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const caption = readString(record.caption).slice(0, MAX_FIGURE_CAPTION);
  const prompt = readString(record.prompt);
  const diagramSpec = readString(record.diagramSpec);
  const textLabelsAllowed = typeof record.textLabelsAllowed === "boolean"
    ? record.textLabelsAllowed
    : undefined;
  if (!caption || !prompt) return undefined;
  return {
    caption,
    prompt,
    ...(diagramSpec ? { diagramSpec } : {}),
    ...(textLabelsAllowed !== undefined ? { textLabelsAllowed } : {}),
  };
}

function normalizeKey(key: string) {
  if (key === "diagram-spec" || key === "diagram_spec") return "diagramSpec";
  if (key === "text-labels-allowed" || key === "text_labels_allowed") return "textLabelsAllowed";
  return key;
}

async function generateModelFigure(placeholder: FigurePlaceholder, overrides?: ModelOverrides): Promise<GeneratedFigureImage> {
  const image = await generateIllustrationImage(
    [
      "Create a clean academic textbook illustration.",
      "White background, muted palette, precise layout, no marketing poster style, no watermark.",
      "Use short simplified-Chinese labels only when helpful; avoid long sentences inside the image.",
      `Caption: ${placeholder.caption}`,
      `Content intent: ${placeholder.prompt}`,
      placeholder.diagramSpec ? `Diagram specification: ${placeholder.diagramSpec}` : "",
    ].filter(Boolean).join("\n"),
    overrides,
  );
  return {
    ...image,
    ext: normalizeFigureExt(image.ext),
  };
}

function generateCodeFigure(placeholder: FigurePlaceholder, label: string): GeneratedFigureImage {
  const svg = renderCodeFigureSvg(placeholder, label);
  return {
    bytes: Buffer.from(svg, "utf8"),
    contentType: "image/svg+xml",
    ext: "svg" as const,
  };
}

function normalizeFigureExt(ext: string): GeneratedFigureImage["ext"] {
  return ext === "jpg" || ext === "webp" || ext === "svg" ? ext : "png";
}

function renderCodeFigureSvg(placeholder: FigurePlaceholder, label: string) {
  const width = 920;
  const height = 500;
  const title = normalizeCaption(placeholder.caption);
  const nodes = extractNodes(placeholder.diagramSpec || placeholder.prompt || title).slice(0, 5);
  const nodeCount = Math.max(3, nodes.length);
  const gap = 36;
  const nodeWidth = Math.floor((width - 120 - gap * (nodeCount - 1)) / nodeCount);
  const nodeHeight = 78;
  const y = 230;
  const startX = 60;
  const nodeItems = Array.from({ length: nodeCount }, (_, index) => {
    const text = nodes[index] ?? ["问题", "概念", "结论"][index] ?? `节点 ${index + 1}`;
    const x = startX + index * (nodeWidth + gap);
    return { x, y, text };
  });

  const arrows = nodeItems.slice(0, -1).map((node, index) => {
    const next = nodeItems[index + 1]!;
    const x1 = node.x + nodeWidth + 8;
    const x2 = next.x - 8;
    const ay = y + nodeHeight / 2;
    return `<line x1="${x1}" y1="${ay}" x2="${x2}" y2="${ay}" stroke="#a7b0ba" stroke-width="2.5" marker-end="url(#arrow)" />`;
  }).join("\n");

  const boxes = nodeItems.map((node, index) => {
    const fill = index === 0 ? "#fff8ea" : index === nodeItems.length - 1 ? "#eef7f4" : "#f7f8fa";
    const stroke = index === 0 ? "#d9a336" : index === nodeItems.length - 1 ? "#4b9a8f" : "#cfd6dd";
    return [
      `<rect x="${node.x}" y="${node.y}" width="${nodeWidth}" height="${nodeHeight}" rx="10" fill="${fill}" stroke="${stroke}" stroke-width="2" />`,
      wrapSvgText(node.text, node.x + nodeWidth / 2, node.y + 32, nodeWidth - 24, 18, "#1f2933"),
    ].join("\n");
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)}">
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#a7b0ba" />
    </marker>
  </defs>
  <rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff" />
  <rect x="24" y="24" width="${width - 48}" height="${height - 48}" rx="18" fill="#ffffff" stroke="#e1e6eb" />
  <text x="60" y="88" fill="#6b7582" font-size="18" font-family="Microsoft YaHei, Segoe UI, Arial">LearnByAI · 代码渲染图</text>
  ${wrapSvgText(title, width / 2, 132, width - 180, 28, "#151922", true)}
  ${arrows}
  ${boxes}
  <text x="${width / 2}" y="${height - 64}" text-anchor="middle" fill="#8a95a3" font-size="18" font-family="Microsoft YaHei, Segoe UI, Arial">${escapeXml(label)}　${escapeXml(title)}</text>
</svg>`;
}

function extractNodes(text: string) {
  return text
    .replace(/[`*_#>{}\[\]()]/gu, " ")
    .split(/[，。；;、,\n]|->|=>|→|-->/u)
    .map((item) => item.replace(/\s+/gu, " ").trim())
    .filter((item) => item.length >= 2)
    .map((item) => item.slice(0, 16));
}

function wrapSvgText(
  text: string,
  centerX: number,
  y: number,
  maxWidth: number,
  fontSize: number,
  fill: string,
  bold = false,
) {
  const charsPerLine = Math.max(4, Math.floor(maxWidth / fontSize));
  const lines: string[] = [];
  let current = "";
  for (const char of text) {
    if (current.length >= charsPerLine) {
      lines.push(current);
      current = char;
    } else {
      current += char;
    }
  }
  if (current) lines.push(current);
  const visible = lines.slice(0, 3);
  const startY = y - ((visible.length - 1) * fontSize * 0.65);
  return visible.map((line, index) =>
    `<text x="${centerX}" y="${startY + index * fontSize * 1.25}" text-anchor="middle" fill="${fill}" font-size="${fontSize}" font-weight="${bold ? 700 : 500}" font-family="Microsoft YaHei, Segoe UI, Arial">${escapeXml(line)}</text>`,
  ).join("\n");
}

function buildFigureMarkdown(asset: FigureAsset) {
  const caption = normalizeCaption(asset.caption);
  return `![${asset.label}　${caption}](${asset.url})\n\n*${asset.label}　${caption}*`;
}

/**
 * A failed figure leaves two things behind: a human-readable note (blockquote,
 * shown in the reader) and an invisible HTML-comment marker carrying the full
 * placeholder, so the retry endpoint can regenerate the exact same figure in
 * place. ReactMarkdown drops raw-HTML nodes, so the marker never renders.
 */
function buildFigureFailureNote(placeholder: FigurePlaceholder, mode: ImageGenerationMode, reason: string) {
  const modeLabel = mode === "model" ? "模型生图" : "代码渲染";
  const singleLineReason = reason.replace(/\s+/gu, " ").trim();
  const payload = JSON.stringify({
    caption: normalizeCaption(placeholder.caption),
    prompt: placeholder.prompt,
    ...(placeholder.diagramSpec ? { diagramSpec: placeholder.diagramSpec } : {}),
    ...(placeholder.textLabelsAllowed !== undefined ? { textLabelsAllowed: placeholder.textLabelsAllowed } : {}),
    mode,
  }).replace(/-->/gu, "--\\u003e");
  return [
    `> 图示暂未生成（${modeLabel}）：${normalizeCaption(placeholder.caption)}。${singleLineReason}`,
    `<!--learnbyai-figure-failed ${payload}-->`,
  ].join("\n");
}

/** Matches the failure marker pair (note + hidden payload comment). */
export function createFailedFigureMarkdownRe() {
  return /> 图示暂未生成[^\n]*\n<!--learnbyai-figure-failed (\{[^\n]*\})-->/gu;
}

export function parseFailedFigureMarker(payload: string): FigurePlaceholder | undefined {
  try {
    return normalizePlaceholder(JSON.parse(payload));
  } catch {
    return undefined;
  }
}

/**
 * Renumber every rendered figure in a chapter by document order (图 N.1, 图
 * N.2, …). Keeps numbering continuous after a failed figure is retried into
 * the middle of a chapter, and migrates legacy dash labels (图 N-K) from the
 * illustration beta to the dot convention as a side effect. Safe because the
 * writer never hard-codes figure numbers in prose (placeholders carry none).
 */
export function renumberChapterFigures(content: string, chapterNumber: number) {
  let counter = 0;
  return content.replace(createFigureMarkdownRe(), (_whole, _label, alt: string, url: string, captionText?: string) => {
    counter += 1;
    const newLabel = `图 ${chapterNumber}.${counter}`;
    const caption = (captionText ?? alt ?? "").trim();
    return `![${newLabel}　${caption}](${url})\n\n*${newLabel}　${caption}*`;
  });
}

function normalizeCaption(value: string) {
  return value.replace(/[\[\]\n]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, MAX_FIGURE_CAPTION);
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function escapeXml(value: string) {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}
