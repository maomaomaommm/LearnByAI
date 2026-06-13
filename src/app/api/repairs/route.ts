import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/apiAuth";
import { proposeContentRepair } from "@/lib/maol/client";
import { parseModelOverridesFromHeaders } from "@/lib/modelOverrides";
import { resolveRepairAnchor } from "@/lib/repairAnchor";
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
    const repairAnchor = targetText ? resolveRepairAnchor(targetText, selectedText) : undefined;
    if (!repairAnchor) {
      return NextResponse.json(
        { error: "无法在当前章节中唯一定位所选内容，请缩小选区后重试。" },
        { status: 409 },
      );
    }

    const suggestion = await proposeContentRepair({
      course,
      chapterId,
      sectionId,
      selectedText: repairAnchor,
      userMessage,
      overrides: parseModelOverridesFromHeaders(request.headers),
    });

    return NextResponse.json({
      repair: {
        id: crypto.randomUUID(),
        courseId,
        chapterId,
        sectionId,
        selectedText: repairAnchor,
        userMessage,
        ...suggestion,
        status: "proposed",
        createdAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: repairErrorMessage(error) },
      { status: 502 },
    );
  }
}

function repairErrorMessage(error: unknown) {
  const message = safeErrorMessage(error, "Repair suggestion failed.");
  if (/timed out|timeout|aborted/i.test(message)) {
    return "修复建议生成超时，请稍后重试。";
  }
  if (/401|unauthorized|api key|authentication/i.test(message)) {
    return "AI 服务鉴权失败，请联系管理员检查模型配置。";
  }
  return "暂时无法生成修复建议，请稍后重试。";
}
