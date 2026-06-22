import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/apiAuth";
import { reapplyTextRevisionInCourse, restoreChapterSnapshot, RevisionConflictError } from "@/lib/revisionApply";
import { safeErrorMessage } from "@/lib/safeError";
import {
  getServerCourse,
  getServerRevision,
  listServerRevisions,
  saveServerCourse,
  updateServerRevision,
} from "@/lib/serverStore";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  try {
    const revision = await getServerRevision(id, request);
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
    if (revision.status !== "reverted") {
      return NextResponse.json({ error: "只能重新应用已撤销的改写。" }, { status: 409 });
    }

    const course = await getServerCourse(revision.courseId, request);
    if (!course) return NextResponse.json({ error: "Course not found" }, { status: 404 });

    const beforeChapter = course.chapters.find((item) => item.id === revision.chapterId);
    let patched;
    if (revision.scope === "chapter") {
      if (!revision.afterChapter) {
        return NextResponse.json({ error: "Snapshot is missing reapplied chapter data." }, { status: 400 });
      }
      patched = restoreChapterSnapshot(course, revision.afterChapter);
    } else {
      if (!revision.beforeText || !revision.afterText) {
        return NextResponse.json({ error: "Revision has no text to reapply." }, { status: 400 });
      }
      const revisions = await listServerRevisions(revision.chapterId, request);
      const revertedAt = Date.parse(revision.revertedAt ?? revision.appliedAt ?? revision.createdAt);
      const hasLaterActiveRevision = revisions.some((item) => {
        if (item.id === revision.id || item.status !== "applied") return false;
        return Date.parse(item.appliedAt ?? item.createdAt) > revertedAt;
      });

      patched = reapplyTextRevisionInCourse(course, {
        chapterId: revision.chapterId,
        sectionId: revision.sectionId,
        beforeText: revision.beforeText,
        afterText: revision.afterText,
        afterChapter: revision.afterChapter,
        allowSnapshotFallback: !hasLaterActiveRevision,
      });
    }

    const savedCourse = await saveServerCourse(patched.course, request);
    const updatedRevision = await updateServerRevision(
      id,
      {
        status: "applied",
        appliedAt: new Date().toISOString(),
        revertedAt: undefined,
        beforeChapter,
        afterChapter: patched.chapter,
      },
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
      { error: safeErrorMessage(error, "Reapply revision failed.") },
      { status: error instanceof RevisionConflictError ? 409 : 500 },
    );
  }
}
