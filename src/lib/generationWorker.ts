import "server-only";

import { getGenerationJob, upsertGenerationJob } from "./jobs";
import { runChapterGenerationJob, runCourseGenerationJob } from "./generationRunner";
import { claimServerGenerationJob, getServerGenerationJobForWorker, listRunnableGenerationJobs, releaseServerGenerationJob } from "./serverStore";
import { GenerationJob } from "./types";

const DEFAULT_LEASE_MS = 5 * 60 * 1000;

export async function runGenerationWorker(input: {
  jobId?: string;
  limit?: number;
  request?: Request;
} = {}) {
  const workerId = `worker-${crypto.randomUUID()}`;

  if (input.jobId) {
    const result = await runGenerationWorkerJob(input.jobId, input.request, undefined, workerId);
    return {
      scanned: result.job ? 1 : 0,
      processed: result.processed ? 1 : 0,
      jobs: result.job ? [result.job] : [],
    };
  }

  const jobs = await listRunnableGenerationJobs(input.limit ?? 10);
  const results = [];

  for (const job of jobs) {
    results.push(await runGenerationWorkerJob(job.id, input.request, job, workerId));
  }

  return {
    scanned: jobs.length,
    processed: results.filter((result) => result.processed).length,
    jobs: results.map((result) => result.job).filter(Boolean),
  };
}

async function runGenerationWorkerJob(
  jobId: string,
  request?: Request,
  knownJob?: GenerationJob,
  workerId = `worker-${crypto.randomUUID()}`,
) {
  const persistedJob = knownJob ?? await getServerGenerationJobForWorker(jobId);
  const job = getGenerationJob(jobId) ?? (persistedJob ? upsertGenerationJob(persistedJob) : undefined);
  if (!job) return { job, processed: false } as const;

  const claimed = await claimServerGenerationJob(job.id, workerId, DEFAULT_LEASE_MS);
  if (!claimed) {
    return { job, processed: false } as const;
  }

  const claimedRequest = requestForJob(request, claimed);

  try {
    if (claimed.type === "course") {
      const result = await runCourseGenerationJob({
        jobId: claimed.id,
        request: claimedRequest,
      });
      if (result.job?.status !== "running") {
        await releaseServerGenerationJob(claimed.id, workerId, claimedRequest);
      }
      return { ...result, processed: true } as const;
    }

    if (claimed.type === "chapter") {
      const result = await runChapterGenerationJob({
        jobId: claimed.id,
        request: claimedRequest,
      });
      if (result.job?.status !== "running") {
        await releaseServerGenerationJob(claimed.id, workerId, claimedRequest);
      }
      return { ...result, processed: true } as const;
    }

    await releaseServerGenerationJob(claimed.id, workerId, claimedRequest);
    return { job: claimed, processed: false } as const;
  } catch (error) {
    await releaseServerGenerationJob(claimed.id, workerId, claimedRequest);
    throw error;
  }
}

function requestForJob(request: Request | undefined, job: GenerationJob) {
  const headers = new Headers(request?.headers);
  if (job.userId) {
    headers.set("x-learnbyai-user-id", job.userId);
  }
  return new Request(request?.url ?? "http://learnbyai.local/internal-worker", { headers });
}
