import "./load-env.mjs";
import { pathToFileURL } from "node:url";

export const expectedSchemaVersion = "learnbyai-beta-2026-06-07-03";
const isDirectRun = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;

export async function checkBetaHealth({
  appBaseUrl = process.env.APP_BASE_URL,
  expectedExportsBucket = process.env.SUPABASE_EXPORTS_BUCKET || "learnbyai-exports",
  fetchImpl = globalThis.fetch,
} = {}) {
  const baseUrl = normalizeBaseUrl(appBaseUrl);
  if (!baseUrl) {
    throw new Error("APP_BASE_URL is required to check deployed Beta health.");
  }

  const response = await fetchImpl(`${baseUrl}/api/health/beta`, {
    method: "GET",
    headers: {
      accept: "application/json",
      "cache-control": "no-cache",
    },
    cache: "no-store",
  });
  const json = await readJson(response);
  if (!response.ok) {
    const status = "status" in response ? response.status : "unknown";
    throw new Error(`Beta health check failed with status ${status}: ${safeHealthMessage(json)}`);
  }

  if (json.expectedSchemaVersion !== expectedSchemaVersion) {
    throw new Error(
      `Beta health check expected schema mismatch: script expects ${expectedSchemaVersion}, app expects ${String(json.expectedSchemaVersion ?? "empty")}.`,
    );
  }
  if (json.actualSchemaVersion !== expectedSchemaVersion || json.ok !== true) {
    throw new Error(
      `Beta health check schema mismatch: expected ${expectedSchemaVersion}, got ${String(json.actualSchemaVersion ?? "empty")}.`,
    );
  }
  assertRuntimeHealth(json.runtime, { expectedExportsBucket });

  return json;
}

if (isDirectRun) {
  try {
    const result = await checkBetaHealth();
    console.log(
      JSON.stringify(
        {
          ok: result.ok,
          expectedSchemaVersion: result.expectedSchemaVersion,
          actualSchemaVersion: result.actualSchemaVersion,
          runtime: result.runtime,
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

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function safeHealthMessage(value) {
  const message = typeof value?.error === "string" ? value.error : "health check failed";
  return message.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [REDACTED]");
}

function assertRuntimeHealth(runtime, { expectedExportsBucket }) {
  const failures = [];
  const storage = runtime?.exportStorage;
  if (runtime?.supabaseConfigured !== true) failures.push("Supabase server config is not active");
  if (runtime?.aiProviderConfigured !== true) failures.push("AI provider config is incomplete on the deployed app");
  if (runtime?.aiMockMode !== false) failures.push("AI mock mode is active on the deployed app");
  if (runtime?.workerMode !== "external") failures.push(`worker mode is ${String(runtime?.workerMode ?? "missing")}`);
  if (runtime?.workerSecretConfigured !== true) failures.push("internal worker secret is not configured on the deployed app");
  if (!runtime?.exportsBucket) {
    failures.push("export bucket is not configured");
  } else if (runtime.exportsBucket !== expectedExportsBucket) {
    failures.push(`export bucket is ${String(runtime.exportsBucket)}, expected ${expectedExportsBucket}`);
  }
  if (storage?.bucketExists !== true) failures.push("export Storage bucket is missing");
  if (storage?.private !== true) failures.push("export Storage bucket is not private");
  if (storage?.fileSizeLimit !== 10_485_760) {
    failures.push(`export Storage file size limit is ${String(storage?.fileSizeLimit ?? "missing")}`);
  }
  if (Array.isArray(storage?.missingMimeTypes) && storage.missingMimeTypes.length > 0) {
    failures.push(`export Storage bucket missing MIME types: ${storage.missingMimeTypes.join(", ")}`);
  }

  if (failures.length > 0) {
    throw new Error(`Beta health check runtime mismatch: ${failures.join("; ")}.`);
  }
}
