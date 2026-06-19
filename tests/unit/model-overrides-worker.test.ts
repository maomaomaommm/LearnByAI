import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MODEL_CONFIG_HEADER } from "../../src/lib/modelOverrides";
import { publicGenerationJob } from "../../src/lib/publicGenerationJob";

test("public generation jobs do not expose model override secrets", () => {
  const job = {
    id: crypto.randomUUID(),
    type: "course",
    courseId: crypto.randomUUID(),
    userId: crypto.randomUUID(),
    status: "pending",
    events: [],
    modelOverrides: {
      version: 1,
      default: {
        apiKey: "sk-secret",
        baseUrl: "https://api.example.com/v1",
        model: "mimo-v2.5-pro",
      },
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as const;

  const publicJob = publicGenerationJob(job);

  assert.equal(publicJob.modelOverrides, undefined);
  assert.doesNotMatch(JSON.stringify(publicJob), /sk-secret/u);
});

test("worker request source includes saved model overrides", () => {
  const source = readFileSync("src/lib/generationWorker.ts", "utf8");

  assert.match(source, /headers\.set\(MODEL_CONFIG_HEADER/u);
  assert.match(source, /JSON\.stringify\(job\.modelOverrides\)/u);
  assert.match(source, /getAdminAppSettings/u);
  assert.match(source, /courseChapterConcurrency/u);
  assert.match(source, /startLeaseHeartbeat/u);
  assert.match(source, /refreshServerGenerationJobLease/u);
  assert.match(source, /claimed by worker and started/u);
  assert.match(source, /claimed:\s*true/u);
  assert.equal(MODEL_CONFIG_HEADER, "x-learnbyai-models-config");
});

test("admin chapter actions inherit saved model overrides", () => {
  const source = readFileSync("src/lib/adminData.ts", "utf8");

  assert.match(source, /findAdminModelOverridesForChapter/u);
  assert.match(source, /retryAdminJob[\s\S]*modelOverrides/u);
  assert.match(source, /enqueueAdminChapterReview[\s\S]*modelOverrides/u);
  assert.match(source, /enqueueAdminChapterGeneration[\s\S]*modelOverrides/u);
  assert.match(source, /normalizeModelOverrides\(job\?\.modelOverrides\)/u);
});

test("public retry keeps model overrides and converts empty draft review jobs", () => {
  const routeSource = readFileSync("src/app/api/generation-jobs/[id]/route.ts", "utf8");
  const runnerSource = readFileSync("src/lib/generationRunner.ts", "utf8");

  assert.match(routeSource, /parseModelOverridesFromHeaders/u);
  assert.match(routeSource, /resolveModelOverrides/u);
  assert.match(routeSource, /modelOverrides:\s*resolvedOverrides\s*\?\?\s*job\.modelOverrides/u);
  assert.match(routeSource, /shouldRetryJobAsGeneration/u);
  assert.match(routeSource, /retryAsReview/u);
  assert.match(routeSource, /qualityReport:\s*undefined/u);
  assert.match(runnerSource, /Empty draft retry converted to chapter regeneration/u);
});

test("draft review does not persist candidate content before acceptance", () => {
  const runnerSource = readFileSync("src/lib/generationRunner.ts", "utf8");
  const draftReviewBlock = runnerSource.slice(
    runnerSource.indexOf("async function runDraftReviewChapterJob"),
    runnerSource.indexOf("async function runAuthorRewriteCandidate"),
  );

  assert.match(draftReviewBlock, /reviewExistingChapterDraft/u);
  assert.doesNotMatch(draftReviewBlock, /onStage:\s*async/u);
});

test("polisher repair can fall back to the default model", () => {
  const source = readFileSync("src/lib/maol/client.ts", "utf8");

  assert.match(source, /dispatchPolisherRepairText/u);
  assert.match(source, /polisherFuseByJob/u);
  assert.match(source, /isPermanentPolisherProviderError/u);
  assert.match(source, /POLISHER disabled for this job/u);
  assert.match(source, /POLISHER repair fallback started/u);
  assert.match(source, /agent:\s*"ASSISTANT"/u);
  assert.match(source, /Fallback instruction: the POLISHER provider is unavailable/u);
});

test("chapter generation saves readable draft before background review jobs", () => {
  const runnerSource = readFileSync("src/lib/generationRunner.ts", "utf8");
  const readinessSource = readFileSync("src/lib/chapterReadiness.ts", "utf8");
  const courseRouteSource = readFileSync("src/app/api/courses/[id]/route.ts", "utf8");
  const serverStoreSource = readFileSync("src/lib/serverStore.ts", "utf8");

  assert.match(runnerSource, /generateChapterDraft/u);
  assert.match(runnerSource, /shouldUseAsyncDraftReview/u);
  assert.match(runnerSource, /mode:\s*"review_draft"/u);
  assert.match(runnerSource, /status:\s*"draft_ready"/u);
  assert.match(runnerSource, /generationProfile \?\? "fast"/u);
  assert.match(readinessSource, /status === "draft_ready" \|\| status === "ready"/u);
  assert.match(courseRouteSource, /status:\s*"draft_ready"/u);
  assert.match(serverStoreSource, /generationJobQueuePriority/u);
  assert.match(serverStoreSource, /job\.mode !== "review_draft"/u);
  assert.match(serverStoreSource, /GENERATION_HEARTBEAT_STALE_MS/u);
  assert.match(serverStoreSource, /shouldRecoverStaleLockedRow/u);
});

test("structural chapter failures are escalated instead of chunk-repaired", () => {
  const source = readFileSync("src/lib/maol/client.ts", "utf8");

  assert.match(source, /shouldEscalateToAuthorRewrite/u);
  assert.match(source, /hasCatastrophicDraftSignal/u);
  assert.match(source, /score < 50 && hasCatastrophicDraftSignal/u);
  assert.match(source, /review_repair\.author_rewrite_required/u);
  assert.match(source, /requires full AUTHOR regeneration/u);
  assert.match(source, /withAuthorRewriteRequiredIssue/u);
});

test("chunk repair output is validated before being accepted", () => {
  const source = readFileSync("src/lib/maol/client.ts", "utf8");

  assert.match(source, /validateRepairedChunk/u);
  assert.match(source, /repair returned empty content/u);
  assert.match(source, /repair returned conversational text/u);
  assert.match(source, /repair wrapped the whole result in a code fence/u);
  assert.match(source, /repair shortened content too aggressively/u);
  assert.match(source, /repair lost heading/u);
});

test("reviewer JSON parse failures go through a repair workflow", () => {
  const source = readFileSync("src/lib/maol/client.ts", "utf8");
  const promptSource = readFileSync("src/lib/prompts/chapterReviewer.ts", "utf8");

  assert.match(source, /responseFormat:\s*"json_object"/u);
  assert.match(source, /parseReviewerJsonWithRepair/u);
  assert.match(source, /repairInvalidJsonEscapes/u);
  assert.match(source, /REVIEWER JSON parse failed; attempting JSON repair/u);
  assert.match(source, /buildChapterReviewJsonRepairPrompt/u);
  assert.match(promptSource, /JSON 修复器/u);
});

test("AI model config merges user profile below request overrides and above admin defaults", () => {
  const userConfigSource = readFileSync("src/lib/userModelConfig.ts", "utf8");
  const settingsSource = readFileSync("src/lib/adminSettings.ts", "utf8");
  const aiSource = readFileSync("src/lib/ai.ts", "utf8");

  assert.match(userConfigSource, /resolveModelOverrides/u);
  assert.match(userConfigSource, /getUserModelOverrides/u);
  assert.match(userConfigSource, /mergeModelOverrides/u);
  assert.match(settingsSource, /taskOverrides/u);
  assert.match(settingsSource, /adminOverrides/u);
  assert.match(aiSource, /options\?\.overrides/u);
});

test("worker recovery does not process jobs in the same request", () => {
  const source = readFileSync("src/lib/generationWorker.ts", "utf8");

  assert.match(source, /if \(input\.recover && !input\.jobId\)/u);
  assert.match(source, /recovered,\s*\n\s*jobs: \[\]/u);
});
