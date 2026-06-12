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
  assert.match(routeSource, /modelOverrides:\s*headerOverrides\s*\?\?\s*job\.modelOverrides/u);
  assert.match(routeSource, /shouldRetryJobAsGeneration/u);
  assert.match(routeSource, /retryAsReview/u);
  assert.match(routeSource, /qualityReport:\s*undefined/u);
  assert.match(runnerSource, /Empty draft retry converted to chapter regeneration/u);
});

test("polisher repair can fall back to the default model", () => {
  const source = readFileSync("src/lib/maol/client.ts", "utf8");

  assert.match(source, /dispatchPolisherRepairText/u);
  assert.match(source, /POLISHER repair fallback started/u);
  assert.match(source, /agent:\s*"ASSISTANT"/u);
  assert.match(source, /Fallback instruction: the POLISHER provider is unavailable/u);
});

test("AI model config merges admin defaults below request overrides", () => {
  const aiSource = readFileSync("src/lib/ai.ts", "utf8");
  const settingsSource = readFileSync("src/lib/adminSettings.ts", "utf8");

  assert.match(aiSource, /getEffectiveModelOverrides/u);
  assert.match(aiSource, /mergeModelOverrides/u);
  assert.match(settingsSource, /taskOverrides/u);
  assert.match(settingsSource, /adminOverrides/u);
});

test("worker recovery does not process jobs in the same request", () => {
  const source = readFileSync("src/lib/generationWorker.ts", "utf8");

  assert.match(source, /if \(input\.recover && !input\.jobId\)/u);
  assert.match(source, /recovered,\s*\n\s*jobs: \[\]/u);
});

