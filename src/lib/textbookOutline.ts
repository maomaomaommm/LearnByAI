import type { TextbookMeta } from "./types";

/**
 * Shared normalization + validation for the textbook outline draft. Used by
 * both the outline PUT endpoint and the confirm endpoint so the two can never
 * drift apart on what a valid outline is.
 */

export const DEFAULT_TEXTBOOK_NUMBERING = {
  figurePrefix: "图",
  tablePrefix: "表",
  definitionPrefix: "定义",
  examplePrefix: "例",
  theoremPrefix: "定理",
  algorithmPrefix: "算法",
  equationStyle: "chapter",
} as const;

export function normalizeTextbookMeta(value: TextbookMeta | undefined): TextbookMeta {
  return {
    title: value?.title?.trim() || "未命名教材",
    subtitle: value?.subtitle?.trim(),
    language: "zh-CN",
    outlineStatus: value?.outlineStatus ?? "ready",
    outline: value?.outline,
    textbookMap: value?.textbookMap,
    numbering: value?.numbering ?? { ...DEFAULT_TEXTBOOK_NUMBERING },
  };
}

/** Returns an empty string when valid, or a user-facing reason when not. */
export function validateTextbookMeta(meta: TextbookMeta) {
  const chapters = meta.outline?.chapters ?? [];
  if (chapters.length < 3 || chapters.length > 24) return "教材章节数必须在 3 到 24 之间。";
  if (!chapters[0] || chapters[0].fixedRole !== "introduction") return "第一章必须是固定的引言。";
  if (!chapters.at(-1) || chapters.at(-1)?.fixedRole !== "conclusion") return "最后一章必须是固定的总结与展望。";
  if (chapters.some((chapter) => !chapter.title.trim())) return "章节标题不能为空。";
  const middle = chapters.slice(1, -1);
  if (middle.some((chapter) => !chapter.sections.length)) return "中间章节至少需要一个小节。";
  if (middle.some((chapter) => chapter.sections.some((section) => !section.title.trim()))) return "小节标题不能为空。";
  return "";
}
