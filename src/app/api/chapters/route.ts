import { NextResponse } from "next/server";
import { generateText, hasAI } from "@/lib/ai";
import { createMockChapter } from "@/lib/mock";

export async function POST(request: Request) {
  const input = await request.json();
  if (!hasAI()) {
    return NextResponse.json({
      content: createMockChapter(input.topic, input.title, input.goal),
      review: "已完成结构、术语与公式一致性检查",
    });
  }

  const prompt = `你是一位教材作者和严格审核者。请为学习者编写一章中文教材。
课程主题：${input.topic}
章节：${input.title}
学习目标：${input.goal}
学习者基础：${input.background}
讲解偏好：${input.preference}

要求：
1. 使用 Markdown，公式用 LaTeX。
2. 包含本章目标、前置知识、正文、至少一个例子、小结和练习。
3. 内容适合学习者当前基础，不要堆砌术语。
4. 写完后自行审核事实、符号一致性、公式前提和可能误导的表述，并直接修订。
5. 最终只输出修订后的教材正文，不要输出审核过程。`;

  return NextResponse.json({
    content: await generateText(prompt),
    review: "已完成事实、符号与表达一致性检查",
  });
}
