import "./load-env.mjs";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { runGenerationWorkerOnce } from "./run-generation-worker-once.mjs";

const isDirectRun = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;

export async function runWorkerHandoffSmoke({
  appBaseUrl = process.env.APP_BASE_URL,
  internalWorkerSecret = process.env.INTERNAL_WORKER_SECRET,
  supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL,
  supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY,
  required = process.env.WORKER_HANDOFF_REQUIRED === "true",
  fetchImpl = globalThis.fetch,
  createClientImpl = createClient,
  runWorkerOnce = runGenerationWorkerOnce,
  timeoutMs = 120_000,
  pollMs = 2_000,
} = {}) {
  const missing = missingConfig({
    appBaseUrl,
    internalWorkerSecret,
    supabaseUrl,
    supabaseAnonKey,
    supabaseServiceRoleKey,
  });

  if (missing.length > 0) {
    const message = `set ${missing.join(", ")}.`;
    if (required) {
      throw new Error(`Worker handoff smoke required but missing configuration: ${message}`);
    }
    return {
      skipped: true,
      message: `Skipping worker handoff smoke: ${message}`,
    };
  }

  const baseUrl = normalizeBaseUrl(appBaseUrl);
  const service = createClientImpl(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const anon = createClientImpl(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const email = `learnbyai-worker-handoff-${crypto.randomUUID()}@example.com`;
  const password = `LearnByAI-${crypto.randomUUID()}!aA1`;
  let userId = "";

  try {
    const created = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (created.error || !created.data.user?.id) {
      throw new Error(`Failed to create worker handoff user: ${safeMessage(created.error?.message ?? "no user")}`);
    }
    userId = created.data.user.id;

    const signedIn = await anon.auth.signInWithPassword({ email, password });
    const accessToken = signedIn.data.session?.access_token;
    if (signedIn.error || !accessToken) {
      throw new Error(`Failed to sign in worker handoff user: ${safeMessage(signedIn.error?.message ?? "no token")}`);
    }

    const headers = {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    };
    const createdCourse = await createQueuedCourse(baseUrl, headers, fetchImpl);
    const jobId = createdCourse.job?.id;
    const courseId = createdCourse.course?.id;
    if (!jobId || !courseId) {
      throw new Error("Worker handoff course creation did not return course and job ids.");
    }
    if (!["pending", "queued"].includes(createdCourse.job.status)) {
      throw new Error(`Worker handoff expected a queued job, got ${String(createdCourse.job.status)}.`);
    }

    const workerResult = await runWorkerOnce({
      appBaseUrl: baseUrl,
      internalWorkerSecret,
      jobId,
      fetchImpl,
    });
    if (Number(workerResult.processed ?? 0) < 1) {
      throw new Error("Worker handoff did not process the queued course job.");
    }

    const completedJob = await waitForJobStatus(baseUrl, headers, jobId, "succeeded", {
      fetchImpl,
      timeoutMs,
      pollMs,
    });
    const plannedCourse = await readCourse(baseUrl, headers, courseId, fetchImpl);
    const chapters = plannedCourse.course?.chapters ?? [];
    if (chapters.length < 1 || !chapters[0]?.generationJobId) {
      throw new Error("Worker handoff did not persist planned chapters and first chapter job.");
    }

    return {
      skipped: false,
      courseId,
      jobId,
      processed: Number(workerResult.processed ?? 0),
      jobStatus: completedJob.job.status,
      firstChapterJobId: chapters[0].generationJobId,
    };
  } finally {
    if (userId) {
      await service.auth.admin.deleteUser(userId).catch(() => undefined);
    }
  }
}

if (isDirectRun) {
  try {
    const result = await runWorkerHandoffSmoke();
    if (result.skipped) {
      console.log(result.message);
    } else {
      console.log(
        JSON.stringify(
          {
            courseId: result.courseId,
            jobId: result.jobId,
            processed: result.processed,
            jobStatus: result.jobStatus,
            firstChapterJobId: result.firstChapterJobId,
          },
          null,
          2,
        ),
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function createQueuedCourse(baseUrl, headers, fetchImpl) {
  const response = await fetchImpl(`${baseUrl}/api/courses`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      topic: "Worker Handoff Smoke",
      goal: "Verify a deployed queued course job is processed by the external worker.",
      background: "Temporary Beta smoke user",
      preference: "Concise explanations",
      weeklyHours: 1,
    }),
  });
  const json = await readJson(response);
  if (!response.ok) {
    throw new Error(`Worker handoff course creation failed with status ${response.status}: ${safeApiError(json)}`);
  }
  return json;
}

async function waitForJobStatus(baseUrl, headers, jobId, expectedStatus, {
  fetchImpl,
  timeoutMs,
  pollMs,
}) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = "missing";

  while (Date.now() < deadline) {
    const response = await fetchImpl(`${baseUrl}/api/generation-jobs/${jobId}`, {
      method: "GET",
      headers,
    });
    const json = await readJson(response);
    if (response.ok && json.job) {
      lastStatus = json.job.status;
      if (lastStatus === expectedStatus) return json;
      if (lastStatus === "failed") {
        throw new Error(`Worker handoff job failed: ${safeApiError(json.job)}`);
      }
    }
    await sleep(pollMs);
  }

  throw new Error(`Worker handoff timed out waiting for job ${jobId} to become ${expectedStatus}; last status ${lastStatus}.`);
}

async function readCourse(baseUrl, headers, courseId, fetchImpl) {
  const response = await fetchImpl(`${baseUrl}/api/courses/${courseId}`, {
    method: "GET",
    headers,
  });
  const json = await readJson(response);
  if (!response.ok) {
    throw new Error(`Worker handoff course read failed with status ${response.status}: ${safeApiError(json)}`);
  }
  return json;
}

function missingConfig(values) {
  return Object.entries(values)
    .filter(([, value]) => !value)
    .map(([name]) => envNameForOption(name));
}

function envNameForOption(name) {
  return {
    appBaseUrl: "APP_BASE_URL",
    internalWorkerSecret: "INTERNAL_WORKER_SECRET",
    supabaseUrl: "NEXT_PUBLIC_SUPABASE_URL",
    supabaseAnonKey: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    supabaseServiceRoleKey: "SUPABASE_SERVICE_ROLE_KEY",
  }[name] ?? name;
}

function normalizeBaseUrl(value) {
  const trimmed = String(value ?? "").trim().replace(/\/+$/u, "");
  if (!/^https?:\/\//iu.test(trimmed)) {
    throw new Error("APP_BASE_URL must be an absolute http(s) URL.");
  }
  return trimmed;
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function safeApiError(value) {
  if (typeof value?.error === "string") return safeMessage(value.error);
  if (typeof value?.message === "string") return safeMessage(value.message);
  if (typeof value?.status === "string") return safeMessage(value.status);
  return "request failed";
}

function safeMessage(value) {
  return String(value)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/giu, "Bearer [REDACTED]")
    .replace(/\b(?:sk|pk|sbp|eyJ)[A-Za-z0-9._~+/=-]{12,}/gu, "[REDACTED]")
    .replace(/\b[A-Za-z0-9+/]{32,}={0,2}\b/gu, "[REDACTED]");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
