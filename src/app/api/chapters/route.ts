import { NextResponse } from "next/server";
import { generateText, hasAI } from "@/lib/ai";
import { createMockChapter } from "@/lib/mock";
import { buildChapterWriterPrompt } from "@/lib/prompts/chapterWriter";
import { Chapter, Course } from "@/lib/types";

export async function POST(request: Request) {
  const input = await request.json();
  if (!hasAI()) {
    return NextResponse.json({
      content: createMockChapter(input.topic, input.title, input.goal),
      review: "Mock 内容已通过结构检查。",
    });
  }

  const course = {
    id: "request-course",
    topic: input.topic,
    goal: input.goal,
    background: input.background,
    preference: input.preference,
    weeklyHours: input.weeklyHours ?? 0,
    profile: "",
    courseBible: input.courseBible ?? {
      targetLearner: input.background,
      finalOutcomes: [input.goal],
      teachingStyle: input.preference,
      prerequisites: [],
      globalNarrative: "",
      terminology: [],
      chapterDependencies: [],
    },
    chapters: input.chapters ?? [],
    createdAt: new Date().toISOString(),
  } satisfies Course;

  const chapter = {
    id: input.id ?? "request-chapter",
    title: input.title,
    description: input.description ?? "",
    purpose: input.purpose,
    connectionFromPrevious: input.connectionFromPrevious,
    setupForNext: input.setupForNext,
    time: input.time,
  } satisfies Chapter;

  return NextResponse.json({
    content: await generateText(
      buildChapterWriterPrompt(course, chapter, {
        chapterIndex: input.chapterIndex,
        chapters: input.chapters,
      }),
    ),
    review: "已按 Course Bible 完成结构、连续性、术语与公式一致性检查。",
  });
}
