import { Chapter, Course } from "@/lib/types";
import { reviewerRubric, textbookSkill } from "./textbookSkill";

export function buildChapterReviewPrompt(course: Course, chapter: Chapter, content: string) {
  return `${textbookSkill()}

${reviewerRubric()}

# Task: Chapter Review

请审查下面这一章教材。只输出 JSON。

JSON 结构：
{
  "passed": true,
  "issues": [
    {
      "severity": "low|medium|high",
      "category": "structure|continuity|math|style|depth",
      "message": "具体问题",
      "suggestion": "如何修改"
    }
  ],
  "summary": "总体评价"
}

课程主题：${course.topic}
课程目标：${course.goal}
章节标题：${chapter.title}
章节任务：${chapter.purpose ?? chapter.description}
与上一章的联系：${chapter.connectionFromPrevious ?? ""}
为下一章铺垫：${chapter.setupForNext ?? ""}

Course Bible:
${JSON.stringify(course.courseBible, null, 2)}

待审查内容：
${content}`;
}
