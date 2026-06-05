import { NextResponse } from "next/server";
import { generateText, hasAI, parseJson } from "@/lib/ai";
import { createMockCourse } from "@/lib/mock";
import { buildCoursePlannerPrompt } from "@/lib/prompts/coursePlanner";
import { Chapter, Course, CourseBible } from "@/lib/types";

type CourseInput = {
  topic: string;
  goal: string;
  background: string;
  preference: string;
  weeklyHours: number;
};

type CourseGeneration = {
  profile: string;
  courseBible: CourseBible;
  chapters: Omit<Chapter, "id" | "content" | "review" | "status">[];
};

export async function POST(request: Request) {
  const input = (await request.json()) as CourseInput;
  if (!hasAI()) return NextResponse.json(createMockCourse(input));

  const generated = await planCourse(input);
  const course: Course = {
    id: crypto.randomUUID(),
    ...input,
    profile: generated.profile,
    courseBible: generated.courseBible,
    createdAt: new Date().toISOString(),
    chapters: generated.chapters.map((chapter) => ({
      ...chapter,
      id: crypto.randomUUID(),
      status: "pending",
    })),
  };

  return NextResponse.json(course);
}

async function planCourse(input: CourseInput) {
  try {
    return parseJson<CourseGeneration>(
      await generateText(buildCoursePlannerPrompt(input), {
        temperature: 0.25,
        maxTokens: 6144,
      }),
    );
  } catch {
    return buildFallbackCourseGeneration(input);
  }
}

function buildFallbackCourseGeneration(input: CourseInput): CourseGeneration {
  const titles = [
    `${input.topic}的问题意识与学习路线`,
    "概率、统计与建模前提",
    "核心概念与基本符号",
    "识别思想与主要方法",
    "估计、检验与不确定性",
    "论文阅读中的方法判断",
    "复现一个代表性案例",
    "方法改进与开放问题",
  ];

  const chapters = titles.map((title, index) => ({
    title,
    description: describeChapter(input.topic, index),
    purpose: describePurpose(input.topic, index),
    connectionFromPrevious:
      index === 0 ? "这是课程起点。" : `承接“${titles[index - 1]}”中建立的概念和问题。`,
    setupForNext:
      index === titles.length - 1
        ? "收束整门课程，并形成后续研究或项目方向。"
        : `为“${titles[index + 1]}”准备必要的概念、符号和判断标准。`,
    time: {
      readingMinutes: 150,
      exerciseMinutes: 90,
      practiceMinutes: 120,
      extensionMinutes: 60,
    },
  }));

  return {
    profile: `本课程面向具备“${input.background}”基础的学习者，目标是“${input.goal}”。课程会优先采用“${input.preference}”的讲解方式，并把概念、公式、代码和论文阅读连接起来。`,
    courseBible: {
      targetLearner: input.background,
      finalOutcomes: [
        input.goal,
        `能够用自己的话解释 ${input.topic} 的核心问题、常用方法和适用边界。`,
        "能够阅读相关论文中的方法部分，并判断假设、识别条件和实验设计是否合理。",
      ],
      teachingStyle: input.preference,
      prerequisites: ["概率统计基础", "基本编程能力", "阅读技术论文的耐心和习惯"],
      globalNarrative: `从问题意识出发，先补齐必要前提，再进入 ${input.topic} 的核心概念、方法、案例复现和方法改进。`,
      terminology: [
        {
          term: input.topic,
          definition: `本课程围绕“${input.topic}”建立系统的概念、方法和论文阅读能力。`,
          introducedIn: titles[0],
        },
      ],
      chapterDependencies: chapters.map((chapter, index) => ({
        chapterTitle: chapter.title,
        dependsOn: index === 0 ? [] : [titles[index - 1]],
        introduces: [chapter.title],
        preparesFor: index === titles.length - 1 ? [] : [titles[index + 1]],
      })),
    },
    chapters,
  };
}

function describeChapter(topic: string, index: number) {
  const descriptions = [
    `建立 ${topic} 的问题地图，说明为什么需要系统学习以及后续章节如何递进。`,
    "补齐后续定义、推导、代码案例和论文阅读所需的概率统计与建模语言。",
    `引入 ${topic} 中反复出现的核心术语、符号和基本对象。`,
    "讨论从问题到方法的核心识别思路，明确每种方法依赖的前提。",
    "把方法落到可计算的估计过程，并讨论误差、方差、稳健性和诊断。",
    "训练阅读论文方法部分的能力，判断作者的假设、数据和识别策略是否可信。",
    "通过一个完整案例把概念、公式、代码和解释串起来。",
    "总结已掌握的方法，并讨论如何提出小型改进或后续研究问题。",
  ];

  return descriptions[index] ?? `围绕 ${topic} 展开系统学习。`;
}

function describePurpose(topic: string, index: number) {
  const purposes = [
    `让学习者知道 ${topic} 解决什么问题，以及学习路线为什么这样安排。`,
    "让不同基础的学习者拥有共同的数学和编程起点。",
    "避免后续学习变成术语堆砌，先建立清晰符号系统。",
    "把直觉问题转化为可检验、可推导、可实现的方法条件。",
    "让学习者知道方法在真实数据中如何落地，以及结果如何解释。",
    "把教材知识迁移到论文阅读和方法批判中。",
    "形成一次从理论到实现再到解释的完整练习。",
    `帮助学习者从“理解 ${topic}”过渡到“尝试改进或应用方法”。`,
  ];

  return purposes[index] ?? `推进 ${topic} 的系统理解。`;
}
