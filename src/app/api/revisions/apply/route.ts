import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/apiAuth";
import { applyTextRevisionToCourse, RevisionConflictError } from "@/lib/revisionApply";
import { safeErrorMessage } from "@/lib/safeError";
import { getServerCourse, getServerRevision, saveServerCourse, updateServerRevision } from "@/lib/serverStore";

export async function POST(request: Request) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  try {
    const input = await request.json();
    const revisionId = String(input.revisionId ?? "");
    if (!revisionId) {
      return NextResponse.json({ error: "revisionId is required." }, { status: 400 });
    }

    const revision = await getServerRevision(revisionId, request);
    if (!revision) return NextResponse.json({ error: "Revision not found" }, { status: 404 });

    if (revision.status === "applied") {
      const existing = await getServerCourse(revision.courseId, request);
      return NextResponse.json({
        course: existing,
        chapter: existing?.chapters.find((item) => item.id === revision.chapterId),
        revision,
        applied: true,
      });
    }
    if (revision.status !== "proposed") {
      return NextResponse.json({ error: "只能应用待确认的改写。" }, { status: 409 });
    }
    if (revision.scope === "chapter") {
      return NextResponse.json({ error: "整章快照请通过重新生成流程处理。" }, { status: 400 });
    }
    if (!revision.beforeText || !revision.afterText) {
      return NextResponse.json({ error: "Revision has no text to apply." }, { status: 400 });
    }
    if (revision.beforeText === revision.afterText) {
      return NextResponse.json({ error: "Revision does not change the selected text." }, { status: 400 });
    }

    const course = await getServerCourse(revision.courseId, request);
    if (!course) return NextResponse.json({ error: "Course not found" }, { status: 404 });

    const { course: patched } = applyTextRevisionToCourse(course, {
      chapterId: revision.chapterId,
      sectionId: revision.sectionId,
      beforeText: revision.beforeText,
      afterText: revision.afterText,
    });
    const savedCourse = await saveServerCourse(patched, request);
    const updatedRevision = await updateServerRevision(
      revisionId,
      { status: "applied", appliedAt: new Date().toISOString() },
      request,
    );

    return NextResponse.json({
      course: savedCourse,
      chapter: savedCourse.chapters.find((item) => item.id === revision.chapterId),
      revision: updatedRevision,
      applied: true,
    });
  } catch (error) {
    return NextResponse.json(
      { error: safeErrorMessage(error, "Apply revision failed.") },
      { status: error instanceof RevisionConflictError ? 409 : 500 },
    );
  }
}
