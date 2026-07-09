import { Chapter, ContentMode, Course, ExplanationStyle, LearningMode } from "./types";

const EXPLANATION_STYLES: readonly ExplanationStyle[] = ["intuition", "example", "rigor", "analogy", "code"];
const LEARNING_MODES: readonly LearningMode[] = ["standard", "project", "exercise", "case"];
const CONTENT_MODES: readonly ContentMode[] = ["lecture", "textbook"];

/** 过滤为合法 ExplanationStyle 数组（去重 + 规范顺序），非数组/非法值丢弃。 */
export function normalizeStyles(raw: unknown): ExplanationStyle[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<ExplanationStyle>();
  for (const value of raw) {
    if (typeof value === "string" && (EXPLANATION_STYLES as readonly string[]).includes(value)) {
      seen.add(value as ExplanationStyle);
    }
  }
  return EXPLANATION_STYLES.filter((style) => seen.has(style));
}

/** 白名单校验 LearningMode，非法/缺失回退 standard。 */
export function normalizeLearningMode(raw: unknown): LearningMode {
  return typeof raw === "string" && (LEARNING_MODES as readonly string[]).includes(raw)
    ? (raw as LearningMode)
    : "standard";
}

export function normalizeContentMode(raw: unknown): ContentMode {
  return typeof raw === "string" && (CONTENT_MODES as readonly string[]).includes(raw)
    ? (raw as ContentMode)
    : "lecture";
}

/**
 * Backward-compatible normalization for courses read from persistence.
 *
 * Courses/chapters are stored as a single `payload` JSON blob, so legacy rows
 * predating the personalization rework still carry the old shape
 * (`weeklyHours`, `chapterLength`, `generationProfile: "standard"`) and lack the
 * new fields (`chapterCount`, `difficulty`, `depthWeight`, ...). Every read path
 * must funnel through here so downstream code can rely on the current `Course`
 * type without guarding for missing fields.
 */
export function normalizeCourse(raw: Course): Course {
  // Legacy keys (weeklyHours/chapterLength) are intentionally left untouched on
  // the object; they are simply ignored by current code. Only normalize the
  // fields the current type guarantees.
  const chapters = Array.isArray(raw.chapters) ? raw.chapters.map(normalizeChapter) : [];
  const rawCount = typeof raw.chapterCount === "number" && raw.chapterCount > 0 ? raw.chapterCount : undefined;

  return {
    ...raw,
    contentMode: normalizeContentMode(raw.contentMode),
    styles: normalizeStyles(raw.styles),
    learningMode: normalizeLearningMode(raw.learningMode),
    chapterCount: rawCount ?? (chapters.length || 8),
    difficulty: raw.difficulty ?? "intermediate",
    // Anything that is not the new "deep" profile (incl. legacy "standard" and
    // undefined) collapses to "fast".
    generationProfile: raw.generationProfile === "deep" ? "deep" : "fast",
    includeRecentResearch: raw.includeRecentResearch ?? false,
    chapters,
  };
}

function normalizeChapter(chapter: Chapter): Chapter {
  return {
    ...chapter,
    depthWeight: chapter.depthWeight ?? "normal",
  };
}
