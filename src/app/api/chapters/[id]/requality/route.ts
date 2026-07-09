import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/apiAuth";
import { markdownToSections } from "@/lib/maol/integrator";
import { postRepairMarkdown } from "@/lib/prompts/formatGuard";
import { runChapterQualityPipelineWithRepair } from "@/lib/quality/pipeline";
import { safeErrorMessage } from "@/lib/safeError";
import { getServerCourse, saveServerQualityReport, updateServerChapter } from "@/lib/serverStore";

/**
 * Re-run the deterministic quality pipeline (with format self-repair) on a
 * chapter's CURRENT content, and persist the healed content + fresh report.
 *
 * Two real situations need this:
 * - a chapter stuck at quality_failed whose stored content has since become
 *   repairable (the deterministic repair chain keeps improving);
 * - a stale report: "keep the best draft" preserves content whose final report
 *   was produced against an older draft.
 *
 * Purely deterministic (no LLM call), so it consumes no quota.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const input = (await request.json().catch(() => ({}))) as { courseId?: string };
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  if (!input.courseId) {
    return NextResponse.json({ error: "courseId is required" }, { status: 400 });
  }
  const course = await getServerCourse(input.courseId, request);
  if (!course) return NextResponse.json({ error: "Course not found" }, { status: 404 });
  const chapter = course.chapters.find((item) => item.id === id);
  if (!chapter) return NextResponse.json({ error: "Chapter not found" }, { status: 404 });

  const content = chapter.content ?? chapter.sections?.map((section) => section.content).join("\n\n") ?? "";
  if (!content.trim()) {
    return NextResponse.json({ error: "Chapter has no content to re-check" }, { status: 400 });
  }

  try {
    const { content: repairedContent, report } = runChapterQualityPipelineWithRepair(
      chapter,
      content,
      postRepairMarkdown,
    );
    await saveServerQualityReport(report, request);
    const updatedCourse = await updateServerChapter(
      course,
      chapter.id,
      {
        content: repairedContent,
        sections: markdownToSections(chapter, repairedContent),
        qualityReport: report,
        status: report.status === "failed" ? "quality_failed" : "ready",
      },
      request,
    );
    const updatedChapter = updatedCourse.chapters.find((item) => item.id === chapter.id);
    return NextResponse.json({ course: updatedCourse, chapter: updatedChapter, report });
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error, "Quality re-check failed.") }, { status: 500 });
  }
}
