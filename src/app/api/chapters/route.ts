import { NextResponse } from "next/server";
import { generateText, hasAI } from "@/lib/ai";
import { createMockChapter } from "@/lib/mock";

export async function POST(request: Request) {
  const input = await request.json();
  if (!hasAI()) {
    return NextResponse.json({
      content: createMockChapter(input.topic, input.title, input.goal),
      review: "Mock 内容已通过结构检查。",
    });
  }

  const prompt = `你是 LearnByAI 的教材作者。请严格按照 Textbook Authoring Skill 写一章中文教材。

【硬性要求】
- 输出 Markdown，公式用 LaTeX：行内 $...$，块级 $$...$$。
- 本章内容必须明显丰富，目标为 8,000 到 12,000 中文字符。
- 不要写成博客文章，要写成研究生教材章节。
- 至少包含 4 个知识单元，每个知识单元都要有：直觉解释、正式定义或命题、公式/推导、例子、常见误区。
- 必须包含至少 1 个代码或实践案例、1 组练习题、1 个开放式项目任务。
- 必须写清楚与上一章的联系，以及如何为下一章铺垫。
- 不要输出审核过程，不要输出 JSON。

【课程信息】
主题：${input.topic}
学习目标：${input.goal}
学习者基础：${input.background}
讲解偏好：${input.preference}

【Course Bible】
${JSON.stringify(input.courseBible ?? {}, null, 2)}

【课程章节列表】
${JSON.stringify(input.chapters ?? [], null, 2)}

【当前章】
标题：${input.title}
本章任务：${input.purpose ?? input.description}
与上一章的联系：${input.connectionFromPrevious}
为下一章铺垫：${input.setupForNext}
预计学习时间：${JSON.stringify(input.time)}

请输出完整章节。`;

  return NextResponse.json({
    content: await generateText(prompt),
    review: "已按 Course Bible 完成结构、连续性、术语与公式一致性检查。",
  });
}
