import assert from "node:assert/strict";
import { test } from "node:test";
import { buildChapterWriterPrompt, getChapterLengthGuide } from "../../src/lib/prompts/chapterWriter";
import { buildCoursePlannerPrompt } from "../../src/lib/prompts/coursePlanner";
import { Chapter, Course } from "../../src/lib/types";

test("course planner prompt asks for chapter contracts", () => {
  const prompt = buildCoursePlannerPrompt({
    topic: "信号处理",
    goal: "系统学习",
    background: "会基础数学",
    preference: "公式结合例题",
    weeklyHours: 6,
    chapterLength: "medium",
  });

  assert.match(prompt, /chapterContracts/u);
  assert.match(prompt, /章节契约/u);
  assert.doesNotMatch(prompt, /[�]/u);
});

test("chapter writer prompt includes length guide and contract", () => {
  const course = makeCourse("short");
  const chapter = course.chapters[0];
  const prompt = buildChapterWriterPrompt(course, chapter, { chapterIndex: 0, chapters: course.chapters });

  assert.match(prompt, /6,000 到 9,000/u);
  assert.match(prompt, /章节契约/u);
  assert.match(prompt, /forbiddenEarlyTopics/u);
  assert.equal(getChapterLengthGuide("long").maxTokens, 24576);
});

function makeCourse(chapterLength: Course["chapterLength"]): Course {
  const chapter: Chapter = {
    id: "chapter-1",
    title: "信号与系统基础",
    description: "建立基本概念",
    purpose: "理解信号、系统和卷积",
    connectionFromPrevious: "课程起点",
    setupForNext: "引出离散系统",
    contract: {
      chapterTitle: "信号与系统基础",
      requiredTopics: ["信号", "系统"],
      bridgeFromPrevious: "课程起点",
      bridgeToNext: "引出离散系统",
      forbiddenEarlyTopics: ["PLL"],
      requiredExamples: ["卷积例题"],
      requiredFormulas: ["卷积定义"],
      summaryForNext: "本章建立信号与系统的基础语言。",
    },
    time: {
      readingMinutes: 120,
      exerciseMinutes: 60,
      practiceMinutes: 60,
      extensionMinutes: 30,
    },
  };

  return {
    id: "course-1",
    topic: "信号处理",
    goal: "系统学习",
    background: "会基础数学",
    preference: "公式结合例题",
    weeklyHours: 6,
    chapterLength,
    profile: "测试课程",
    courseBible: {
      targetLearner: "测试学习者",
      finalOutcomes: ["掌握基础"],
      teachingStyle: "教材风格",
      prerequisites: [],
      globalNarrative: "从基础到应用",
      terminology: [],
      chapterDependencies: [],
      chapterContracts: [chapter.contract!],
    },
    chapters: [chapter],
    createdAt: new Date().toISOString(),
  };
}
