import "server-only";

import { getGenerationJob, upsertGenerationJob } from "./jobs";
import { getServerGenerationJob, saveServerGenerationJob } from "./serverStore";
import { GenerationJob } from "./types";

export async function getGenerationJobForRequest(jobId: string, request: Request) {
  const persistedJob = await getServerGenerationJob(jobId, request);
  const job = getGenerationJob(jobId) ?? (persistedJob ? upsertGenerationJob(persistedJob) : undefined);
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
  return next;
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
