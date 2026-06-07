import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { AuthRequiredError, resolveFallbackUserId } from "../../src/lib/authCore";
import { canRunInternalWorkerRequest, isTrustedInternalWorkerRequest } from "../../src/lib/config";

const envSnapshot = { ...process.env };

afterEach(() => {
  process.env = { ...envSnapshot };
});

test("local beta mode accepts the local user header", async () => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  const request = new Request("http://localhost/api/courses", {
    headers: { "x-learnbyai-user-id": "local@example.com" },
  });

  assert.equal(resolveFallbackUserId(request), "local@example.com");
});

test("Supabase mode rejects local user header without a valid bearer token", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";

  const request = new Request("http://localhost/api/courses", {
    headers: { "x-learnbyai-user-id": "victim-user-id" },
  });

  assert.throws(() => resolveFallbackUserId(request), AuthRequiredError);
});

test("partial Supabase configuration also disables local user header auth", () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  const request = new Request("http://localhost/api/courses", {
    headers: { "x-learnbyai-user-id": "local@example.com" },
  });

  assert.throws(() => resolveFallbackUserId(request), AuthRequiredError);
  assert.equal(canRunInternalWorkerRequest(new Request("http://localhost/api/internal/generation-worker")), false);
});

test("Supabase mode permits trusted internal worker requests for UUID job owners only", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.INTERNAL_WORKER_SECRET = "worker-secret";

  const userId = "11111111-1111-4111-8111-111111111111";
  const request = new Request("http://localhost/api/internal/generation-worker", {
    headers: {
      "x-learnbyai-user-id": userId,
      "x-internal-worker-secret": "worker-secret",
    },
  });

  assert.equal(canRunInternalWorkerRequest(request), true);
  assert.equal(resolveFallbackUserId(request), userId);

  const forged = new Request("http://localhost/api/internal/generation-worker", {
    headers: {
      "x-learnbyai-user-id": "not-a-uuid",
      "x-internal-worker-secret": "worker-secret",
    },
  });

  assert.throws(() => resolveFallbackUserId(forged), AuthRequiredError);
});

test("Supabase mode treats bearer worker secret as internal auth only", () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.INTERNAL_WORKER_SECRET = "worker-secret";

  const userId = "22222222-2222-4222-8222-222222222222";
  const request = new Request("http://localhost/api/internal/generation-worker", {
    headers: {
      authorization: "Bearer worker-secret",
      "x-learnbyai-user-id": userId,
    },
  });

  assert.equal(canRunInternalWorkerRequest(request), true);
  assert.equal(isTrustedInternalWorkerRequest(request), true);
  assert.equal(resolveFallbackUserId(request), userId);
});

test("Supabase mode requires an internal worker secret for worker endpoint access", () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  delete process.env.INTERNAL_WORKER_SECRET;

  const request = new Request("http://localhost/api/internal/generation-worker");

  assert.equal(canRunInternalWorkerRequest(request), false);
});
