import { Chapter, Course } from "./types";

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
