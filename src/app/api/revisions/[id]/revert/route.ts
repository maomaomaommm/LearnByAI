import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/apiAuth";
import { restoreChapterSnapshot, revertTextRevisionInCourse, RevisionConflictError } from "@/lib/revisionApply";
import { safeErrorMessage } from "@/lib/safeError";
import { getServerCourse, getServerRevision, saveServerCourse, updateServerRevision } from "@/lib/serverStore";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  try {
    const revision = await getServerRevision(id, request);
    if (!revision) return NextResponse.json({ error: "Revision not found" }, { status: 404 });
    if (revision.status !== "applied") {
      return NextResponse.json({ error: "只能撤销已应用的改写。" }, { status: 409 });
    }

    const course = await getServerCourse(revision.courseId, request);
    if (!course) return NextResponse.json({ error: "Course not found" }, { status: 404 });

    let patched;
    if (revision.scope === "chapter") {
      if (!revision.beforeChapter) {
        return NextResponse.json({ error: "Snapshot is missing chapter data." }, { status: 400 });
      }
      patched = restoreChapterSnapshot(course, revision.beforeChapter);
    } else {
      if (!revision.beforeText || !revision.afterText) {
        return NextResponse.json({ error: "Revision has no text to revert." }, { status: 400 });
      }
      patched = revertTextRevisionInCourse(course, {
        chapterId: revision.chapterId,
        sectionId: revision.sectionId,
        beforeText: revision.beforeText,
        afterText: revision.afterText,
      });
    }

    const savedCourse = await saveServerCourse(patched.course, request);
    const updatedRevision = await updateServerRevision(
      id,
      { status: "reverted", revertedAt: new Date().toISOString() },
      request,
    );

    return NextResponse.json({
      course: savedCourse,
      chapter: savedCourse.chapters.find((item) => item.id === revision.chapterId),
      revision: updatedRevision,
      reverted: true,
    });
  } catch (error) {
    return NextResponse.json(
      { error: safeErrorMessage(error, "Revert revision failed.") },
      { status: error instanceof RevisionConflictError ? 409 : 500 },
    );
  }
}
