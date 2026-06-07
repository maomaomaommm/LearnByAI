import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = "scripts/beta-readiness.mjs";

test("beta readiness fails without required Supabase and AI variables", () => {
  const result = runReadiness({});
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /FAIL Supabase config/);
  assert.match(result.stdout, /FAIL AI config/);
});

test("beta readiness passes with required variables and does not print secret values", () => {
  const secret = "sk-live-should-not-print";
  const result = runReadiness({
    NEXT_PUBLIC_SUPABASE_URL: "https://learnbyai.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb-anon-live-secret-value",
    SUPABASE_SERVICE_ROLE_KEY: "sb-service-role-live-secret-value",
    AI_API_BASE_URL: "https://api.example.test/v1",
    AI_API_KEY: secret,
    AI_MODEL: "gpt-5.5",
    APP_BASE_URL: "https://learnbyai.example.com",
    INTERNAL_WORKER_SECRET: "worker-secret-with-at-least-32-chars",
    GENERATION_WORKER_MODE: "external",
    SUPABASE_SMOKE_RLS: "true",
    SUPABASE_SMOKE_REQUIRED: "true",
    AI_SMOKE: "true",
    AI_SMOKE_REQUIRED: "true",
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /PASS Supabase config/);
  assert.match(result.stdout, /PASS AI config/);
  assert.doesNotMatch(result.stdout, new RegExp(secret));
  assert.doesNotMatch(result.stderr, new RegExp(secret));
});

test("strict beta readiness requires enough quota for live smoke", () => {
  const result = runReadiness({
    NEXT_PUBLIC_SUPABASE_URL: "https://learnbyai.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb-anon-live-secret-value",
    SUPABASE_SERVICE_ROLE_KEY: "sb-service-role-live-secret-value",
    AI_API_BASE_URL: "https://api.example.test/v1",
    AI_API_KEY: "sk-live-should-not-print",
    AI_MODEL: "gpt-5.5",
    APP_BASE_URL: "https://learnbyai.example.com",
    INTERNAL_WORKER_SECRET: "worker-secret-with-at-least-32-chars",
    GENERATION_WORKER_MODE: "external",
    BETA_READINESS_STRICT: "true",
    SUPABASE_SMOKE_RLS: "true",
    SUPABASE_SMOKE_REQUIRED: "true",
    WORKER_HANDOFF_REQUIRED: "true",
    AI_SMOKE: "true",
    AI_SMOKE_REQUIRED: "true",
    QUOTA_CREATE_COURSE: "1",
    QUOTA_GENERATE_CHAPTER: "1",
    QUOTA_ASK_TUTOR: "1",
    QUOTA_EXPORT: "1",
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL Quota config/);
  assert.match(result.stdout, /QUOTA_EXPORT>=2/);
});

test("beta readiness validates optional per-agent override formats", () => {
  const result = runReadiness({
    NEXT_PUBLIC_SUPABASE_URL: "https://learnbyai.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb-anon-live-secret-value",
    SUPABASE_SERVICE_ROLE_KEY: "sb-service-role-live-secret-value",
    AI_API_BASE_URL: "https://api.example.test/v1",
    AI_API_KEY: "sk-live-should-not-print",
    AI_MODEL: "gpt-5.5",
    APP_BASE_URL: "https://learnbyai.example.com",
    INTERNAL_WORKER_SECRET: "worker-secret-with-at-least-32-chars",
    GENERATION_WORKER_MODE: "external",
    SUPABASE_SMOKE_RLS: "true",
    SUPABASE_SMOKE_REQUIRED: "true",
    WORKER_HANDOFF_REQUIRED: "true",
    AI_SMOKE: "true",
    AI_SMOKE_REQUIRED: "true",
    AUTHOR_API_BASE_URL: "api.example.test/v1",
    REVIEWER_TEMPERATURE: "warm",
    TUTOR_MAX_TOKENS: "0",
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL Agent overrides/);
  assert.match(result.stdout, /AUTHOR_API_BASE_URL/);
  assert.match(result.stdout, /REVIEWER_TEMPERATURE/);
  assert.match(result.stdout, /TUTOR_MAX_TOKENS/);
  assert.doesNotMatch(result.stdout, /sk-live-should-not-print/);
});

test("beta readiness rejects invalid export bucket names", () => {
  const result = runReadiness({
    NEXT_PUBLIC_SUPABASE_URL: "https://learnbyai.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb-anon-live-secret-value",
    SUPABASE_SERVICE_ROLE_KEY: "sb-service-role-live-secret-value",
    SUPABASE_EXPORTS_BUCKET: "../exports",
    AI_API_BASE_URL: "https://api.example.test/v1",
    AI_API_KEY: "sk-live-should-not-print",
    AI_MODEL: "gpt-5.5",
    APP_BASE_URL: "https://learnbyai.example.com",
    INTERNAL_WORKER_SECRET: "worker-secret-with-at-least-32-chars",
    GENERATION_WORKER_MODE: "external",
    SUPABASE_SMOKE_RLS: "true",
    SUPABASE_SMOKE_REQUIRED: "true",
    WORKER_HANDOFF_REQUIRED: "true",
    AI_SMOKE: "true",
    AI_SMOKE_REQUIRED: "true",
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL Storage config/);
  assert.match(result.stdout, /SUPABASE_EXPORTS_BUCKET/);
  assert.doesNotMatch(result.stdout, /\.\.\/exports/);
});

test("strict beta readiness rejects a custom export bucket without schema and policy updates", () => {
  const result = runReadiness({
    NEXT_PUBLIC_SUPABASE_URL: "https://learnbyai.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb-anon-live-secret-value",
    SUPABASE_SERVICE_ROLE_KEY: "sb-service-role-live-secret-value",
    SUPABASE_EXPORTS_BUCKET: "custom-exports",
    AI_API_BASE_URL: "https://api.example.test/v1",
    AI_API_KEY: "sk-live-should-not-print",
    AI_MODEL: "gpt-5.5",
    APP_BASE_URL: "https://learnbyai.example.com",
    INTERNAL_WORKER_SECRET: "worker-secret-with-at-least-32-chars",
    GENERATION_WORKER_MODE: "external",
    BETA_READINESS_STRICT: "true",
    SUPABASE_SMOKE_RLS: "true",
    SUPABASE_SMOKE_REQUIRED: "true",
    WORKER_HANDOFF_REQUIRED: "true",
    AI_SMOKE: "true",
    AI_SMOKE_REQUIRED: "true",
    QUOTA_CREATE_COURSE: "1",
    QUOTA_GENERATE_CHAPTER: "1",
    QUOTA_ASK_TUTOR: "1",
    QUOTA_EXPORT: "2",
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL Storage config/);
  assert.match(result.stdout, /learnbyai-exports/);
  assert.doesNotMatch(result.stdout, /sk-live-should-not-print/);
});

test("strict beta readiness requires smoke tests to be marked required", () => {
  const result = runReadiness({
    NEXT_PUBLIC_SUPABASE_URL: "https://learnbyai.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb-anon-live-secret-value",
    SUPABASE_SERVICE_ROLE_KEY: "sb-service-role-live-secret-value",
    AI_API_BASE_URL: "https://api.example.test/v1",
    AI_API_KEY: "sk-live-should-not-print",
    AI_MODEL: "gpt-5.5",
    APP_BASE_URL: "https://learnbyai.example.com",
    INTERNAL_WORKER_SECRET: "worker-secret-with-at-least-32-chars",
    GENERATION_WORKER_MODE: "external",
    BETA_READINESS_STRICT: "true",
    SUPABASE_SMOKE_RLS: "true",
    AI_SMOKE: "true",
    QUOTA_CREATE_COURSE: "1",
    QUOTA_GENERATE_CHAPTER: "1",
    QUOTA_ASK_TUTOR: "1",
    QUOTA_EXPORT: "2",
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL Smoke config/);
  assert.match(result.stdout, /SUPABASE_SMOKE_REQUIRED=true/);
  assert.match(result.stdout, /WORKER_HANDOFF_REQUIRED=true/);
  assert.match(result.stdout, /AI_SMOKE_REQUIRED=true/);
});

test("strict beta readiness requires an absolute app base URL", () => {
  const result = runReadiness({
    NEXT_PUBLIC_SUPABASE_URL: "https://learnbyai.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb-anon-live-secret-value",
    SUPABASE_SERVICE_ROLE_KEY: "sb-service-role-live-secret-value",
    AI_API_BASE_URL: "https://api.example.test/v1",
    AI_API_KEY: "sk-live-should-not-print",
    AI_MODEL: "gpt-5.5",
    INTERNAL_WORKER_SECRET: "worker-secret-with-at-least-32-chars",
    GENERATION_WORKER_MODE: "external",
    BETA_READINESS_STRICT: "true",
    SUPABASE_SMOKE_RLS: "true",
    SUPABASE_SMOKE_REQUIRED: "true",
    WORKER_HANDOFF_REQUIRED: "true",
    AI_SMOKE: "true",
    AI_SMOKE_REQUIRED: "true",
    QUOTA_CREATE_COURSE: "1",
    QUOTA_GENERATE_CHAPTER: "1",
    QUOTA_ASK_TUTOR: "1",
    QUOTA_EXPORT: "2",
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL Worker config/);
  assert.match(result.stdout, /APP_BASE_URL/);
});

test("strict beta readiness rejects localhost app base URL", () => {
  const result = runReadiness({
    NEXT_PUBLIC_SUPABASE_URL: "https://learnbyai.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb-anon-live-secret-value",
    SUPABASE_SERVICE_ROLE_KEY: "sb-service-role-live-secret-value",
    AI_API_BASE_URL: "https://api.example.test/v1",
    AI_API_KEY: "sk-live-should-not-print",
    AI_MODEL: "gpt-5.5",
    APP_BASE_URL: "http://localhost:3100",
    INTERNAL_WORKER_SECRET: "worker-secret-with-at-least-32-chars",
    GENERATION_WORKER_MODE: "external",
    BETA_READINESS_STRICT: "true",
    SUPABASE_SMOKE_RLS: "true",
    SUPABASE_SMOKE_REQUIRED: "true",
    WORKER_HANDOFF_REQUIRED: "true",
    AI_SMOKE: "true",
    AI_SMOKE_REQUIRED: "true",
    QUOTA_CREATE_COURSE: "1",
    QUOTA_GENERATE_CHAPTER: "1",
    QUOTA_ASK_TUTOR: "1",
    QUOTA_EXPORT: "2",
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL Worker config/);
  assert.match(result.stdout, /deployed Beta app/);
});

test("beta readiness rejects obvious placeholder secrets without printing values", () => {
  const result = runReadiness({
    NEXT_PUBLIC_SUPABASE_URL: "https://learnbyai.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "anon-key",
    AI_API_BASE_URL: "https://api.example.test/v1",
    AI_API_KEY: "your_api_key",
    AI_MODEL: "gpt-5.5",
    APP_BASE_URL: "https://learnbyai.example.com",
    INTERNAL_WORKER_SECRET: "worker-secret-with-at-least-32-chars",
    GENERATION_WORKER_MODE: "external",
    SUPABASE_SMOKE_RLS: "true",
    SUPABASE_SMOKE_REQUIRED: "true",
    WORKER_HANDOFF_REQUIRED: "true",
    AI_SMOKE: "true",
    AI_SMOKE_REQUIRED: "true",
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL Secret hygiene/);
  assert.match(result.stdout, /NEXT_PUBLIC_SUPABASE_ANON_KEY looks like a placeholder/);
  assert.match(result.stdout, /Supabase anon and service role keys must be different/);
  assert.doesNotMatch(result.stdout, /your_api_key/);
  assert.doesNotMatch(result.stdout, /anon-key/);
});

test("strict beta readiness requires a strong worker secret", () => {
  const result = runReadiness({
    NEXT_PUBLIC_SUPABASE_URL: "https://learnbyai.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb-anon-live-secret-value",
    SUPABASE_SERVICE_ROLE_KEY: "sb-service-role-live-secret-value",
    AI_API_BASE_URL: "https://api.example.test/v1",
    AI_API_KEY: "sk-live-should-not-print",
    AI_MODEL: "gpt-5.5",
    APP_BASE_URL: "https://learnbyai.example.com",
    INTERNAL_WORKER_SECRET: "short-secret",
    GENERATION_WORKER_MODE: "external",
    BETA_READINESS_STRICT: "true",
    SUPABASE_SMOKE_RLS: "true",
    SUPABASE_SMOKE_REQUIRED: "true",
    WORKER_HANDOFF_REQUIRED: "true",
    AI_SMOKE: "true",
    AI_SMOKE_REQUIRED: "true",
    QUOTA_CREATE_COURSE: "1",
    QUOTA_GENERATE_CHAPTER: "1",
    QUOTA_ASK_TUTOR: "1",
    QUOTA_EXPORT: "2",
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL Secret hygiene/);
  assert.match(result.stdout, /INTERNAL_WORKER_SECRET must be at least 32 characters/);
  assert.doesNotMatch(result.stdout, /short-secret/);
});

function runReadiness(env) {
  const cleanEnv = {
    PATH: process.env.PATH,
    Path: process.env.Path,
    SystemRoot: process.env.SystemRoot,
    ComSpec: process.env.ComSpec,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    NODE_OPTIONS: process.env.NODE_OPTIONS,
    ...env,
  };

  return spawnSync(process.execPath, [script], {
    cwd: process.cwd(),
    env: cleanEnv,
    encoding: "utf8",
  });
}
