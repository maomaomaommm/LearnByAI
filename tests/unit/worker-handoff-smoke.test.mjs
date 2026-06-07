import assert from "node:assert/strict";
import test from "node:test";
import { runWorkerHandoffSmoke } from "../../scripts/worker-handoff-smoke.mjs";

test("worker handoff smoke skips cleanly without live env by default", async () => {
  const result = await runWorkerHandoffSmoke({
    appBaseUrl: "",
    internalWorkerSecret: "",
    supabaseUrl: "",
    supabaseAnonKey: "",
    supabaseServiceRoleKey: "",
    required: false,
  });

  assert.equal(result.skipped, true);
  assert.match(result.message, /Skipping worker handoff smoke/);
});

test("worker handoff smoke fails when required env is missing", async () => {
  await assert.rejects(
    () =>
      runWorkerHandoffSmoke({
        appBaseUrl: "",
        internalWorkerSecret: "",
        supabaseUrl: "",
        supabaseAnonKey: "",
        supabaseServiceRoleKey: "",
        required: true,
      }),
    /Worker handoff smoke required but missing configuration/,
  );
});

test("worker handoff smoke creates a queued course job and requires the worker to process it", async () => {
  const calls = [];
  const deletedUsers = [];
  const clients = {
    service: {
      auth: {
        admin: {
          createUser: async () => ({
            data: { user: { id: "11111111-1111-1111-1111-111111111111" } },
            error: null,
          }),
          deleteUser: async (id) => {
            deletedUsers.push(id);
            return { error: null };
          },
        },
      },
    },
    anon: {
      auth: {
        signInWithPassword: async () => ({
          data: { session: { access_token: "eyJworker-handoff-test-token" } },
          error: null,
        }),
      },
    },
  };
  const createClientImpl = (url, key) => {
    assert.equal(url, "https://learnbyai.supabase.co");
    return key === "service-role-secret" ? clients.service : clients.anon;
  };
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/api/courses") && init.method === "POST") {
      return jsonResponse({
        course: { id: "course-1" },
        job: { id: "job-1", status: "pending" },
      });
    }
    if (url.endsWith("/api/generation-jobs/job-1")) {
      return jsonResponse({ job: { id: "job-1", status: "succeeded" } });
    }
    if (url.endsWith("/api/courses/course-1") && init.method === "GET") {
      return jsonResponse({
        course: {
          id: "course-1",
          chapters: [{ id: "chapter-1", generationJobId: "chapter-job-1" }],
        },
      });
    }
    throw new Error(`Unexpected fetch ${url}`);
  };
  const workerCalls = [];
  const runWorkerOnce = async (input) => {
    workerCalls.push(input);
    return { processed: 1 };
  };

  const result = await runWorkerHandoffSmoke({
    appBaseUrl: "https://learnbyai.example.com/",
    internalWorkerSecret: "worker-secret-with-at-least-32-chars",
    supabaseUrl: "https://learnbyai.supabase.co",
    supabaseAnonKey: "anon-secret",
    supabaseServiceRoleKey: "service-role-secret",
    createClientImpl,
    fetchImpl,
    runWorkerOnce,
    timeoutMs: 1_000,
    pollMs: 1,
  });

  assert.equal(result.skipped, false);
  assert.equal(result.courseId, "course-1");
  assert.equal(result.jobId, "job-1");
  assert.equal(result.processed, 1);
  assert.equal(result.firstChapterJobId, "chapter-job-1");
  assert.equal(workerCalls.length, 1);
  assert.equal(workerCalls[0].jobId, "job-1");
  assert.equal(workerCalls[0].appBaseUrl, "https://learnbyai.example.com");
  assert.equal(workerCalls[0].internalWorkerSecret, "worker-secret-with-at-least-32-chars");
  assert.equal(deletedUsers[0], "11111111-1111-1111-1111-111111111111");
  assert.equal(calls[0].url, "https://learnbyai.example.com/api/courses");
  assert.match(calls[0].init.headers.authorization, /^Bearer eyJ/);
});

test("worker handoff smoke fails if the worker does not process the exact job", async () => {
  await assert.rejects(
    () =>
      runWorkerHandoffSmoke({
        appBaseUrl: "https://learnbyai.example.com",
        internalWorkerSecret: "worker-secret-with-at-least-32-chars",
        supabaseUrl: "https://learnbyai.supabase.co",
        supabaseAnonKey: "anon-secret",
        supabaseServiceRoleKey: "service-role-secret",
        createClientImpl: fakeClientFactory(),
        fetchImpl: async (url, init) => {
          if (url.endsWith("/api/courses") && init.method === "POST") {
            return jsonResponse({
              course: { id: "course-1" },
              job: { id: "job-1", status: "pending" },
            });
          }
          return jsonResponse({});
        },
        runWorkerOnce: async () => ({ processed: 0 }),
      }),
    /did not process/,
  );
});

function fakeClientFactory() {
  return (url, key) => {
    void url;
    if (key === "service-role-secret") {
      return {
        auth: {
          admin: {
            createUser: async () => ({
              data: { user: { id: "11111111-1111-1111-1111-111111111111" } },
              error: null,
            }),
            deleteUser: async () => ({ error: null }),
          },
        },
      };
    }
    return {
      auth: {
        signInWithPassword: async () => ({
          data: { session: { access_token: "eyJworker-handoff-test-token" } },
          error: null,
        }),
      },
    };
  };
}

function jsonResponse(value, options = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    json: async () => value,
  };
}
