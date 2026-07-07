import assert from "node:assert/strict";
import { test } from "node:test";
import { buildChapterWriterPrompt, getChapterLengthGuide } from "../../src/lib/prompts/chapterWriter";
import {
  buildCourseBiblePrompt,
  buildCoursePlannerPrompt,
  buildCourseSkeletonPrompt,
} from "../../src/lib/prompts/coursePlanner";
import { Chapter, Course } from "../../src/lib/types";

test("course planner prompt asks for chapter contracts", () => {
  const prompt = buildCoursePlannerPrompt({
    topic: "信号处理",
    goal: "系统学习",
    background: "会基础数学",
    preference: "公式结合例题",
    weeklyHours: 6,
    chapterLength: "medium",
    researchDate: "2026-06-16",
    researchBrief: "论文：Example Alignment，首次公开于 2026-05-01，来源：https://arxiv.org/abs/2605.00001",
    courseRequirements: "必须保留三段式目录：基础、方法、项目。",
    referenceMaterial: "参考资料：卷积定义和滤波案例。",
    styleSample: "风格样例：先讲直觉，再给公式。",
  });

  assert.match(prompt, /chapterContracts/u);
  assert.match(prompt, /章节契约/u);
  assert.match(prompt, /必须优先依据上方联网研究摘要/u);
  assert.match(prompt, /Example Alignment/u);
  assert.match(prompt, /用户上传的课程要求/u);
  assert.match(prompt, /必须保留三段式目录/u);
  assert.match(prompt, /不得照搬原文/u);
  assert.match(prompt, /写作风格样例/u);
  assert.doesNotMatch(prompt, /模型知识截止时间（约 2025 年 4 月）/u);
  assert.doesNotMatch(prompt, /[�]/u);
});

test("Kimi course planning is split into a short skeleton and a separate course bible", () => {
  const input = {
    topic: "大模型安全对齐",
    goal: "掌握最新方法",
    background: "了解 Transformer",
    preference: "论文结合实践",
    weeklyHours: 8,
    chapterLength: "medium" as const,
    researchDate: "2026-06-16",
    researchBrief: "近期论文摘要",
    courseRequirements: "课程必须包含一个最终红队项目。",
    referenceMaterial: "教材资料：偏好优化章节案例。",
    styleSample: "风格：问题驱动，少用口号。",
  };
  const skeletonPrompt = buildCourseSkeletonPrompt(input);
  const biblePrompt = buildCourseBiblePrompt(input, {
    profile: "从基础到前沿",
    chapters: [{
      title: "安全对齐基础",
      description: "建立基础",
      purpose: "理解问题",
      connectionFromPrevious: "课程起点",
      setupForNext: "引出偏好优化",
      time: {
        readingMinutes: 150,
        exerciseMinutes: 90,
        practiceMinutes: 120,
        extensionMinutes: 60,
      },
    }],
  });

  assert.doesNotMatch(skeletonPrompt, /chapterContracts/u);
  assert.match(skeletonPrompt, /最终红队项目/u);
  assert.match(biblePrompt, /chapterContracts/u);
  assert.match(biblePrompt, /偏好优化章节案例/u);
  assert.match(biblePrompt, /写作风格样例/u);
  assert.match(biblePrompt, /不要重复输出 chapters/u);
});

test("chapter writer prompt includes length guide and contract", () => {
  const course = makeCourse("short");
  const chapter = course.chapters[0];
  const prompt = buildChapterWriterPrompt(course, chapter, { chapterIndex: 0, chapters: course.chapters });

  assert.match(prompt, /6,000 到 9,000/u);
  assert.match(prompt, /章节契约/u);
  assert.match(prompt, /forbiddenEarlyTopics/u);
  assert.match(prompt, /课程要求 \/ 目录/u);
  assert.match(prompt, /必须使用频域案例/u);
  assert.match(prompt, /不得连续复述原文/u);
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
    courseRequirements: "必须使用频域案例，并在每章设置复盘问题。",
    referenceMaterial: "参考资料：滤波器教材使用低通滤波案例讲解频域直觉。",
    styleSample: "风格样例：每节先用一个问题开头，再给正式定义。",
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
