import { NextResponse } from "next/server";
import { generateText, hasAI } from "@/lib/ai";
import { createMockAnswer } from "@/lib/mock";

export async function POST(request: Request) {
  const input = await request.json();
  if (!hasAI()) {
    return NextResponse.json({ answer: createMockAnswer(input.selectedText, input.question) });
  }

  const history = (input.history ?? [])
    .map((item: { role: string; content: string }) => `${item.role}: ${item.content}`)
    .join("\n");
  const prompt = `你是一位耐心、严谨的私人教师。用户正在阅读教材，并针对选中的原文提问。

课程主题：${input.topic}
选中的原文：${input.selectedText}
此前讨论：
${history}

用户问题：${input.question}

请直接回答当前问题。解释应贴合原文上下文；如果用户质疑正确性，请明确判断依据与不确定性。`;

  return NextResponse.json({ answer: await generateText(prompt) });
}
