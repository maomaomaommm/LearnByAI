import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildChapterWriterPrompt, getChapterDepthGuide } from "../../src/lib/prompts/chapterWriter";
import {
  buildChapterContractPrompt,
  buildCourseBiblePrompt,
  buildCoursePlannerPrompt,
  buildCourseSkeletonPrompt,
  buildCourseSkeletonCompactPrompt,
} from "../../src/lib/prompts/coursePlanner";
import type { CourseSkeleton } from "../../src/lib/prompts/coursePlanner";
import { reviewerRubric } from "../../src/lib/prompts/textbookSkill";
import { Chapter, Course } from "../../src/lib/types";

test("course planner prompt asks for chapter contracts", () => {
  const prompt = buildCoursePlannerPrompt({
    topic: "信号处理",
    goal: "系统学习",
    background: "会基础数学",
    preference: "公式结合例题",
    chapterCount: 8,
    difficulty: "intermediate",
  });

  assert.match(prompt, /chapterContracts/u);
  assert.match(prompt, /章节契约/u);
  assert.doesNotMatch(prompt, /[�]/u);
});

test("course skeleton prompt injects chapter count, difficulty and per-chapter depth", () => {
  const prompt = buildCourseSkeletonPrompt({
    topic: "深度学习",
    goal: "系统学习",
    background: "会 Python",
    preference: "公式结合例题",
    chapterCount: 14,
    difficulty: "research",
  });

  assert.match(prompt, /严格生成 14 章/u);
  assert.match(prompt, /研究前沿/u);
  assert.match(prompt, /"depth"/u);
  assert.match(prompt, /core/u);
  assert.doesNotMatch(prompt, /每周学习/u);
  assert.doesNotMatch(prompt, /章节篇幅/u);
});

test("chapter writer prompt uses per-chapter depthWeight for adaptive length", () => {
  const lightPrompt = buildChapterWriterPrompt(makeCourse("light"), makeCourse("light").chapters[0], { chapterIndex: 0 });
  const corePrompt = buildChapterWriterPrompt(makeCourse("core"), makeCourse("core").chapters[0], { chapterIndex: 0 });

  // depth standard (qualitative) + a soft prose-only band (excludes code/exercises)
  assert.match(corePrompt, /把难点彻底讲透/u);
  assert.match(lightPrompt, /点到为止/u);
  assert.match(corePrompt, /正文讲解文字大致 12,000 到 16,000 字/u);
  assert.match(corePrompt, /仅指正文讲解文字，不含代码、块公式、练习、拓展/u);
  assert.match(corePrompt, /章节契约/u);
  assert.match(corePrompt, /forbiddenEarlyTopics/u);
  // content scope is the primary lever; core requires more than light
  assert.match(corePrompt, /至少 3 个完整的 worked example/u);
  assert.match(lightPrompt, /留到后续核心章/u);
  // code/formulas must be explained, not used to pad length
  assert.match(corePrompt, /不得用代码或公式堆砌/u);

  // depthWeight -> maxTokens safety net (generous; never used to cap normal length)
  assert.equal(getChapterDepthGuide("light").maxTokens, 12288);
  assert.equal(getChapterDepthGuide("normal").maxTokens, 18432);
  assert.equal(getChapterDepthGuide("core").maxTokens, 32000);
  assert.equal(getChapterDepthGuide(undefined).maxTokens, 18432);

  // generation profile must no longer leak into the writing prompt
  assert.doesNotMatch(corePrompt, /生成模式/u);
});

test("chapter prompts preserve frontier evidence and recency constraints", () => {
  const course = makeCourse("normal");
  course.chapters[0].contract!.requiredTopics = ["近期论文方法", "经典方法对比"];
  const prompt = buildChapterWriterPrompt(course, course.chapters[0], { chapterIndex: 0, chapters: course.chapters });
  const rubric = reviewerRubric();

  assert.match(prompt, /requiredTopics/u);
  assert.match(prompt, /近期论文/u);
  assert.match(prompt, /预印本、已录用论文和正式发表版本/u);
  assert.match(prompt, /不得把章节契约未提供来源线索/u);
  assert.match(rubric, /覆盖面与时效性/u);
  assert.match(rubric, /requiredTopics/u);
  assert.match(rubric, /课程规划阶段的联网检索证据/u);
  assert.match(rubric, /不得虚构论文、方法、录用状态或发布日期/u);
});

test("course planning prompts split bible core from per-chapter contracts", () => {
  const skeleton = makeSkeleton();
  const biblePrompt = buildCourseBiblePrompt({
    topic: "电力电子控制",
    goal: "系统学习控制方法",
    background: "具备电路基础",
    preference: "公式和案例结合",
    chapterCount: 8,
    difficulty: "intermediate",
  }, skeleton);
  const contractPrompt = buildChapterContractPrompt({
    topic: "电力电子控制",
    goal: "系统学习控制方法",
    background: "具备电路基础",
    preference: "公式和案例结合",
    chapterCount: 8,
    difficulty: "intermediate",
  }, skeleton, {
    targetLearner: "测试学习者",
    finalOutcomes: ["掌握闭环控制"],
    teachingStyle: "研究生教材",
    prerequisites: ["电路基础"],
    globalNarrative: "从建模到控制",
    terminology: [],
    chapterDependencies: [],
  }, 0);

  assert.match(biblePrompt, /不要输出 chapterContracts/u);
  assert.doesNotMatch(biblePrompt, /"chapterContracts":/u);
  assert.match(contractPrompt, /"contract"/u);
  assert.match(contractPrompt, /chapterTitle 必须逐字等于当前章节标题/u);
  assert.match(buildCourseSkeletonCompactPrompt({
    topic: "信号处理",
    goal: "系统学习",
    background: "会基础数学",
    preference: "公式结合例题",
    chapterCount: 8,
    difficulty: "intermediate",
  }, "bad JSON"), /紧凑模式/u);
});

test("course planning runtime keeps web research and JSON stages resilient", () => {
  const webResearchSource = readFileSync("src/lib/webResearch.ts", "utf8");
  const clientSource = readFileSync("src/lib/maol/client.ts", "utf8");

  assert.match(webResearchSource, /buildFallbackResearchQuery/u);
  assert.match(webResearchSource, /stream: false/u);
  assert.match(webResearchSource, /maxTokens: 512/u);
  assert.match(webResearchSource, /关键词提取失败，使用本地检索词继续/u);
  assert.match(clientSource, /dispatchParsedCoursePlannerStage/u);
  assert.match(clientSource, /输出无法解析或过长，正在使用紧凑模式重试/u);
  assert.match(clientSource, /runInBatches\(skeleton\.chapters,\s*2/u);
  assert.match(clientSource, /buildChapterContractPrompt/u);
  assert.match(clientSource, /buildChapterContractCompactPrompt/u);
});

function makeCourse(depthWeight: Chapter["depthWeight"]): Course {
  const chapter: Chapter = {
    id: "chapter-1",
    title: "信号与系统基础",
    description: "建立基本概念",
    purpose: "理解信号、系统和卷积",
    connectionFromPrevious: "课程起点",
    setupForNext: "引出离散系统",
    depthWeight,
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
    chapterCount: 8,
    difficulty: "intermediate",
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

function makeSkeleton(): CourseSkeleton {
  return {
    profile: "测试路线",
    chapters: [
      {
        title: "控制系统基础",
        description: "建立反馈控制概念",
        purpose: "理解闭环系统",
        connectionFromPrevious: "课程起点",
        setupForNext: "引出PI控制",
        time: {
          readingMinutes: 120,
          exerciseMinutes: 60,
          practiceMinutes: 60,
          extensionMinutes: 30,
        },
      },
      {
        title: "PI控制器设计",
        description: "学习PI调节器",
        purpose: "掌握参数设计",
        connectionFromPrevious: "承接反馈控制",
        setupForNext: "引出数字实现",
        time: {
          readingMinutes: 120,
          exerciseMinutes: 60,
          practiceMinutes: 60,
          extensionMinutes: 30,
        },
      },
    ],
  };
}
