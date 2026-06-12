import "server-only";

import { getGenerationJob, upsertGenerationJob } from "./jobs";
import { runChapterGenerationJob, runCourseGenerationJob } from "./generationRunner";
import { MODEL_CONFIG_HEADER } from "./modelOverrides";
import { claimServerGenerationJob, getServerGenerationJobForWorker, listRunnableGenerationJobs, recoverInterruptedGenerationJobs, releaseServerGenerationJob } from "./serverStore";
import { GenerationJob } from "./types";
import { getAdminAppSettings } from "./adminSettings";

const DEFAULT_LEASE_MS = readPositiveInteger(process.env.GENERATION_WORKER_LEASE_MS, 30 * 60 * 1000);
const DEFAULT_COURSE_CHAPTER_CONCURRENCY = readPositiveInteger(process.env.GENERATION_COURSE_CHAPTER_CONCURRENCY, 2);

export async function runGenerationWorker(input: {
  jobId?: string;
  limit?: number;
  recover?: boolean;
  request?: Request;
} = {}) {
  const workerId = `worker-${crypto.randomUUID()}`;
  const settings = await getAdminAppSettings();
  const workerLimit = input.limit ?? settings.worker?.globalLimit ?? 10;
  const courseChapterConcurrency = settings.worker?.courseChapterConcurrency ?? DEFAULT_COURSE_CHAPTER_CONCURRENCY;
  const recovered = input.recover ? await recoverInterruptedGenerationJobs() : 0;

  if (input.recover && !input.jobId) {
    return {
      scanned: 0,
      processed: 0,
      recovered,
      jobs: [],
    };
  }

  if (input.jobId) {
    const result = await runGenerationWorkerJob(input.jobId, input.request, undefined, workerId, courseChapterConcurrency);
    return {
      scanned: result.job ? 1 : 0,
      processed: result.processed ? 1 : 0,
      recovered,
      jobs: result.job ? [result.job] : [],
    };
  }

  const jobs = await listRunnableGenerationJobs(workerLimit);
  const results = [];

  for (const job of jobs) {
    results.push(await runGenerationWorkerJob(job.id, input.request, job, workerId, courseChapterConcurrency));
  }

  return {
    scanned: jobs.length,
    processed: results.filter((result) => result.processed).length,
    recovered,
    jobs: results.map((result) => result.job).filter((job): job is GenerationJob => Boolean(job)),
  };
}

async function runGenerationWorkerJob(
  jobId: string,
  request?: Request,
  knownJob?: GenerationJob,
  workerId = `worker-${crypto.randomUUID()}`,
  courseChapterConcurrency = DEFAULT_COURSE_CHAPTER_CONCURRENCY,
) {
  const persistedJob = knownJob ?? await getServerGenerationJobForWorker(jobId);
  const job = getGenerationJob(jobId) ?? (persistedJob ? upsertGenerationJob(persistedJob) : undefined);
  if (!job) return { job, processed: false } as const;

  const shouldRetry = job.status === "retrying";
  const claimed = await claimServerGenerationJob(job.id, workerId, DEFAULT_LEASE_MS, courseChapterConcurrency);
  if (!claimed) {
    return { job, processed: false } as const;
  }

  const claimedRequest = requestForJob(request, claimed);

  try {
    if (claimed.type === "course") {
      const result = await runCourseGenerationJob({
        jobId: claimed.id,
        request: claimedRequest,
        retry: shouldRetry,
        claimed: true,
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
        retry: shouldRetry,
        claimed: true,
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
  if (job.modelOverrides) {
    headers.set(MODEL_CONFIG_HEADER, JSON.stringify(job.modelOverrides));
  }
  return new Request(request?.url ?? "http://learnbyai.local/internal-worker", { headers });
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export const __test_requestForJob = requestForJob;
