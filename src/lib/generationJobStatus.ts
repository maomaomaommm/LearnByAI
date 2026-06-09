import "server-only";

import { getBaseAIConfig } from "./config";
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

  const timeoutMs = getBaseAIConfig().timeoutMs;
  const staleAfterMs = Math.max(timeoutMs + 10_000, 30_000);
  const updatedAtMs = Date.parse(job.updatedAt);
  if (!Number.isFinite(updatedAtMs) || Date.now() - updatedAtMs <= staleAfterMs) return job;

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
