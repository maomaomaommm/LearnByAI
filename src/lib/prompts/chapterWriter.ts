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
- 本章内容必须明显丰富，目标为 8,000 到 12,000 中文字符。
- 不要写成博客文章，要写成研究生教材章节。
- 至少包含 4 个知识单元。
- 每个知识单元都要有：为什么需要它、直觉解释、正式定义或命题、公式/推导、例子、常见误区、检查理解的小题。
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
