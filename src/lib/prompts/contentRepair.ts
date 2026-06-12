import { Course } from "../types";
import { textbookSkill } from "./textbookSkill";

export type ContentRepairPromptInput = {
  course: Course;
  chapterId: string;
  sectionId?: string;
  selectedText: string;
  userMessage: string;
};

export function buildContentRepairPrompt(input: ContentRepairPromptInput) {
  const chapterIndex = input.course.chapters.findIndex((chapter) => chapter.id === input.chapterId);
  const chapter = input.course.chapters[chapterIndex];
  const section = input.sectionId
    ? chapter?.sections?.find((item) => item.id === input.sectionId)
    : undefined;

  return `${textbookSkill()}

# Task: Local Textbook Repair

你是 LearnByAI 的教材修复助手。用户指出教材中的某一小段内容可能有问题。
你的任务不是重写整章，而是给出一个最小、可审查的局部修复建议。

课程主题：${input.course.topic}
课程目标：${input.course.goal}
学习者画像：${input.course.profile}
当前章节：${chapter?.title ?? "未知章节"}
章节说明：${chapter?.description ?? "未提供"}
当前小节：${section?.title ?? "未指定"}

用户指出的问题：
${input.userMessage}

需要检查/修复的原文：
${input.selectedText}

请只输出 JSON，不要输出 Markdown 代码块。JSON 必须符合：
{
  "issueType": "formula_rendering" | "markdown_format" | "conceptual_error" | "wording" | "other",
  "diagnosis": "一句到三句话说明问题",
  "beforeText": "必须逐字等于需要替换的原文",
  "afterText": "修复后的文本，尽量短，只改必要部分",
  "confidence": "low" | "medium" | "high"
}

修复要求：
- beforeText 必须完全等于上面的原文，不要改写。
- afterText 必须保留原意，只修复格式、公式、表述或明显错误。
- 如果是公式渲染问题，使用 Markdown/LaTeX：行内 $...$，块级 $$...$$。
- 复杂公式、cases、矩阵和多行推导必须用独立块级公式，前后留空行。
- 不要把正文放在 $$...$$ 同一行。
- 不要扩大修改范围，不要生成整段新教材。
- 如果无法确定，confidence 设为 low，并给出最保守的 afterText。`;
}
