import "./load-env.mjs";
import { pathToFileURL } from "node:url";

const isDirectRun = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;

export async function runGenerationWorkerOnce({
  appBaseUrl = process.env.APP_BASE_URL,
  internalWorkerSecret = process.env.INTERNAL_WORKER_SECRET,
  jobId = process.env.GENERATION_WORKER_JOB_ID,
  limit = process.env.GENERATION_WORKER_LIMIT,
  fetchImpl = globalThis.fetch,
} = {}) {
  const baseUrl = normalizeBaseUrl(appBaseUrl);
  if (!baseUrl) {
    throw new Error("APP_BASE_URL is required to run the external generation worker.");
  }
  if (!internalWorkerSecret) {
    throw new Error("INTERNAL_WORKER_SECRET is required to run the external generation worker.");
  }

  const body = {};
  if (jobId) body.jobId = jobId;
  if (limit) body.limit = readPositiveInteger(limit, "GENERATION_WORKER_LIMIT");

  const response = await fetchImpl(`${baseUrl}/api/internal/generation-worker`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${internalWorkerSecret}`,
    },
    body: JSON.stringify(body),
  });

  const json = await readJson(response);
  if (!response.ok) {
    const status = "status" in response ? response.status : "unknown";
    throw new Error(`Generation worker request failed with status ${status}: ${safeResponseMessage(json)}`);
  }

  return json;
}

if (isDirectRun) {
  try {
    const result = await runGenerationWorkerOnce();
    console.log(
      JSON.stringify(
        {
          processed: result.processed ?? 0,
          results: Array.isArray(result.results) ? result.results.length : 0,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function normalizeBaseUrl(value) {
  if (!value) return "";
  const trimmed = value.trim().replace(/\/+$/u, "");
  if (!/^https?:\/\//iu.test(trimmed)) {
    throw new Error("APP_BASE_URL must be an absolute http(s) URL.");
  }
  return trimmed;
}

function readPositiveInteger(value, label) {
  if (!/^\d+$/u.test(String(value))) {
    throw new Error(`${label} must be a positive integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function safeResponseMessage(value) {
  const message = typeof value?.error === "string" ? value.error : "worker request failed";
  return message.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [REDACTED]");
}
