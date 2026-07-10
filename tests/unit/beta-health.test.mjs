import assert from "node:assert/strict";
import test from "node:test";
import { checkBetaHealth, expectedSchemaVersion } from "../../scripts/beta-health.mjs";

test("beta health script accepts a deployed app with the expected schema version", async () => {
  const calls = [];
  const result = await checkBetaHealth({
    appBaseUrl: "https://learnbyai.example.com/",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({
        ok: true,
        expectedSchemaVersion,
        actualSchemaVersion: expectedSchemaVersion,
        runtime: healthyRuntime(),
      });
    },
  });

  assert.equal(calls[0].url, "https://learnbyai.example.com/api/health/beta");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.cache, "no-store");
  assert.equal(calls[0].init.headers["cache-control"], "no-cache");
  assert.equal(result.ok, true);
});

test("beta health script rejects missing or invalid app urls", async () => {
  await assert.rejects(
    () => checkBetaHealth({ appBaseUrl: "" }),
    /APP_BASE_URL is required/,
  );
  await assert.rejects(
    () => checkBetaHealth({ appBaseUrl: "learnbyai.example.com" }),
    /absolute http\(s\) URL/,
  );
});

test("beta health script rejects deployed app schema mismatches", async () => {
  await assert.rejects(
    () =>
      checkBetaHealth({
        appBaseUrl: "https://learnbyai.example.com",
        fetchImpl: async () =>
          jsonResponse({
            ok: false,
            expectedSchemaVersion,
            actualSchemaVersion: "learnbyai-beta-old",
            runtime: healthyRuntime(),
          }),
      }),
    /schema mismatch/,
  );

  await assert.rejects(
    () =>
      checkBetaHealth({
        appBaseUrl: "https://learnbyai.example.com",
        fetchImpl: async () =>
          jsonResponse(
            { error: "bad Bearer secret-token" },
            { ok: false, status: 503 },
          ),
      }),
    (error) => {
      assert.match(error.message, /Bearer \[REDACTED\]/);
      assert.doesNotMatch(error.message, /secret-token/);
      return true;
    },
  );
});

test("beta health script rejects deployed runtime mismatches", async () => {
  await assert.rejects(
    () =>
      checkBetaHealth({
        appBaseUrl: "https://learnbyai.example.com",
        fetchImpl: async () =>
          jsonResponse({
            ok: true,
            expectedSchemaVersion,
            actualSchemaVersion: expectedSchemaVersion,
            runtime: {
              ...healthyRuntime(),
              aiMockMode: true,
            },
          }),
      }),
    /AI mock mode is active/,
  );

  await assert.rejects(
    () =>
      checkBetaHealth({
        appBaseUrl: "https://learnbyai.example.com",
        fetchImpl: async () =>
          jsonResponse({
            ok: true,
            expectedSchemaVersion,
            actualSchemaVersion: expectedSchemaVersion,
            runtime: {
              ...healthyRuntime(),
              workerMode: "inline",
            },
          }),
      }),
    /worker mode is inline/,
  );

  await assert.rejects(
    () =>
      checkBetaHealth({
        appBaseUrl: "https://learnbyai.example.com",
        fetchImpl: async () =>
          jsonResponse({
            ok: true,
            expectedSchemaVersion,
            actualSchemaVersion: expectedSchemaVersion,
            runtime: {
              ...healthyRuntime(),
              aiProviderConfigured: false,
              workerSecretConfigured: false,
            },
          }),
      }),
    /AI provider config is incomplete.*internal worker secret is not configured/s,
  );

  await assert.rejects(
    () =>
      checkBetaHealth({
        appBaseUrl: "https://learnbyai.example.com",
        expectedExportsBucket: "learnbyai-exports",
        fetchImpl: async () =>
          jsonResponse({
            ok: true,
            expectedSchemaVersion,
            actualSchemaVersion: expectedSchemaVersion,
            runtime: {
              ...healthyRuntime(),
              exportsBucket: "wrong-bucket",
            },
          }),
    }),
    /export bucket is wrong-bucket, expected learnbyai-exports/,
  );

  await assert.rejects(
    () =>
      checkBetaHealth({
        appBaseUrl: "https://learnbyai.example.com",
        fetchImpl: async () =>
          jsonResponse({
            ok: true,
            expectedSchemaVersion,
            actualSchemaVersion: expectedSchemaVersion,
            runtime: {
              ...healthyRuntime(),
              exportStorage: {
                bucketExists: false,
                private: false,
                fileSizeLimit: null,
                missingMimeTypes: ["application/pdf"],
              },
            },
          }),
      }),
    /export Storage bucket is missing.*export Storage bucket is not private.*file size limit is missing.*missing MIME types: application\/pdf/s,
  );
});

function jsonResponse(value, options = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    json: async () => value,
  };
}

function healthyRuntime() {
  return {
    supabaseConfigured: true,
    aiProviderConfigured: true,
    aiMockMode: false,
    workerMode: "external",
    workerSecretConfigured: true,
    exportsBucket: "learnbyai-exports",
    exportStorage: {
      bucketExists: true,
      private: true,
      fileSizeLimit: 52428800,
      missingMimeTypes: [],
    },
  };
}
