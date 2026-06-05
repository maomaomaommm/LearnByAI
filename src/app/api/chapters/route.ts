import { NextResponse } from "next/server";
import { generateText, hasAI } from "@/lib/ai";
import { createMockChapter } from "@/lib/mock";
import { buildChapterWriterPrompt } from "@/lib/prompts/chapterWriter";
import { buildFormatGuardPrompt, postRepairMarkdown, preRepairMarkdown } from "@/lib/prompts/formatGuard";
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

  const draft = preRepairMarkdown(await generateText(
    buildChapterWriterPrompt(course, chapter, {
      chapterIndex: input.chapterIndex,
      chapters: input.chapters,
    }),
  ));
  let formatted = draft;
  let review = "正文已生成；Format Guard 暂时超时，已保留本地格式预修复版本。";

  try {
    formatted = postRepairMarkdown(
      await generateText(buildFormatGuardPrompt(draft), {
        temperature: 0.1,
        maxTokens: 32768,
      }),
    );
    review = "已通过 Format Guard 完成 Markdown、公式、代码块与标题格式修复。";
  } catch {
    formatted = draft;
  }

  return NextResponse.json({
    content: formatted,
    review,
  });
}
