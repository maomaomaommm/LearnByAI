import { NextResponse } from "next/server";
import { generateText, hasAI, parseJson } from "@/lib/ai";
import { createMockCourse } from "@/lib/mock";
import { buildChapterWriterPrompt } from "@/lib/prompts/chapterWriter";
import { buildCoursePlannerPrompt } from "@/lib/prompts/coursePlanner";
import { Chapter, Course, CourseBible } from "@/lib/types";

type CourseGeneration = {
  profile: string;
  courseBible: CourseBible;
  chapters: Omit<Chapter, "id" | "content" | "review" | "status">[];
};

export async function POST(request: Request) {
  const input = await request.json();
  if (!hasAI()) return NextResponse.json(createMockCourse(input));

  const generated = parseJson<CourseGeneration>(
    await generateText(buildCoursePlannerPrompt(input)),
  );
  const course: Course = {
    id: crypto.randomUUID(),
    ...input,
    profile: generated.profile,
    courseBible: generated.courseBible,
    createdAt: new Date().toISOString(),
    chapters: generated.chapters.map((chapter) => ({
      ...chapter,
      id: crypto.randomUUID(),
      status: "pending",
    })),
  };

  if (course.chapters[0]) {
    course.chapters[0].status = "generating";
    course.chapters[0].content = await generateText(
      buildChapterWriterPrompt(course, course.chapters[0], { chapterIndex: 0 }),
    );
    course.chapters[0].review = "已按 Course Bible 完成结构、连续性、术语与公式一致性检查。";
    course.chapters[0].status = "ready";
  }

  return NextResponse.json(course);
}
