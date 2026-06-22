import assert from "node:assert/strict";
import test from "node:test";
import { reapplyTextRevisionInCourse, revertTextRevisionInCourse, RevisionConflictError } from "../../src/lib/revisionApply";
import type { Chapter, Course } from "../../src/lib/types";

test("revision undo can restore the stored chapter snapshot when the exact applied span is gone", () => {
  const beforeChapter = makeChapter("old precise text");
  const currentChapter = makeChapter("content was overwritten before undo");
  const course = makeCourse(currentChapter);

  const { chapter } = revertTextRevisionInCourse(course, {
    chapterId: currentChapter.id,
    sectionId: "section-1",
    beforeText: "old precise text",
    afterText: "new precise text",
    beforeChapter,
    allowSnapshotFallback: true,
  });

  assert.equal(chapter.sections?.[0]?.content, "old precise text");
  assert.match(chapter.review ?? "", /已撤销该改写/u);
});

test("revision undo refuses snapshot fallback when a later active revision exists", () => {
  const beforeChapter = makeChapter("old precise text");
  const currentChapter = makeChapter("content was overwritten before undo");
  const course = makeCourse(currentChapter);

  assert.throws(
    () =>
      revertTextRevisionInCourse(course, {
        chapterId: currentChapter.id,
        sectionId: "section-1",
        beforeText: "old precise text",
        afterText: "new precise text",
        beforeChapter,
        allowSnapshotFallback: false,
      }),
    RevisionConflictError,
  );
});

test("revision undo is idempotent when the target already contains the original text", () => {
  const currentChapter = makeChapter("old precise text");
  const course = makeCourse(currentChapter);

  const { chapter } = revertTextRevisionInCourse(course, {
    chapterId: currentChapter.id,
    sectionId: "section-1",
    beforeText: "old precise text",
    afterText: "new precise text",
  });

  assert.equal(chapter.sections?.[0]?.content, "old precise text");
  assert.match(chapter.review ?? "", /已撤销该改写/u);
});

test("reapplies a reverted revision with the original before text", () => {
  const currentChapter = makeChapter("old precise text");
  const course = makeCourse(currentChapter);

  const { chapter } = reapplyTextRevisionInCourse(course, {
    chapterId: currentChapter.id,
    sectionId: "section-1",
    beforeText: "old precise text",
    afterText: "new precise text",
  });

  assert.equal(chapter.sections?.[0]?.content, "new precise text");
  assert.match(chapter.review ?? "", /已应用局部改写/u);
});

test("revision reapply can restore the stored after snapshot when the exact original span is gone", () => {
  const afterChapter = makeChapter("new precise text");
  const currentChapter = makeChapter("content changed before reapply");
  const course = makeCourse(currentChapter);

  const { chapter } = reapplyTextRevisionInCourse(course, {
    chapterId: currentChapter.id,
    sectionId: "section-1",
    beforeText: "old precise text",
    afterText: "new precise text",
    afterChapter,
    allowSnapshotFallback: true,
  });

  assert.equal(chapter.sections?.[0]?.content, "new precise text");
});

function makeChapter(sectionContent: string): Chapter {
  return {
    id: "chapter-1",
    title: "Chapter 1",
    status: "ready",
    depthWeight: "normal",
    sections: [
      {
        id: "section-1",
        chapterId: "chapter-1",
        title: "Section 1",
        order: 0,
        status: "ready",
        content: sectionContent,
      },
    ],
  };
}

function makeCourse(chapter: Chapter): Course {
  return {
    id: "course-1",
    topic: "Revision undo",
    goal: "Verify undo",
    background: "Unit test",
    styles: ["rigor"],
    learningMode: "standard",
    chapterCount: 1,
    difficulty: "intermediate",
    generationProfile: "fast",
    includeRecentResearch: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    chapters: [chapter],
  };
}
