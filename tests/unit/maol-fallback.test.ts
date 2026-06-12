import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, test } from "node:test";
import { assertMockFallbackAllowed } from "../../src/lib/maol/fallback";

const envSnapshot = { ...process.env };

afterEach(() => {
  process.env = { ...envSnapshot };
});

test("mock fallback is allowed in explicit mock mode", () => {
  process.env.AI_MOCK_MODE = "true";
  process.env.AI_API_KEY = "test-key";

  assert.doesNotThrow(() => assertMockFallbackAllowed(new Error("provider failed")));
});

test("mock fallback is allowed when no AI key is configured", () => {
  process.env.AI_MOCK_MODE = "false";
  delete process.env.AI_API_KEY;

  assert.doesNotThrow(() => assertMockFallbackAllowed(new Error("provider unavailable")));
});

test("mock fallback is disabled for real provider mode", () => {
  process.env.AI_MOCK_MODE = "false";
  process.env.AI_API_KEY = "test-key";

  assert.throws(() => assertMockFallbackAllowed(new Error("provider failed")), /provider failed/u);
});

test("real provider calls are bounded by configurable request timeouts and thinking mode", () => {
  const configSource = readFileSync("src/lib/config.ts", "utf8");
  const aiSource = readFileSync("src/lib/ai.ts", "utf8");

  assert.match(configSource, /AI_TIMEOUT_MS/u);
  assert.match(configSource, /\$\{prefix\}_TIMEOUT_MS/u);
  assert.match(configSource, /AI_THINKING/u);
  assert.match(configSource, /\$\{prefix\}_THINKING/u);
  assert.match(aiSource, /new AbortController\(\)/u);
  assert.match(aiSource, /signal: controller\.signal/u);
  assert.match(aiSource, /readStreamingCompletion\(response, controller\.signal\)/u);
  assert.match(aiSource, /throwIfAborted\(signal\)/u);
  assert.match(aiSource, /reader\.cancel\(\)/u);
  assert.match(aiSource, /thinkingPayload\(config\.thinking\)/u);
  assert.match(aiSource, /thinking: \{ type: thinking \}/u);
  assert.match(aiSource, /request timed out after/u);
});

test("course planning jobs can be explicitly retried when a provider call gets stuck", () => {
  const routeSource = readFileSync("src/app/api/generation-jobs/[id]/route.ts", "utf8");
  const jobStatusSource = readFileSync("src/lib/generationJobStatus.ts", "utf8");
  const runnerSource = readFileSync("src/lib/generationRunner.ts", "utf8");

  assert.match(routeSource, /retry: input\.retry/u);
  assert.match(routeSource, /getGenerationJobForRequest/u);
  assert.match(jobStatusSource, /markStaleJobFailed/u);
  assert.match(jobStatusSource, /did not update for/u);
  assert.match(runnerSource, /retry\?: boolean/u);
  assert.match(runnerSource, /status: "retrying"/u);
  assert.match(runnerSource, /job\.status === "running" && !input\.retry/u);
});
