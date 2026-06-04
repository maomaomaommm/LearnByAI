import { NextResponse } from "next/server";
import { generateText, hasAI, parseJson } from "@/lib/ai";
import { createMockCourse } from "@/lib/mock";
import { Course } from "@/lib/types";

export async function POST(request: Request) {
  const input = await request.json();
  if (!hasAI()) return NextResponse.json(createMockCourse(input));

  const prompt = `你是一位课程设计专家。为下面的学习者创建个性化课程。
主题：${input.topic}
目标：${input.goal}
基础：${input.background}
偏好：${input.preference}
每周时间：${input.weeklyHours} 小时

只输出 JSON，不要 markdown。结构：
{"profile":"学习策略说明","chapters":[{"title":"章节名","description":"一句话说明","minutes":60}]}
生成 5 至 7 章，课程必须贴合学习者基础和目标。`;

  const generated = parseJson<Pick<Course, "profile" | "chapters">>(await generateText(prompt));
  const course: Course = {
    id: crypto.randomUUID(),
    ...input,
    profile: generated.profile,
    createdAt: new Date().toISOString(),
    chapters: generated.chapters.map((chapter) => ({ ...chapter, id: crypto.randomUUID() })),
  };
  return NextResponse.json(course);
}
