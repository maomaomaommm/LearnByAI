import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/apiAuth";
import { getBaseAIConfig } from "@/lib/config";
import { getGenerationJob, upsertGenerationJob } from "@/lib/jobs";
import { runChapterGenerationJob, runCourseGenerationJob } from "@/lib/generationRunner";
import { getServerGenerationJob, saveServerGenerationJob } from "@/lib/serverStore";
import { Course, GenerationJob } from "@/lib/types";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  const persistedJob = await getServerGenerationJob(id, request);
  const job = await markStaleJobFailed(
    getGenerationJob(id) ?? (persistedJob ? upsertGenerationJob(persistedJob) : undefined),
    request,
  );

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
  const isCourseJob = job?.type === "course" || input.course?.generationJobId === id;
  const result = isCourseJob
    ? await runCourseGenerationJob({
        jobId: id,
        request,
        courseSnapshot: input.course,
        retry: input.retry,
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

async function markStaleJobFailed(job: GenerationJob | undefined, request: Request) {
  if (!job || !["running", "retrying"].includes(job.status)) return job;

  const timeoutMs = getBaseAIConfig().timeoutMs;
  const staleAfterMs = Math.max(timeoutMs + 10_000, 30_000);
  const updatedAtMs = Date.parse(job.updatedAt);
  if (!Number.isFinite(updatedAtMs) || Date.now() - updatedAtMs <= staleAfterMs) return job;

  const now = new Date().toISOString();
  const next: GenerationJob = {
    ...job,
    status: "failed",
    error: `生成任务已有 ${Math.round(staleAfterMs / 1000)} 秒未更新。大模型请求可能已超时，或者本地后台服务可能发生过重启。`,
    updatedAt: now,
    events: [
      ...job.events,
      {
        id: crypto.randomUUID(),
        agent: job.activeAgent ?? "ASSISTANT",
        status: "failed",
        message: `生成任务已有 ${Math.round(staleAfterMs / 1000)} 秒未更新。`,
        createdAt: now,
      },
    ],
  };
  upsertGenerationJob(next);
  await saveServerGenerationJob(next, request);
  return next;
}
