import "./load-env.mjs";

const requiredSupabase = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
];
const requiredAi = ["AI_API_BASE_URL", "AI_API_KEY", "AI_MODEL"];
const agentPrefixes = ["ARCHITECT", "AUTHOR", "POLISHER", "REVIEWER", "TUTOR"];
const defaultExportsBucket = "learnbyai-exports";
const strict = process.env.BETA_READINESS_STRICT === "true";
const quotaVariables = [
  "QUOTA_CREATE_COURSE",
  "QUOTA_GENERATE_CHAPTER",
  "QUOTA_ASK_TUTOR",
  "QUOTA_EXPORT",
];
const strictQuotaMinimums = {
  QUOTA_CREATE_COURSE: 1,
  QUOTA_GENERATE_CHAPTER: 1,
  QUOTA_ASK_TUTOR: 1,
  QUOTA_EXPORT: 2,
};

const checks = [
  checkSupabaseConfig(),
  checkAiConfig(),
  checkAgentOverrides(),
  checkStorageConfig(),
  checkWorkerConfig(),
  checkQuotaConfig(),
  checkSmokeConfig(),
  checkSecretHygiene(),
];

const failed = checks.filter((check) => check.status === "fail");
const warned = checks.filter((check) => check.status === "warn");

for (const check of checks) {
  const marker = check.status === "pass" ? "PASS" : check.status === "warn" ? "WARN" : "FAIL";
  console.log(`${marker} ${check.name}: ${check.message}`);
}

if (failed.length > 0) {
  console.error(`Beta readiness failed: ${failed.length} required check(s) failed.`);
  process.exit(1);
}

if (warned.length > 0) {
  console.log(`Beta readiness passed with ${warned.length} warning(s).`);
} else {
  console.log("Beta readiness passed.");
}

function checkSupabaseConfig() {
  const missing = missingEnv(requiredSupabase);
  if (missing.length > 0) {
    return fail("Supabase config", `missing ${missing.join(", ")}; live auth/database/RLS cannot be verified.`);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) {
    return warn("Supabase config", "NEXT_PUBLIC_SUPABASE_URL is set but does not look like a hosted Supabase URL.");
  }

  return pass("Supabase config", "required Supabase variables are set.");
}

function checkAiConfig() {
  const missing = missingEnv(requiredAi);
  if (missing.length > 0) {
    return fail("AI config", `missing ${missing.join(", ")}; real provider smoke cannot run.`);
  }

  if (process.env.AI_MOCK_MODE === "true") {
    return fail("AI config", "AI_MOCK_MODE=true; Beta real provider mode requires AI_MOCK_MODE=false or unset.");
  }

  return pass("AI config", "real provider variables are set.");
}

function checkAgentOverrides() {
  const findings = [];

  for (const prefix of agentPrefixes) {
    const baseUrl = process.env[`${prefix}_API_BASE_URL`];
    const temperature = process.env[`${prefix}_TEMPERATURE`];
    const maxTokens = process.env[`${prefix}_MAX_TOKENS`];

    if (baseUrl && !/^https?:\/\/[^/]+/i.test(baseUrl)) {
      findings.push(`${prefix}_API_BASE_URL must be an absolute http(s) URL`);
    }
    if (temperature && !isFiniteNumber(temperature)) {
      findings.push(`${prefix}_TEMPERATURE must be a number`);
    }
    if (maxTokens && (!/^\d+$/.test(maxTokens) || Number(maxTokens) <= 0)) {
      findings.push(`${prefix}_MAX_TOKENS must be a positive integer`);
    }
  }

  if (findings.length > 0) {
    return fail("Agent overrides", findings.join("; ") + ".");
  }

  return pass("Agent overrides", "optional per-agent overrides are valid.");
}

function checkStorageConfig() {
  const bucket = process.env.SUPABASE_EXPORTS_BUCKET || defaultExportsBucket;
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,62}$/.test(bucket)) {
    return fail(
      "Storage config",
      "SUPABASE_EXPORTS_BUCKET must be 3-63 characters and contain only letters, numbers, underscores, or hyphens.",
    );
  }

  if (strict && bucket !== defaultExportsBucket) {
    return fail(
      "Storage config",
      `strict mode expects SUPABASE_EXPORTS_BUCKET=${defaultExportsBucket}; update supabase/schema.sql and Storage policies before using a custom bucket.`,
    );
  }

  if (bucket !== defaultExportsBucket) {
    return warn(
      "Storage config",
      `using custom SUPABASE_EXPORTS_BUCKET; ensure supabase/schema.sql and Storage policies target ${bucket}.`,
    );
  }

  return pass("Storage config", `export bucket is ${defaultExportsBucket}.`);
}

function checkWorkerConfig() {
  const hasSupabase = missingEnv(requiredSupabase).length === 0;
  if (!hasSupabase) {
    return warn("Worker config", "skipping strict worker check until Supabase config is present.");
  }

  if (!process.env.APP_BASE_URL) {
    const message = "APP_BASE_URL is required so durable workers and live smoke can call the deployed app.";
    return strict ? fail("Worker config", message) : warn("Worker config", message);
  }

  if (!/^https?:\/\/[^/]+/i.test(process.env.APP_BASE_URL)) {
    return fail("Worker config", "APP_BASE_URL must be an absolute http(s) URL.");
  }

  if (strict && isLocalAppBaseUrl(process.env.APP_BASE_URL)) {
    return fail("Worker config", "APP_BASE_URL must point to the deployed Beta app in strict mode, not localhost.");
  }

  if (!process.env.INTERNAL_WORKER_SECRET) {
    return fail("Worker config", "INTERNAL_WORKER_SECRET is required when Supabase is configured.");
  }

  if (process.env.GENERATION_WORKER_MODE !== "external") {
    const message = "GENERATION_WORKER_MODE is not external; production Beta should use a durable cron/queue.";
    return strict ? fail("Worker config", message) : warn("Worker config", `${message} Acceptable for local smoke.`);
  }

  return pass("Worker config", "internal worker secret and external worker mode are set.");
}

function checkQuotaConfig() {
  const invalid = quotaVariables.filter((name) => {
    const value = process.env[name];
    return value && (!/^\d+$/.test(value) || Number(value) <= 0);
  });

  if (invalid.length > 0) {
    return fail("Quota config", `invalid positive integer values: ${invalid.join(", ")}.`);
  }

  const unset = quotaVariables.filter((name) => !process.env[name]);
  if (unset.length > 0) {
    const message = `using code defaults for ${unset.join(", ")}.`;
    return strict ? fail("Quota config", `strict mode requires explicit quota values; ${message}`) : warn("Quota config", message);
  }

  if (strict) {
    const tooSmall = quotaVariables.filter((name) => Number(process.env[name]) < strictQuotaMinimums[name]);
    if (tooSmall.length > 0) {
      return fail(
        "Quota config",
        `strict live smoke requires minimum quota values: ${tooSmall
          .map((name) => `${name}>=${strictQuotaMinimums[name]}`)
          .join(", ")}.`,
      );
    }
  }

  return pass("Quota config", "all quota overrides are valid.");
}

function checkSmokeConfig() {
  const missing = [];
  if (process.env.SUPABASE_SMOKE_RLS !== "true") missing.push("SUPABASE_SMOKE_RLS=true");
  if (process.env.SUPABASE_SMOKE_REQUIRED !== "true") missing.push("SUPABASE_SMOKE_REQUIRED=true");
  if (process.env.WORKER_HANDOFF_REQUIRED !== "true") missing.push("WORKER_HANDOFF_REQUIRED=true");
  if (process.env.AI_SMOKE !== "true") missing.push("AI_SMOKE=true");
  if (process.env.AI_SMOKE_REQUIRED !== "true") missing.push("AI_SMOKE_REQUIRED=true");

  if (missing.length > 0) {
    const message = `set ${missing.join(" and ")} before final live Beta verification.`;
    return strict ? fail("Smoke config", message) : warn("Smoke config", message);
  }

  return pass("Smoke config", "live smoke flags are enabled.");
}

function checkSecretHygiene() {
  const findings = [];

  for (const name of [
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "AI_API_KEY",
    "INTERNAL_WORKER_SECRET",
  ]) {
    if (isPlaceholderSecret(process.env[name])) {
      findings.push(`${name} looks like a placeholder`);
    }
  }

  if (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
    process.env.SUPABASE_SERVICE_ROLE_KEY &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY === process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    findings.push("Supabase anon and service role keys must be different");
  }

  if (strict && process.env.INTERNAL_WORKER_SECRET && process.env.INTERNAL_WORKER_SECRET.length < 32) {
    findings.push("INTERNAL_WORKER_SECRET must be at least 32 characters in strict mode");
  }

  if (findings.length > 0) {
    return fail("Secret hygiene", findings.join("; ") + ".");
  }

  return pass("Secret hygiene", "configured secrets are present and not obvious placeholders.");
}

function missingEnv(names) {
  return names.filter((name) => !process.env[name]);
}

function isPlaceholderSecret(value) {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return (
    normalized.length < 8 ||
    normalized.includes("your_") ||
    normalized.includes("your-") ||
    normalized.includes("example") ||
    normalized.includes("placeholder") ||
    normalized.includes("change-me") ||
    normalized.includes("changeme") ||
    normalized.endsWith("-key") ||
    normalized.endsWith("_key") ||
    normalized === "anon" ||
    normalized === "service" ||
    normalized === "service-role-key" ||
    normalized === "worker-secret"
  );
}

function isFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed);
}

function isLocalAppBaseUrl(value) {
  try {
    const { hostname } = new URL(value);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

function pass(name, message) {
  return { name, message, status: "pass" };
}

function warn(name, message) {
  return { name, message, status: "warn" };
}

function fail(name, message) {
  return { name, message, status: "fail" };
}
