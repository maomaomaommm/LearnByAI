import { runChapterQualityPipeline } from "./quality/pipeline";
import { Chapter, Course, Section } from "./types";

export class RevisionConflictError extends Error {}

function countOccurrences(text: string, search: string) {
  if (!search) return 0;
  return text.split(search).length - 1;
}

function replaceExactlyOnce(text: string, beforeText: string, afterText: string) {
  const count = countOccurrences(text, beforeText);
  if (count !== 1) {
    throw new RevisionConflictError(
      count === 0
        ? "Selected text no longer matches the current content."
        : "Selected text appears multiple times. Please select a smaller unique span.",
    );
  }
  return text.replace(beforeText, afterText);
}

function replaceIfPresent(text: string | undefined, beforeText: string, afterText: string) {
  if (!text) return text;
  const count = countOccurrences(text, beforeText);
  if (count === 0) return text;
  if (count > 1) {
    throw new RevisionConflictError("Selected text appears multiple times. Please select a smaller unique span.");
  }
  return text.replace(beforeText, afterText);
}

function chapterBody(chapter: Chapter) {
  return chapter.content ?? chapter.sections?.map((section) => section.content).join("\n\n") ?? "";
}

type RevisionAction = "apply" | "revert";

function reviewText(action: RevisionAction, passed: boolean): string {
  const verb = action === "revert" ? "已撤销该改写" : "已应用局部改写";
  return passed ? `${verb}并通过重新质检。` : `${verb}，但重新质检未通过，请检查。`;
}

/**
 * Re-run the deterministic TQH checks on the patched chapter and fold the result
 * into chapter.status/qualityReport, with a review line that reflects both the
 * action (apply/revert) and the actual outcome. Revision status is tracked separately.
 */
function rechecked(chapter: Chapter, action: RevisionAction): Chapter {
  const report = runChapterQualityPipeline(chapter, chapterBody(chapter));
  return {
    ...chapter,
    qualityReport: report,
    status: report.status === "failed" ? "quality_failed" : "ready",
    review: reviewText(action, report.status !== "failed"),
  };
}

function patchChapterText(
  chapter: Chapter,
  sectionId: string | undefined,
  beforeText: string,
  afterText: string,
  action: RevisionAction,
): Chapter {
  if (sectionId) {
    const sections = chapter.sections ?? [];
    let replacements = 0;
    const nextSections: Section[] = sections.map((section) => {
      if (section.id !== sectionId) return section;
      const count = countOccurrences(section.content, beforeText);
      replacements += count;
      return count === 1 ? { ...section, content: section.content.replace(beforeText, afterText) } : section;
    });
    if (replacements !== 1) {
      throw new RevisionConflictError(
        replacements === 0
          ? "Selected text no longer matches the current section content."
          : "Selected text appears multiple times. Please select a smaller unique span.",
      );
    }
    return rechecked({
      ...chapter,
      sections: nextSections,
      content: replaceIfPresent(chapter.content, beforeText, afterText),
    }, action);
  }

  if (chapter.content) {
    return rechecked({ ...chapter, content: replaceExactlyOnce(chapter.content, beforeText, afterText) }, action);
  }

  // No chapter.content and no sectionId: try to find the unique section that contains the text.
  const sections = chapter.sections ?? [];
  let replacements = 0;
  const nextSections = sections.map((section) => {
    const count = countOccurrences(section.content, beforeText);
    replacements += count;
    return count === 1 ? { ...section, content: section.content.replace(beforeText, afterText) } : section;
  });
  if (replacements !== 1) {
    throw new RevisionConflictError(
      replacements === 0
        ? "Selected text no longer matches the current chapter content."
        : "Selected text appears multiple times. Please select a smaller unique span.",
    );
  }
  return rechecked({ ...chapter, sections: nextSections }, action);
}

function mapChapter(course: Course, chapterId: string, fn: (chapter: Chapter) => Chapter) {
  let touched: Chapter | undefined;
  const chapters = course.chapters.map((chapter) => {
    if (chapter.id !== chapterId) return chapter;
    touched = fn(chapter);
    return touched;
  });
  if (!touched) throw new RevisionConflictError("Chapter not found");
  return { course: { ...course, chapters, updatedAt: new Date().toISOString() }, chapter: touched };
}

export function applyTextRevisionToCourse(
  course: Course,
  args: { chapterId: string; sectionId?: string; beforeText: string; afterText: string },
) {
  return mapChapter(course, args.chapterId, (chapter) =>
    patchChapterText(chapter, args.sectionId, args.beforeText, args.afterText, "apply"),
  );
}

/** Local-scope revert: swap afterText back to beforeText, re-check, and label as a revert. */
export function revertTextRevisionInCourse(
  course: Course,
  args: { chapterId: string; sectionId?: string; beforeText: string; afterText: string },
) {
  return mapChapter(course, args.chapterId, (chapter) =>
    patchChapterText(chapter, args.sectionId, args.afterText, args.beforeText, "revert"),
  );
}

/** Chapter-scope revert: restore the whole chapter snapshot verbatim. */
export function restoreChapterSnapshot(course: Course, beforeChapter: Chapter) {
  return mapChapter(course, beforeChapter.id, () => ({ ...beforeChapter }));
}
