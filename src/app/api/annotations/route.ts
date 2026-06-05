import { NextResponse } from "next/server";
import { generateText, hasAI } from "@/lib/ai";
import { createMockAnswer } from "@/lib/mock";
import { buildAnnotationTutorPrompt } from "@/lib/prompts/annotationTutor";

export async function POST(request: Request) {
  const input = await request.json();
  if (!hasAI()) {
    return NextResponse.json({ answer: createMockAnswer(input.selectedText, input.question) });
  }

  return NextResponse.json({
    answer: await generateText(
      buildAnnotationTutorPrompt({
        topic: input.topic,
        selectedText: input.selectedText,
        question: input.question,
        history: input.history ?? [],
      }),
    ),
  });
}
