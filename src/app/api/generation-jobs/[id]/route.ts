import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/apiAuth";
import { getGenerationJobForRequest } from "@/lib/generationJobStatus";
import { failGenerationJob, getGenerationJob, patchGenerationJob, upsertGenerationJob } from "@/lib/jobs";
import { runChapterGenerationJob, runCourseGenerationJob } from "@/lib/generationRunner";
import { parseModelOverridesFromHeaders } from "@/lib/modelOverrides";
import { publicGenerationJob } from "@/lib/publicGenerationJob";
import { checkQuota } from "@/lib/quota";
import { getActiveServerGenerationJobForChapter, getActiveServerGenerationJobForCourse, getServerCourse, getServerGenerationJob, saveServerGenerationJob, updateServerChapter } from "@/lib/serverStore";
import { resolveModelOverrides } from "@/lib/userModelConfig";
import { Chapter, GenerationJob } from "@/lib/types";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  const job = await getGenerationJobForRequest(id, request);

  if (!job) {
    return NextResponse.json({ error: "Generation job not found" }, { status: 404 });
  }

  return NextResponse.json({ job: publicGenerationJob(job) });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const input = (await request.json().catch(() => ({}))) as { retry?: boolean };
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  const persistedJob = await getServerGenerationJob(id, request);
  const job = getGenerationJob(id) ?? (persistedJob ? upsertGenerationJob(persistedJob) : undefined);
  if (!job) {
    return NextResponse.json({ error: "Generation job not found" }, { status: 404 });
  }

  if (input.retry) {
    const result = await enqueueRetryJob(job, request);
    if ("error" in result) {
      return NextResponse.json(publicResult(result), { status: result.status });
    }
    return NextResponse.json(publicResult(result), { status: 202 });
  }

  const isCourseJob = job.type === "course";
  const result = isCourseJob
    ? await runCourseGenerationJob({
        jobId: id,
        request,
        retry: input.retry,
      })
    : await runChapterGenerationJob({
        jobId: id,
        request,
        retry: input.retry,
      });

  if ("error" in result) {
    return NextResponse.json(publicResult(result), { status: result.status });
  }

  return NextResponse.json(publicResult(result));
}

async function enqueueRetryJob(job: GenerationJob, request: Request) {
  if (job.status === "pending" || job.status === "queued" || job.status === "running" || job.status === "retrying") {
    return { job };
  }

  const activeJob = await getActiveJobForSameTarget(job, request);
  if (activeJob && activeJob.id !== job.id) {
    return { job: activeJob };
  }

  const headerOverrides = parseModelOverridesFromHeaders(request.headers);
  const resolvedOverrides = await resolveModelOverrides(job.userId, headerOverrides);
  const course = job.type === "chapter" && job.courseId ? await getServerCourse(job.courseId, request) : undefined;
  const chapter = course && job.chapterId ? course.chapters.find((item) => item.id === job.chapterId) : undefined;
  const retryAsGeneration = shouldRetryJobAsGeneration(job, chapter);

  if (retryAsGeneration) {
    const quota = await checkQuota(job.userId ?? course?.userId, "generate_chapter");
    if (!quota.ok) {
      const failedJob = failGenerationJob(job.id, quota.message) ?? job;
      await saveServerGenerationJob(failedJob, request);
      if (course && job.chapterId) {
        const failedCourse = await updateServerChapter(
          course,
          job.chapterId,
          { status: "failed", generationJobId: failedJob.id },
          request,
        );
        const failedChapter = failedCourse.chapters.find((item) => item.id === job.chapterId);
        return { job: failedJob, course: failedCourse, chapter: failedChapter, error: quota.message, status: 429 };
      }
      return { job: failedJob, error: quota.message, status: 429 };
    }
  }

  const now = new Date().toISOString();
  const retryingJob = patchGenerationJob(job.id, {
    ...(retryAsGeneration ? { mode: undefined, activeAgent: "AUTHOR" as const } : {}),
    status: "retrying",
    error: undefined,
    lockedBy: undefined,
    lockedUntil: undefined,
    modelOverrides: resolvedOverrides ?? job.modelOverrides,
    updatedAt: now,
  }) ?? {
    ...job,
    ...(retryAsGeneration ? { mode: undefined, activeAgent: "AUTHOR" as const } : {}),
    status: "retrying" as const,
    error: undefined,
    lockedBy: undefined,
    lockedUntil: undefined,
    modelOverrides: resolvedOverrides ?? job.modelOverrides,
    updatedAt: now,
  };
  const persistedJob = await saveServerGenerationJob(retryingJob, request);

  if (persistedJob.type === "chapter" && persistedJob.courseId && persistedJob.chapterId) {
    const currentCourse = course ?? await getServerCourse(persistedJob.courseId, request);
    if (currentCourse) {
      const retryAsReview = persistedJob.mode === "review_draft" && !retryAsGeneration;
      const updatedCourse = await updateServerChapter(
        currentCourse,
        persistedJob.chapterId,
        retryAsReview
          ? {
              qualityReport: undefined,
              status: "queued",
              generationJobId: persistedJob.id,
            }
          : {
              content: undefined,
              sections: undefined,
              review: undefined,
              qualityReport: undefined,
              status: "queued",
              generationJobId: persistedJob.id,
            },
        request,
      );
      return { job: persistedJob, course: updatedCourse };
    }
  }

  return { job: persistedJob };
}

function shouldRetryJobAsGeneration(job: GenerationJob, chapter: Chapter | undefined) {
  if (job.type !== "chapter") return false;
  if (job.mode !== "review_draft") return true;
  return !chapter || !hasChapterBody(chapter);
}

function hasChapterBody(chapter: Chapter) {
  return Boolean(chapter.content || chapter.sections?.length);
}

async function getActiveJobForSameTarget(job: GenerationJob, request: Request) {
  if (job.type === "course" && job.courseId) {
    return getActiveServerGenerationJobForCourse(job.courseId, request);
  }
  if (job.type === "chapter" && job.chapterId) {
    return getActiveServerGenerationJobForChapter(job.chapterId, request);
  }
  return undefined;
}

function publicResult<T extends { job?: GenerationJob }>(result: T) {
  return result.job ? { ...result, job: publicGenerationJob(result.job) } : result;
}
