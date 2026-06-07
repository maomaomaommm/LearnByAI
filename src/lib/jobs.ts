import "server-only";

import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { safeErrorMessage } from "./safeError";
import { AgentEvent, AgentName, GenerationJob, JobStatus } from "./types";

const jobs = new Map<string, GenerationJob>();
const jobStorePath = join(process.cwd(), ".next", "local-beta-jobs.json");
let hydrated = false;

export function createGenerationJob(input: {
  type: GenerationJob["type"];
  courseId?: string;
  chapterId?: string;
  userId?: string;
  activeAgent?: AgentName;
  status?: JobStatus;
  message?: string;
}) {
  hydrateJobs();
  const now = new Date().toISOString();
  const job: GenerationJob = {
    id: crypto.randomUUID(),
    type: input.type,
    courseId: input.courseId,
    chapterId: input.chapterId,
    userId: input.userId,
    activeAgent: input.activeAgent,
    status: input.status ?? "pending",
    events: [],
    createdAt: now,
    updatedAt: now,
  };

  jobs.set(job.id, job);
  persistJobs();
  appendJobEvent(job.id, {
    agent: input.activeAgent ?? "ASSISTANT",
    status: job.status,
    message: input.message ?? "Job created.",
  });

  return getGenerationJob(job.id)!;
}

export function appendJobEvent(
  jobId: string,
  event: Omit<AgentEvent, "id" | "createdAt">,
  options: { preserveJobStatus?: boolean } = {},
) {
  hydrateJobs();
  const job = jobs.get(jobId);
  if (!job) return undefined;

  const now = new Date().toISOString();
  job.events.push({
    id: crypto.randomUUID(),
    createdAt: now,
    ...event,
  });
  if (!options.preserveJobStatus) {
    job.status = event.status;
  }
  job.activeAgent = event.agent;
  job.updatedAt = now;
  jobs.set(jobId, job);
  persistJobs();
  return structuredClone(job);
}

export function completeGenerationJob(jobId: string, resultId?: string) {
  hydrateJobs();
  const job = jobs.get(jobId);
  if (!job) return undefined;
  job.resultId = resultId;
  return appendJobEvent(jobId, {
    agent: job.activeAgent ?? "ASSISTANT",
    status: "succeeded",
    message: "Job completed.",
  });
}

export function failGenerationJob(jobId: string, error: string) {
  hydrateJobs();
  const job = jobs.get(jobId);
  if (!job) return undefined;
  const message = safeErrorMessage(error, "Generation job failed.");
  job.error = message;
  return appendJobEvent(jobId, {
    agent: job.activeAgent ?? "ASSISTANT",
    status: "failed",
    message,
  });
}

export function getGenerationJob(jobId: string) {
  hydrateJobs();
  const job = jobs.get(jobId);
  return job ? structuredClone(job) : undefined;
}

export function listGenerationJobs() {
  hydrateJobs();
  return [...jobs.values()].map((job) => structuredClone(job));
}

export function patchGenerationJob(jobId: string, patch: Partial<GenerationJob>) {
  hydrateJobs();
  const job = jobs.get(jobId);
  if (!job) return undefined;
  const next = {
    ...job,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  jobs.set(jobId, next);
  persistJobs();
  return structuredClone(next);
}

export function upsertGenerationJob(job: GenerationJob) {
  hydrateJobs();
  jobs.set(job.id, structuredClone(job));
  persistJobs();
  return getGenerationJob(job.id)!;
}

export function claimGenerationJob(jobId: string, workerId: string, leaseMs: number) {
  hydrateJobs();
  const job = jobs.get(jobId);
  if (!job || !isClaimable(job)) return undefined;

  const now = new Date().toISOString();
  const next = {
    ...job,
    lockedBy: workerId,
    lockedUntil: new Date(Date.now() + leaseMs).toISOString(),
    attempts: (job.attempts ?? 0) + 1,
    updatedAt: now,
  };
  jobs.set(jobId, next);
  persistJobs();
  return structuredClone(next);
}

export function releaseGenerationJob(jobId: string, workerId: string) {
  hydrateJobs();
  const job = jobs.get(jobId);
  if (!job || job.lockedBy !== workerId) return undefined;

  const next = {
    ...job,
    lockedBy: undefined,
    lockedUntil: undefined,
    updatedAt: new Date().toISOString(),
  };
  jobs.set(jobId, next);
  persistJobs();
  return structuredClone(next);
}

function hydrateJobs() {
  if (hydrated) return;
  hydrated = true;

  try {
    const raw = readFileSync(jobStorePath, "utf8");
    if (!raw.trim()) return;
    const parsed = JSON.parse(raw) as { jobs?: GenerationJob[] } | GenerationJob[];
    const storedJobs = Array.isArray(parsed) ? parsed : (parsed.jobs ?? []);
    storedJobs.forEach((job) => jobs.set(job.id, job));
  } catch {
    // The local job store is a development fallback. Missing/corrupt files should not break requests.
  }
}

function isClaimable(job: GenerationJob) {
  if (!["pending", "queued", "retrying"].includes(job.status)) return false;
  return !job.lockedUntil || Date.parse(job.lockedUntil) <= Date.now();
}

function persistJobs() {
  try {
    mkdirSync(dirname(jobStorePath), { recursive: true });
    const raw = JSON.stringify({ jobs: [...jobs.values()] });
    const tmpPath = `${jobStorePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
    writeFileSync(tmpPath, raw, "utf8");
    try {
      renameSync(tmpPath, jobStorePath);
    } catch {
      try {
        unlinkSync(tmpPath);
      } catch {
        // Ignore cleanup failure for a best-effort fallback file.
      }
    }
  } catch {
    // Best-effort persistence; Supabase remains the production source when configured.
  }
}
