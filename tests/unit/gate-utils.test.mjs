import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createBetaGateEnv, createLocalGateEnv, normalizeEnv, npmStep } from "../../scripts/gate-utils.mjs";

test("local phase gate env isolates real Supabase and AI credentials", () => {
  const env = createLocalGateEnv({
    NEXT_PUBLIC_SUPABASE_URL: "https://learnbyai.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    SUPABASE_SERVICE_ROLE_KEY: "service",
    AI_API_KEY: "sk-live-should-not-leak",
    INTERNAL_WORKER_SECRET: "custom-secret",
  });

  assert.equal(env.AI_MOCK_MODE, "true");
  assert.equal(env.AI_API_KEY, "");
  assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, "");
  assert.equal(env.NEXT_PUBLIC_SUPABASE_ANON_KEY, "");
  assert.equal(env.SUPABASE_SERVICE_ROLE_KEY, "");
  assert.equal(env.INTERNAL_WORKER_SECRET, "custom-secret");
});

test("beta gate env enables strict live verification flags", () => {
  const env = createBetaGateEnv({
    AI_API_KEY: "sk-live",
    INTERNAL_WORKER_SECRET: "worker",
  });

  assert.equal(env.AI_MOCK_MODE, "false");
  assert.equal(env.AI_SMOKE, "true");
  assert.equal(env.AI_SMOKE_REQUIRED, "true");
  assert.equal(env.BETA_READINESS_STRICT, "true");
  assert.equal(env.SUPABASE_SMOKE_REQUIRED, "true");
  assert.equal(env.SUPABASE_SMOKE_RLS, "true");
  assert.equal(env.WORKER_HANDOFF_REQUIRED, "true");
});

test("npmStep records npm script command arguments", () => {
  const env = { AI_MOCK_MODE: "true" };
  const step = npmStep("unit tests", "test:unit", env);

  assert.equal(step.label, "unit tests");
  assert.match(step.display ?? [step.command, ...step.args].join(" "), /npm(.cmd)? run test:unit/);
  assert.equal(step.env, env);
});

test("normalizeEnv drops invalid spawn env entries", () => {
  assert.deepEqual(normalizeEnv({ VALID: 123, "bad=key": "value", EMPTY: "", UNSET: undefined }), {
    VALID: "123",
    EMPTY: "",
  });
});

test("beta gate checks deployed health before external worker handoff and real AI smoke", () => {
  const source = readFileSync("scripts/run-beta-gate.mjs", "utf8");
  const healthIndex = source.indexOf('npmStep("deployed beta health", "test:beta-health", betaEnv)');
  const workerIndex = source.indexOf('npmStep("external worker handoff", "test:worker-handoff", betaEnv)');
  const aiSmokeIndex = source.indexOf('npmStep("real AI smoke", "test:ai-smoke", betaEnv)');

  assert.notEqual(healthIndex, -1);
  assert.notEqual(workerIndex, -1);
  assert.notEqual(aiSmokeIndex, -1);
  assert.ok(healthIndex < workerIndex);
  assert.ok(workerIndex < aiSmokeIndex);
});
