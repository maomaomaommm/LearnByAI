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

test("mock fallback is disabled when user overrides provide an API key", () => {
  process.env.AI_MOCK_MODE = "false";
  delete process.env.AI_API_KEY;

  const overrides = { version: 1 as const, default: { apiKey: "test-key" } };
  assert.throws(() => assertMockFallbackAllowed(new Error("provider failed"), overrides), /provider failed/u);
});

test("real provider calls are bounded by configurable request timeouts and thinking mode", () => {
  const configSource = readFileSync("src/lib/config.ts", "utf8");
  const aiSource = readFileSync("src/lib/ai.ts", "utf8");
  const testModelSource = readFileSync("src/app/api/test-model/route.ts", "utf8");

  assert.match(configSource, /AI_TIMEOUT_MS/u);
  assert.match(configSource, /\$\{prefix\}_TIMEOUT_MS/u);
  assert.match(configSource, /AI_THINKING/u);
  assert.match(configSource, /\$\{prefix\}_THINKING/u);
  assert.match(aiSource, /new AbortController\(\)/u);
  assert.match(aiSource, /signal: controller\.signal/u);
  assert.match(aiSource, /readStreamingCompletion\(response, controller\.signal/u);
  assert.match(aiSource, /throwIfAborted\(signal\)/u);
  assert.match(aiSource, /reader\.cancel\(\)/u);
  assert.match(aiSource, /thinkingPayload\(config\.model,\s*config\.thinking\)/u);
  assert.match(aiSource, /thinking: \{ type: "enabled" \}/u);
  assert.match(aiSource, /thinking !== "enabled"/u);
  assert.match(aiSource, /isKimiThinkingModel\(model\)/u);
  assert.match(aiSource, /isKimiK27CodeModel\(model\)\) return 1/u);
  assert.match(aiSource, /isKimiThinkingModel\(model\) && thinking !== "auto"\) return 0\.6/u);
  assert.match(aiSource, /compatibleTemperature\(config\.model,\s*options\?\.temperature \?\? config\.temperature,\s*config\.thinking\)/u);
  assert.match(aiSource, /reasoning_content/u);
  assert.match(aiSource, /thinking mode likely consumed the output tokens/u);
  assert.match(aiSource, /request timed out after/u);
  assert.match(testModelSource, /MODEL_TEST_TIMEOUT_MS/u);
  assert.match(testModelSource, /getBaseAIConfig/u);
});

test("Kimi thinking failures are diagnosed without treating reasoning as content", () => {
  const aiSource = readFileSync("src/lib/ai.ts", "utf8");

  assert.match(aiSource, /function extractCompletion\(data: unknown\): CompletionExtraction/u);
  assert.match(aiSource, /message\.reasoning_content/u);
  assert.match(aiSource, /reasoningLength: reasoning\.length/u);
  assert.doesNotMatch(aiSource, /return reasoning/u);
});

test("review repair prefers deterministic fixes and bounded author rewrites", () => {
  const clientSource = readFileSync("src/lib/maol/client.ts", "utf8");

  assert.match(clientSource, /reviewChapterWithRepair/u);
  assert.match(clientSource, /repairChapterContentByAuthor/u);
  assert.match(clientSource, /repairChapterInChunksByAuthor/u);
  assert.match(clientSource, /buildChapterRepairByAuthorPrompt/u);
  assert.match(clientSource, /buildChapterChunkRepairByAuthorPrompt/u);
  assert.match(clientSource, /runInBatches/u);
  assert.match(clientSource, /REPAIR_CHUNK_CONCURRENCY/u);
  assert.match(clientSource, /validateRepairedChunk/u);
  assert.match(clientSource, /repair returned empty content/u);
  assert.match(clientSource, /repair returned conversational text/u);
  assert.match(clientSource, /repair wrapped the whole result in a code fence/u);
  assert.match(clientSource, /repair shortened content too aggressively/u);
  assert.match(clientSource, /repair lost heading/u);
  assert.match(clientSource, /shouldEscalateToAuthorRewrite/u);
  assert.match(clientSource, /hasCatastrophicDraftSignal/u);
  assert.match(clientSource, /score < 50 && hasCatastrophicDraftSignal/u);
  assert.match(clientSource, /review_repair\.author_rewrite_required/u);
  assert.match(clientSource, /requires full AUTHOR regeneration/u);
  assert.match(clientSource, /withAuthorRewriteRequiredIssue/u);
  assert.match(clientSource, /CHUNKED_REPAIR_MIN_CHARS = 8_000/u);
  assert.match(clientSource, /REPAIR_CHUNK_MAX_CHARS = 2_400/u);
  assert.match(clientSource, /REPAIR_CHUNK_MAX_TOKENS = 4_096/u);
  assert.match(clientSource, /MAX_REVIEW_REPAIR_ATTEMPTS = 3/u);
  assert.match(clientSource, /MAX_LONG_TEXT_REPAIR_ATTEMPTS = 3/u);
  assert.match(clientSource, /CHUNKED_FORMAT_GUARD_MIN_CHARS = 8_000/u);
  assert.doesNotMatch(clientSource, /return postRepairMarkdown\(currentContent\)/u);
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

test("review status uses score and severity instead of reviewer passed flag alone", () => {
  const clientSource = readFileSync("src/lib/maol/client.ts", "utf8");

  assert.doesNotMatch(clientSource, /reviewer\.passed === false \|\| issues\.some/u);
  assert.match(clientSource, /issues\.some\(\(issue\) => issue\.severity === "error"\) \|\| score < 80/u);
  assert.match(clientSource, /formatted = normalizeChapterMarkdownHeading\(course, chapter, quality\.content\)/u);
});
