import { tutorSkill } from "./textbookSkill";

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

  const ctx = input.context;
  const contextSection = ctx
    ? [
        ctx.learnerProfile ? `学习者画像：${ctx.learnerProfile}` : "",
        ctx.goal ? `课程目标：${ctx.goal}` : "",
        ctx.teachingStyle ? `教学风格：${ctx.teachingStyle}` : "",
        ctx.chapterTitle ? `当前章节：${ctx.chapterTitle}` : "",
        ctx.chapterPurpose ? `章节任务：${ctx.chapterPurpose}` : "",
        ctx.chapterDescription ? `章节摘要：${ctx.chapterDescription}` : "",
        ctx.previousChapterTitle ? `上一章：${ctx.previousChapterTitle}` : "",
        ctx.nextChapterTitle ? `下一章：${ctx.nextChapterTitle}` : "",
        ctx.chapterSummary ? `本章已讲内容概要：${ctx.chapterSummary}` : "",
        ctx.terminology?.length
          ? `课程术语表：\n${ctx.terminology.map((t) => `- ${t.term}: ${t.definition}`).join("\n")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  return `${tutorSkill()}

# Task: Anchored Tutoring

用户正在阅读教材，并针对选中的原文向你提问。

${contextSection ? `## 课程与章节上下文\n${contextSection}\n` : ""}
课程主题：${input.topic}

选中的原文：
${input.selectedText}

此前讨论：
${history}

用户问题：${input.question}

回答要求：
- 直接回答当前问题。
- 使用 Markdown。
- 如果用户质疑正确性，请明确判断依据、适用条件和不确定性。
- 不要修改教材正文，只解释当前选中内容。
- 如果问题涉及教材中尚未讲到的前置知识，先给出必要的临时解释，再回答核心问题。
- 使用术语表中的标准术语；如果必须引入新术语，给出临时定义。`;
}
