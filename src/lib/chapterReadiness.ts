import type { Chapter, EntityStatus } from "./types";

export function hasChapterBody(chapter: Pick<Chapter, "content" | "sections">) {
  return Boolean(chapter.content || chapter.sections?.length);
}

export function effectiveChapterStatus(chapter: Chapter): EntityStatus {
  if (hasChapterBody(chapter)) {
    if (chapter.qualityReport?.status === "failed" || chapter.status === "quality_failed") return "quality_failed";
    if (chapter.status === "ready" || chapter.qualityReport?.status === "passed" || chapter.qualityReport?.status === "warning") return "ready";
    return "draft_ready";
  }
  return chapter.status ?? "pending";
}

export function isChapterReadable(chapter: Chapter) {
  const status = effectiveChapterStatus(chapter);
  return hasChapterBody(chapter) && (status === "draft_ready" || status === "ready" || status === "quality_failed");
}

export function isChapterAwaitingQuality(chapter: Chapter) {
  return hasChapterBody(chapter) && effectiveChapterStatus(chapter) === "draft_ready";
}
