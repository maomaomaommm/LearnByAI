import { Chapter, Course } from "@/lib/types";
import { reviewerRubric, textbookSkill } from "./textbookSkill";

export function buildChapterReviewPrompt(course: Course, chapter: Chapter, content: string) {
  return `${textbookSkill()}

${reviewerRubric()}

# Task: Chapter Review

请审查下面这一章中文教材。只输出 JSON，不要输出 Markdown 或解释文字。

你不是评分机器，而是返修诊断员。请优先找会影响发布的真实问题：
- 章节编号或标题错配。
- Markdown 代码块、公式块、列表结构明显损坏。
- 独立公式没有使用 $$...$$。
- 本章提前展开后续章节概念，导致课程连续性失控。
- 内容明显浅、散、像博客，而不是教材。

JSON 结构：
{
  "passed": true,
  "issues": [
    {
      "severity": "low|medium|high",
      "category": "structure|continuity|math|style|depth",
      "message": "具体问题，说明位置或现象",
      "suggestion": "可执行的修复建议"
    }
  ],
  "summary": "总体评价"
}

判定标准：
- 只有影响阅读、导出或课程连续性的严重问题才标 high。
- 如果内容可读但有明显改进点，使用 medium 或 low。
- 不要因为个人风格偏好给 high。

课程主题：${course.topic}
课程目标：${course.goal}
章节标题：${chapter.title}
章节任务：${chapter.purpose ?? chapter.description}
与上一章关系：${chapter.connectionFromPrevious ?? ""}
为下一章铺垫：${chapter.setupForNext ?? ""}
章节契约：
${JSON.stringify(chapter.contract ?? {}, null, 2)}

Course Bible:
${JSON.stringify(course.courseBible, null, 2)}

待审查内容：
${content}`;
}
