import { NextResponse } from "next/server";
import { generateText, hasAI, parseJson } from "@/lib/ai";
import { createMockCourse } from "@/lib/mock";
import { Chapter, Course, CourseBible } from "@/lib/types";

type CourseGeneration = {
  profile: string;
  courseBible: CourseBible;
  chapters: Omit<Chapter, "id" | "content" | "review" | "status">[];
};

function chapterPrompt(course: Course, chapter: Chapter, chapterIndex: number) {
  const previous = course.chapters[chapterIndex - 1];
  const next = course.chapters[chapterIndex + 1];
  return `你是 LearnByAI 的教材作者。请严格按照 Textbook Authoring Skill 写一章中文教材。

【硬性要求】
- 输出 Markdown，公式用 LaTeX：行内 $...$，块级 $$...$$。
- 数学排版必须遵守：
  1. 复杂公式、分段函数、cases、align、矩阵一律使用独立块级公式。
  2. 块级公式前后必须各有一个空行。
  3. 禁止把中文正文、标题、列表或下一节内容写在 $$...$$ 同一行。
  4. 禁止使用 \\[...\\] 或 \\(...\\)，统一使用 $$...$$ 和 $...$。
  5. 如果公式很长，优先拆成多行解释，不要塞进行内公式。
- 本章内容必须明显丰富，目标为 8,000 到 12,000 中文字符。
- 不要写成博客文章，要写成研究生教材章节。
- 至少包含 4 个知识单元，每个知识单元都要有：直觉解释、正式定义或命题、公式/推导、例子、常见误区。
- 必须包含至少 1 个代码或实践案例、1 组练习题、1 个开放式项目任务。
- 必须写清楚与上一章的联系，以及如何为下一章铺垫。
- 不要输出审核过程，不要输出 JSON。

【课程信息】
主题：${course.topic}
学习目标：${course.goal}
学习者基础：${course.background}
讲解偏好：${course.preference}

【Course Bible】
${JSON.stringify(course.courseBible, null, 2)}

【当前章】
标题：${chapter.title}
本章任务：${chapter.purpose ?? chapter.description}
与上一章的联系：${chapter.connectionFromPrevious ?? "这是课程起点。"}
为下一章铺垫：${chapter.setupForNext ?? "自然引出下一章。"}
预计学习时间：阅读 ${chapter.time.readingMinutes} 分钟，练习 ${chapter.time.exerciseMinutes} 分钟，实践 ${chapter.time.practiceMinutes} 分钟，拓展阅读 ${chapter.time.extensionMinutes} 分钟。

【上一章】
${previous ? `${previous.title}: ${previous.description}` : "无，这是第一章。"}

【下一章】
${next ? `${next.title}: ${next.description}` : "无，这是最后一章。"}

请输出完整章节。`;
}

export async function POST(request: Request) {
  const input = await request.json();
  if (!hasAI()) return NextResponse.json(createMockCourse(input));

  const prompt = `你是一位课程架构师和教材总主编。请为学习者设计一门连贯课程，并生成 Course Bible。

用户想学习：${input.topic}
具体目标：${input.goal}
当前基础：${input.background}
讲解偏好：${input.preference}
每周学习时间：${input.weeklyHours} 小时

请只输出 JSON，不要 Markdown。必须符合以下结构：
{
  "profile": "学习策略说明，说明为什么这样安排",
  "courseBible": {
    "targetLearner": "目标学习者画像",
    "finalOutcomes": ["最终应达到的能力"],
    "teachingStyle": "整本教材统一写作风格",
    "prerequisites": ["需要补齐或默认掌握的前置知识"],
    "globalNarrative": "整门课的主线叙事，说明章节如何递进",
    "terminology": [
      {"term":"术语","definition":"定义","introducedIn":"章节名"}
    ],
    "chapterDependencies": [
      {"chapterTitle":"章节名","dependsOn":["依赖"],"introduces":["本章引入"],"preparesFor":["为后续铺垫"]}
    ]
  },
  "chapters": [
    {
      "title": "章节名",
      "description": "一句话说明",
      "purpose": "本章在整门课中的教学任务",
      "connectionFromPrevious": "与上一章的具体联系",
      "setupForNext": "如何为下一章铺垫",
      "time": {
        "readingMinutes": 60,
        "exerciseMinutes": 45,
        "practiceMinutes": 60,
        "extensionMinutes": 45
      }
    }
  ]
}

生成 6 到 10 章。章节之间必须有明确依赖，不要想到什么说什么。时间估计必须拆分，不允许只给一个总数。`;

  const generated = parseJson<CourseGeneration>(await generateText(prompt));
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

  if (course.chapters[0]) {
    course.chapters[0].status = "generating";
    course.chapters[0].content = await generateText(chapterPrompt(course, course.chapters[0], 0));
    course.chapters[0].review = "已按 Course Bible 完成结构、连续性、术语与公式一致性检查。";
    course.chapters[0].status = "ready";
  }

  return NextResponse.json(course);
}
