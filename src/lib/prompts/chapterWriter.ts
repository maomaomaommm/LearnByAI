import { Chapter, Course } from "@/lib/types";
import { textbookSkill } from "./textbookSkill";

export function buildChapterWriterPrompt(
  course: Course,
  chapter: Chapter,
  options?: {
    chapterIndex?: number;
    chapters?: Omit<Chapter, "content" | "review">[];
  },
) {
  const chapterIndex =
    options?.chapterIndex ?? course.chapters.findIndex((item) => item.id === chapter.id);
  const chapters = options?.chapters ?? course.chapters;
  const previous = chapterIndex > 0 ? chapters[chapterIndex - 1] : undefined;
  const next = chapterIndex >= 0 ? chapters[chapterIndex + 1] : undefined;

  return `${textbookSkill()}

# Task: Chapter Writing

请严格按照 Textbook Authoring Skill 写一章中文教材。

【硬性要求】
- 输出 Markdown。
- 本章内容必须明显丰富，目标为 16,000 到 24,000 中文字符。不要只写概述，要展开定义、推导、例题、讨论、代码案例和习题。
- 不要写成博客文章，要写成研究生教材章节。
- 使用传统教材体例：章节导言、自然命名的小节、定义/命题/例/证明/讨论、章末小结和习题。
- 禁止使用“知识单元”“模块”“为什么需要它”“直觉解释”“检查理解的小题”等机械模板标题。
- 至少包含 6 到 8 个自然命名的主题小节，每个小节都要有充分解释、必要定义或命题、公式/推导、例子和讨论。
- 必须包含至少 1 个代码或实践案例、1 组练习题、1 个开放式项目任务。
- 必须自然写清楚与上一章的联系，以及如何为下一章铺垫，但不要使用“与上一章的连接”“下一章预告”这类机械标题。
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
