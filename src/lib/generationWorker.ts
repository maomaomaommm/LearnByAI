import "server-only";

import { appendJobEvent, getGenerationJob } from "./jobs";
import { runChapterGenerationJob, runCourseGenerationJob } from "./generationRunner";
import { MODEL_CONFIG_HEADER } from "./modelOverrides";
import { claimServerGenerationJob, getServerGenerationJobForWorker, listRunnableGenerationJobs, recoverInterruptedGenerationJobs, refreshServerGenerationJobLease, releaseServerGenerationJob, saveServerGenerationJob } from "./serverStore";
import { GenerationJob } from "./types";
import { getAdminAppSettings } from "./adminSettings";

const DEFAULT_LEASE_MS = readPositiveInteger(process.env.GENERATION_WORKER_LEASE_MS, 30 * 60 * 1000);
const DEFAULT_COURSE_CHAPTER_CONCURRENCY = readPositiveInteger(process.env.GENERATION_COURSE_CHAPTER_CONCURRENCY, 2);
const DEFAULT_USER_COURSE_CONCURRENCY = readPositiveInteger(process.env.GENERATION_USER_COURSE_CONCURRENCY, 3);

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
  const userCourseConcurrency = settings.worker?.userCourseConcurrency ?? DEFAULT_USER_COURSE_CONCURRENCY;
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
    const result = await runGenerationWorkerJob(input.jobId, input.request, undefined, workerId, courseChapterConcurrency, userCourseConcurrency);
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
    results.push(await runGenerationWorkerJob(job.id, input.request, job, workerId, courseChapterConcurrency, userCourseConcurrency));
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
  userCourseConcurrency = DEFAULT_USER_COURSE_CONCURRENCY,
) {
  const persistedJob = knownJob ?? await getServerGenerationJobForWorker(jobId);
  const job = persistedJob ?? getGenerationJob(jobId);
  if (!job) return { job, processed: false } as const;

  const shouldRetry = job.status === "retrying";
  const claimed = await claimServerGenerationJob(job.id, workerId, DEFAULT_LEASE_MS, courseChapterConcurrency, userCourseConcurrency);
  if (!claimed) {
    return { job, processed: false } as const;
  }

  const claimedRequest = requestForJob(request, claimed);
  const claimedEventJob = appendJobEvent(claimed.id, {
    agent: claimed.activeAgent ?? "ASSISTANT",
    status: "running",
    message: `${claimed.activeAgent ?? "ASSISTANT"} claimed by worker and started.`,
  }, { preserveJobStatus: true });
  if (claimedEventJob) {
    await saveServerGenerationJob(claimedEventJob, claimedRequest);
    await refreshServerGenerationJobLease(claimed.id, workerId, DEFAULT_LEASE_MS, claimedRequest);
  }
  const stopHeartbeat = startLeaseHeartbeat(claimed.id, workerId, claimedRequest, DEFAULT_LEASE_MS);

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
  } finally {
    stopHeartbeat();
  }
}

function startLeaseHeartbeat(jobId: string, workerId: string, request: Request, leaseMs: number) {
  const intervalMs = Math.max(10_000, Math.min(60_000, Math.floor(leaseMs / 3)));
  const timer = setInterval(() => {
    void refreshServerGenerationJobLease(jobId, workerId, leaseMs, request).catch((error) => {
      console.error("Generation worker heartbeat failed", error);
    });
  }, intervalMs);

  return () => clearInterval(timer);
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
