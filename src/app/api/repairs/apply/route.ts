import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/apiAuth";
import { safeErrorMessage } from "@/lib/safeError";
import { getServerCourse, saveServerCourse } from "@/lib/serverStore";
import { Chapter, Course, Section } from "@/lib/types";

export async function POST(request: Request) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  try {
    const input = await request.json();
    const courseId = String(input.courseId ?? "");
    const chapterId = String(input.chapterId ?? "");
    const sectionId = input.sectionId ? String(input.sectionId) : undefined;
    const beforeText = String(input.beforeText ?? "");
    const afterText = String(input.afterText ?? "");

    if (!courseId || !chapterId || !beforeText || !afterText) {
      return NextResponse.json(
        { error: "courseId, chapterId, beforeText, and afterText are required." },
        { status: 400 },
      );
    }
    if (beforeText === afterText) {
      return NextResponse.json({ error: "Repair does not change the selected text." }, { status: 400 });
    }

    const course = await getServerCourse(courseId, request);
    if (!course) return NextResponse.json({ error: "Course not found" }, { status: 404 });

    const patched = applyRepairToCourse(course, {
      chapterId,
      sectionId,
      beforeText,
      afterText,
    });
    const savedCourse = await saveServerCourse(patched, request);
    const chapter = savedCourse.chapters.find((item) => item.id === chapterId);

    return NextResponse.json({
      course: savedCourse,
      chapter,
      applied: true,
    });
  } catch (error) {
    return NextResponse.json(
      { error: safeErrorMessage(error, "Apply repair failed.") },
      { status: error instanceof RepairConflictError ? 409 : 500 },
    );
  }
}

function applyRepairToCourse(
  course: Course,
  repair: { chapterId: string; sectionId?: string; beforeText: string; afterText: string },
) {
  const chapters = course.chapters.map((chapter) => {
    if (chapter.id !== repair.chapterId) return chapter;
    return applyRepairToChapter(chapter, repair);
  });

  if (chapters.every((chapter, index) => chapter === course.chapters[index])) {
    throw new RepairConflictError("Chapter not found");
  }

  return {
    ...course,
    chapters,
    updatedAt: new Date().toISOString(),
  };
}

function applyRepairToChapter(
  chapter: Chapter,
  repair: { sectionId?: string; beforeText: string; afterText: string },
) {
  if (repair.sectionId) {
    const sections = chapter.sections?.map((section) =>
      section.id === repair.sectionId ? applyRepairToSection(section, repair) : section,
    );
    if (!sections || sections.every((section, index) => section === chapter.sections?.[index])) {
      throw new RepairConflictError("Section not found");
    }
    return {
      ...chapter,
      sections,
      content: replaceIfPresent(chapter.content, repair.beforeText, repair.afterText),
      review: "已根据用户确认应用局部修复，建议后续重新质检本章。",
      status: chapter.status === "ready" ? "draft_ready" as const : chapter.status,
      qualityReport: undefined,
    };
  }

  if (chapter.content) {
    return {
      ...chapter,
      content: replaceExactlyOnce(chapter.content, repair.beforeText, repair.afterText),
      review: "已根据用户确认应用局部修复，建议后续重新质检本章。",
      status: chapter.status === "ready" ? "draft_ready" as const : chapter.status,
      qualityReport: undefined,
    };
  }

  const sections = replaceInSections(chapter.sections ?? [], repair.beforeText, repair.afterText);
  return {
    ...chapter,
    sections,
    review: "已根据用户确认应用局部修复，建议后续重新质检本章。",
    status: chapter.status === "ready" ? "draft_ready" as const : chapter.status,
    qualityReport: undefined,
  };
}

function applyRepairToSection(
  section: Section,
  repair: { beforeText: string; afterText: string },
) {
  return {
    ...section,
    content: replaceExactlyOnce(section.content, repair.beforeText, repair.afterText),
    status: section.status === "ready" ? "draft_ready" as const : section.status,
    qualityReport: undefined,
  };
}

function replaceInSections(sections: Section[], beforeText: string, afterText: string) {
  let replacements = 0;
  const patched = sections.map((section) => {
    const count = countOccurrences(section.content, beforeText);
    replacements += count;
    return count === 1
      ? {
          ...section,
          content: section.content.replace(beforeText, afterText),
          status: section.status === "ready" ? "draft_ready" as const : section.status,
          qualityReport: undefined,
        }
      : section;
  });
  if (replacements !== 1) {
    throw new RepairConflictError(
      replacements === 0
        ? "Selected text no longer matches the current chapter content."
        : "Selected text appears multiple times. Please select a smaller unique span.",
    );
  }
  return patched;
}

function replaceExactlyOnce(text: string, beforeText: string, afterText: string) {
  const count = countOccurrences(text, beforeText);
  if (count !== 1) {
    throw new RepairConflictError(
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
    throw new RepairConflictError("Selected text appears multiple times. Please select a smaller unique span.");
  }
  return text.replace(beforeText, afterText);
}

function countOccurrences(text: string, search: string) {
  if (!search) return 0;
  return text.split(search).length - 1;
}

class RepairConflictError extends Error {}
