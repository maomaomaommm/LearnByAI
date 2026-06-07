import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/apiAuth";
import { getGenerationJob, upsertGenerationJob } from "@/lib/jobs";
import { runChapterGenerationJob, runCourseGenerationJob } from "@/lib/generationRunner";
import { getServerGenerationJob } from "@/lib/serverStore";
import { Course } from "@/lib/types";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  const persistedJob = await getServerGenerationJob(id, request);
  const job = getGenerationJob(id) ?? (persistedJob ? upsertGenerationJob(persistedJob) : undefined);

  if (!job) {
    return NextResponse.json({ error: "Generation job not found" }, { status: 404 });
  }

  return NextResponse.json({ job });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const input = (await request.json().catch(() => ({}))) as { courseId?: string; course?: Course; retry?: boolean };
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  const persistedJob = await getServerGenerationJob(id, request);
  const job = getGenerationJob(id) ?? (persistedJob ? upsertGenerationJob(persistedJob) : undefined);
  const result = job?.type === "course"
    ? await runCourseGenerationJob({
        jobId: id,
        request,
        courseSnapshot: input.course,
      })
    : await runChapterGenerationJob({
        jobId: id,
        request,
        courseSnapshot: input.course,
        retry: input.retry,
      });

  if ("error" in result) {
    return NextResponse.json(result, { status: result.status });
  }

  return NextResponse.json(result);
}
