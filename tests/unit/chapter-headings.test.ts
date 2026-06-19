import assert from "node:assert/strict";
import test from "node:test";
import { expectedChapterHeading, normalizeChapterMarkdownHeading } from "../../src/lib/chapterHeadings";
import { Chapter, Course } from "../../src/lib/types";

test("chapter heading uses the real course order", () => {
  const course = courseWithChapters(["信号与系统基础复习", "数字信号处理基础", "PLL技术原理与应用"]);
  const chapter = course.chapters[1];

  assert.equal(expectedChapterHeading(course, chapter), "第二章：数字信号处理基础");
  assert.equal(
    normalizeChapterMarkdownHeading(course, chapter, "# 第四章 数字信号处理基础\n\n正文"),
    "# 第二章：数字信号处理基础\n\n正文",
  );
});

test("chapter heading strips existing ordinal from planned title", () => {
  const course = courseWithChapters(["第一章：信号与系统基础", "第2章：数字信号处理基础"]);
  const chapter = course.chapters[1];

  assert.equal(expectedChapterHeading(course, chapter), "第二章：数字信号处理基础");
});

function courseWithChapters(titles: string[]): Course {
  return {
    id: "course-1",
    topic: "topic",
    goal: "goal",
    background: "background",
    preference: "preference",
    weeklyHours: 6,
    profile: "profile",
    courseBible: {
      targetLearner: "learner",
      finalOutcomes: [],
      teachingStyle: "style",
      prerequisites: [],
      globalNarrative: "narrative",
      terminology: [],
      chapterDependencies: [],
    },
    chapters: titles.map((title, index) => chapter(title, index)),
    createdAt: new Date(0).toISOString(),
  };
}

function chapter(title: string, index: number): Chapter {
  return {
    id: `chapter-${index}`,
    title,
    description: title,
    time: {
      readingMinutes: 30,
      exerciseMinutes: 10,
      practiceMinutes: 10,
      extensionMinutes: 10,
    },
  };
}
