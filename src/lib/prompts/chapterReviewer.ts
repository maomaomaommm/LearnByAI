import { Chapter, Course } from "@/lib/types";
import { reviewerRubric, textbookSkill } from "./textbookSkill";

export function buildChapterReviewPrompt(course: Course, chapter: Chapter, content: string) {
  return `${textbookSkill()}

${reviewerRubric()}

# Task: Chapter Review

请审查下面这一章中文教材。只输出 JSON，不要输出 Markdown 或解释文字。

JSON 语法要求：
- 所有字符串值必须在同一行内，禁止直接换行。
- 字符串值内禁止使用未转义的反斜杠（\\）；如果必须保留反斜杠，请写成双反斜杠（\\\\）。
- 字符串值内禁止出现未闭合的引号。
- issue 的 message 和 suggestion 要简短，不要把整段代码或公式原样复制进 JSON。

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

export function buildChapterReviewJsonRepairPrompt(invalidText: string, parseError: string) {
  return `你是一名严格的 JSON 修复器。下面是章节质检模型输出的坏 JSON，它的语义可用，但语法无法被 JSON.parse 解析。

解析错误：
${parseError}

坏 JSON 原文：
${invalidText}

请只输出一个合法 JSON 对象，不要输出 Markdown、代码围栏、解释文字或前后缀。
JSON 必须符合：
{
  "passed": true,
  "issues": [
    {
      "severity": "low|medium|high",
      "category": "structure|continuity|math|style|depth",
      "message": "具体问题",
      "suggestion": "修复建议"
    }
  ],
  "summary": "总体评价"
}

修复规则：
- 保留原意，但删除无法安全转义的公式、Markdown 或代码细节。
- 所有字符串必须能被 JSON.parse 直接解析。
- 字符串内部不要使用未转义反斜杠；如果必须保留反斜杠，写成双反斜杠。
- 字符串内部不要直接换行。
- 如果没有可用问题，输出 {"passed":true,"issues":[],"summary":"REVIEWER JSON 已修复。"}。
现在输出修复后的 JSON。`;
}
