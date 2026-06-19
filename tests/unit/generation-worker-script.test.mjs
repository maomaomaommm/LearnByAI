import assert from "node:assert/strict";
import test from "node:test";
import { runGenerationWorkerOnce } from "../../scripts/run-generation-worker-once.mjs";

test("generation worker script posts to internal worker without printing secrets", async () => {
  const calls = [];
  const result = await runGenerationWorkerOnce({
    appBaseUrl: "https://learnbyai.example.com/",
    internalWorkerSecret: "worker-secret",
    jobId: "job-123",
    limit: "3",
    recover: "true",
    timeoutMs: "60000",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({ processed: 2, results: [{ id: "a" }, { id: "b" }] });
    },
  });

  assert.deepEqual(result, { processed: 2, results: [{ id: "a" }, { id: "b" }] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://learnbyai.example.com/api/internal/generation-worker");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.authorization, "Bearer worker-secret");
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(calls[0].init.body), { jobId: "job-123", limit: 3, recover: true });
});

test("generation worker script requires base url and worker secret", async () => {
  await assert.rejects(
    () => runGenerationWorkerOnce({ appBaseUrl: "", internalWorkerSecret: "worker-secret" }),
    /APP_BASE_URL is required/,
  );
  await assert.rejects(
    () => runGenerationWorkerOnce({ appBaseUrl: "https://learnbyai.example.com", internalWorkerSecret: "" }),
    /INTERNAL_WORKER_SECRET is required/,
  );
});

test("generation worker script validates app url and limit", async () => {
  await assert.rejects(
    () => runGenerationWorkerOnce({ appBaseUrl: "learnbyai.example.com", internalWorkerSecret: "worker-secret" }),
    /absolute http\(s\) URL/,
  );
  await assert.rejects(
    () =>
      runGenerationWorkerOnce({
        appBaseUrl: "https://learnbyai.example.com",
        internalWorkerSecret: "worker-secret",
        limit: "0",
      }),
    /positive integer/,
  );
  await assert.rejects(
    () =>
      runGenerationWorkerOnce({
        appBaseUrl: "https://learnbyai.example.com",
        internalWorkerSecret: "worker-secret",
        timeoutMs: "0",
      }),
    /positive integer/,
  );
});

test("generation worker script redacts bearer tokens from worker errors", async () => {
  await assert.rejects(
    () =>
      runGenerationWorkerOnce({
        appBaseUrl: "https://learnbyai.example.com",
        internalWorkerSecret: "worker-secret",
        fetchImpl: async () => jsonResponse({ error: "bad Bearer worker-secret" }, { ok: false, status: 401 }),
      }),
    (error) => {
      assert.match(error.message, /Bearer \[REDACTED\]/);
      assert.doesNotMatch(error.message, /worker-secret/);
      return true;
    },
  );
});

test("generation worker script times out stuck worker requests", async () => {
  await assert.rejects(
    () =>
      runGenerationWorkerOnce({
        appBaseUrl: "https://learnbyai.example.com",
        internalWorkerSecret: "worker-secret",
        timeoutMs: "1",
        fetchImpl: (_url, init) =>
          new Promise((resolve, reject) => {
            init.signal.addEventListener(
              "abort",
              () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
              { once: true },
            );
          }),
      }),
    /timed out after 1ms/u,
  );
});

function jsonResponse(value, options = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    json: async () => value,
  };
}
