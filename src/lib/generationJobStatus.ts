import "server-only";

import { getGenerationJob, upsertGenerationJob } from "./jobs";
import { getServerCourse, getServerGenerationJob, saveServerGenerationJob, updateServerChapter } from "./serverStore";
import { GenerationJob } from "./types";

export async function getGenerationJobForRequest(jobId: string, request: Request) {
  const persistedJob = await getServerGenerationJob(jobId, request);
  const job = persistedJob ?? getGenerationJob(jobId);
  return markStaleJobFailed(job, request);
}

export async function markStaleJobFailed(job: GenerationJob | undefined, request: Request) {
  if (!job || !["running", "retrying"].includes(job.status)) return job;

  const staleAfterMs = readPositiveInteger(process.env.GENERATION_STALE_JOB_MS, 45 * 60 * 1000);
  const lockUntilMs = job.lockedUntil ? Date.parse(job.lockedUntil) : NaN;
  if (Number.isFinite(lockUntilMs) && lockUntilMs > Date.now()) return job;

  const referenceMs = Number.isFinite(lockUntilMs) ? lockUntilMs : Date.parse(job.updatedAt);
  if (!Number.isFinite(referenceMs) || Date.now() - referenceMs <= staleAfterMs) return job;

  const now = new Date().toISOString();
  const staleMessage = `Generation job did not update for ${Math.round(staleAfterMs / 1000)} seconds. The model request may have timed out, or the local server may have restarted.`;
  const next: GenerationJob = {
    ...job,
    status: "failed",
    error: staleMessage,
    updatedAt: now,
    events: [
      ...job.events,
      {
        id: crypto.randomUUID(),
        agent: job.activeAgent ?? "ASSISTANT",
        status: "failed",
        message: staleMessage,
        createdAt: now,
      },
    ],
  };
  upsertGenerationJob(next);
  await saveServerGenerationJob(next, request);
  await syncChapterAfterStaleFailure(next, request);
  return next;
}

/**
 * A watchdog-failed chapter job must not leave the chapter stuck at
 * "generating"/"queued" — the UI would show a dead spinner with no retry
 * affordance. Flip the chapter to a terminal, retryable state: keep the draft
 * readable when a body exists, otherwise mark it failed.
 */
async function syncChapterAfterStaleFailure(job: GenerationJob, request: Request) {
  if (job.type !== "chapter" || !job.courseId || !job.chapterId) return;
  try {
    const course = await getServerCourse(job.courseId, request);
    const chapter = course?.chapters.find((item) => item.id === job.chapterId);
    if (!course || !chapter) return;
    if (chapter.status !== "generating" && chapter.status !== "queued") return;
    const hasBody = Boolean(chapter.content || chapter.sections?.length);
    await updateServerChapter(
      course,
      job.chapterId,
      { status: hasBody ? "draft_ready" : "failed", generationJobId: job.id },
      request,
    );
  } catch (error) {
    console.warn("Failed to sync chapter status after stale job failure:", error);
  }
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
