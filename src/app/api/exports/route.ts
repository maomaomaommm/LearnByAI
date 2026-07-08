import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/apiAuth";
import { createCourseExport } from "@/lib/exports";
import { completeGenerationJob, createGenerationJob } from "@/lib/jobs";
import { withQuotaConsumption } from "@/lib/quota";
import { safeErrorMessage } from "@/lib/safeError";
import { getServerCourse, listServerExports, saveServerExport, saveServerGenerationJob } from "@/lib/serverStore";

export async function GET(request: Request) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  const { searchParams } = new URL(request.url);
  const courseId = searchParams.get("courseId") ?? undefined;
  return NextResponse.json({ exports: await listServerExports(request, courseId) });
}

export async function POST(request: Request) {
  try {
    const input = await request.json();
    const auth = await requireApiUser(request);
    if ("response" in auth) return auth.response;

    const course = await getServerCourse(input.courseId, request);
    if (!course) {
      return NextResponse.json({ error: "Course not found" }, { status: 404 });
    }

    const userId = auth.userId;
    const format = input.format === "tex" ? "tex" : "pdf";
    // scope "chapter" exports a single chapter (PDF only); default is the whole course.
    const chapterId =
      input.scope === "chapter" && typeof input.chapterId === "string" && course.chapters.some((c) => c.id === input.chapterId)
        ? input.chapterId
        : undefined;
    const result = await withQuotaConsumption(userId, "export", async () => {
      const job = createGenerationJob({
        type: "export",
        courseId: course.id,
        userId,
        status: "running",
        message: `${format.toUpperCase()} export started.`,
      });
      const exportJob = await saveServerExport(await createCourseExport(course, format, userId, { chapterId }));
      const completedJob = completeGenerationJob(job.id, exportJob.id) ?? job;
      await saveServerGenerationJob(completedJob, request);
      return { export: exportJob, job: completedJob };
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.quota.message }, { status: 429 });
    }

    return NextResponse.json(result.value);
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error, "Export failed.") }, { status: 500 });
  }
}
