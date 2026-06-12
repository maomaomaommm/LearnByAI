import { textbookSkill } from "./textbookSkill";

export type AnnotationTutorInput = {
  topic: string;
  selectedText: string;
  question: string;
  history: { role: string; content: string }[];
  context?: {
    goal?: string;
    learnerProfile?: string;
    teachingStyle?: string;
    chapterTitle?: string;
    chapterDescription?: string;
    chapterPurpose?: string;
    previousChapterTitle?: string;
    nextChapterTitle?: string;
    chapterSummary?: string;
    terminology?: { term: string; definition: string }[];
  };
};

export function buildAnnotationTutorPrompt(input: AnnotationTutorInput) {
  const history = input.history
    .map((item) => `${item.role}: ${item.content}`)
    .join("\n");
  const context = formatTutorContext(input);

  return `${textbookSkill()}

# Task: Anchored Tutoring

你是一位耐心、严谨的私人教师。用户正在阅读教材，并针对选中的原文提问。

课程主题：${input.topic}

${context}

选中的原文：
${input.selectedText}

此前讨论：
${history}

用户问题：${input.question}

回答要求：
- 直接回答当前问题。
- 使用 Markdown。
- 公式使用 LaTeX：行内 $...$，块级 $$...$$。
- 复杂公式、cases、矩阵和多行推导必须使用独立块级公式，前后留空行。
- 禁止把正文或下一段文字放在 $$...$$ 同一行。
- 如果需要代码，使用带语言名的 fenced code block。
- 如果用户质疑正确性，请明确判断依据、适用条件和不确定性。
- 不要修改教材正文，只解释当前选中内容。
- 优先结合课程目标、学习者画像、本章位置和前后章节承接来解释。
- 如果问题超出选中内容，先说明超出范围，再给出和当前课程有关的最小必要背景。
- 回答结构建议：先给结论，再给解释；必要时补一个小例子或检查问题。
- 语言保持克制、具体、专业，不要使用营销式或鸡汤式表达。`;
}

function formatTutorContext(input: AnnotationTutorInput) {
  const context = input.context;
  if (!context) return "";

  const terminology = context.terminology?.length
    ? context.terminology.map((item) => `- ${item.term}: ${item.definition}`).join("\n")
    : "";

  return `课程上下文：
- 学习目标：${context.goal || "未提供"}
- 学习者画像：${context.learnerProfile || "未提供"}
- 教学风格：${context.teachingStyle || "未提供"}
- 当前章节：${context.chapterTitle || "未提供"}
- 章节说明：${context.chapterDescription || "未提供"}
- 本章目的：${context.chapterPurpose || "未提供"}
- 上一章：${context.previousChapterTitle || "无"}
- 下一章：${context.nextChapterTitle || "无"}

本章内容摘要：
${context.chapterSummary || "未提供"}

相关术语：
${terminology || "未提供"}`;
}
