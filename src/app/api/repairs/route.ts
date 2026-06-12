import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/apiAuth";
import { proposeContentRepair } from "@/lib/maol/client";
import { parseModelOverridesFromHeaders } from "@/lib/modelOverrides";
import { safeErrorMessage } from "@/lib/safeError";
import { getServerCourse } from "@/lib/serverStore";

export async function POST(request: Request) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  try {
    const input = await request.json();
    const courseId = String(input.courseId ?? "");
    const chapterId = String(input.chapterId ?? "");
    const selectedText = String(input.selectedText ?? "").trim();
    const userMessage = String(input.userMessage ?? "").trim();
    const sectionId = input.sectionId ? String(input.sectionId) : undefined;

    if (!courseId || !chapterId || !selectedText || !userMessage) {
      return NextResponse.json(
        { error: "courseId, chapterId, selectedText, and userMessage are required." },
        { status: 400 },
      );
    }

    const course = await getServerCourse(courseId, request);
    if (!course) return NextResponse.json({ error: "Course not found" }, { status: 404 });

    const chapter = course.chapters.find((item) => item.id === chapterId);
    if (!chapter) return NextResponse.json({ error: "Chapter not found" }, { status: 404 });
    if (sectionId && !chapter.sections?.some((section) => section.id === sectionId)) {
      return NextResponse.json({ error: "Section not found" }, { status: 404 });
    }

    const targetText = sectionId
      ? chapter.sections?.find((section) => section.id === sectionId)?.content
      : chapter.content ?? chapter.sections?.map((section) => section.content).join("\n\n");
    if (!targetText?.includes(selectedText)) {
      return NextResponse.json(
        { error: "Selected text no longer matches the current chapter content." },
        { status: 409 },
      );
    }

    const suggestion = await proposeContentRepair({
      course,
      chapterId,
      sectionId,
      selectedText,
      userMessage,
      overrides: parseModelOverridesFromHeaders(request.headers),
    });

    return NextResponse.json({
      repair: {
        id: crypto.randomUUID(),
        courseId,
        chapterId,
        sectionId,
        selectedText,
        userMessage,
        ...suggestion,
        status: "proposed",
        createdAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: safeErrorMessage(error, "Repair suggestion failed.") },
      { status: 500 },
    );
  }
}
