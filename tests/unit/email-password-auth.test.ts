import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AUTH_MESSAGES,
  EmailPasswordAuthClient,
  authenticateWithEmailPassword,
} from "../../src/lib/emailPasswordAuth";

test("email password login calls signInWithPassword", async () => {
  const calls: unknown[] = [];
  const client = createClient({
    signInWithPassword: async (credentials) => {
      calls.push(credentials);
      return { data: { session: { access_token: "token" } } };
    },
  });

  const result = await authenticateWithEmailPassword(client, "login", {
    email: "user@example.com",
    password: "secret-password",
  });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, [{ email: "user@example.com", password: "secret-password" }]);
});

test("email password login returns a friendly invalid credential message", async () => {
  const client = createClient({
    signInWithPassword: async () => ({ data: null, error: new Error("Invalid login credentials") }),
  });

  const result = await authenticateWithEmailPassword(client, "login", {
    email: "user@example.com",
    password: "wrong-password",
  });

  assert.deepEqual(result, { ok: false, message: AUTH_MESSAGES.invalidCredentials });
});

test("email password sign-up succeeds immediately when Supabase returns a session", async () => {
  const calls: string[] = [];
  const client = createClient({
    signUp: async () => {
      calls.push("signup");
      return { data: { session: { access_token: "token" } } };
    },
    signInWithPassword: async () => {
      calls.push("signin");
      return { data: { session: { access_token: "token" } } };
    },
  });

  const result = await authenticateWithEmailPassword(client, "signup", {
    email: "new@example.com",
    password: "secret-password",
  });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, ["signup"]);
});

test("email password sign-up falls back to password login when no session is returned", async () => {
  const calls: string[] = [];
  const client = createClient({
    signUp: async () => {
      calls.push("signup");
      return { data: { session: null } };
    },
    signInWithPassword: async () => {
      calls.push("signin");
      return { data: { session: { access_token: "token" } } };
    },
  });

  const result = await authenticateWithEmailPassword(client, "signup", {
    email: "new@example.com",
    password: "secret-password",
  });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, ["signup", "signin"]);
});

test("email password sign-up switches back to login if auto-login is unavailable", async () => {
  const client = createClient({
    signUp: async () => ({ data: { session: null } }),
    signInWithPassword: async () => ({ data: null, error: new Error("Email not confirmed") }),
  });

  const result = await authenticateWithEmailPassword(client, "signup", {
    email: "new@example.com",
    password: "secret-password",
  });

  assert.deepEqual(result, {
    ok: false,
    message: AUTH_MESSAGES.signupNeedsLogin,
    nextMode: "login",
  });
});

function createClient(overrides: Partial<EmailPasswordAuthClient["auth"]>): EmailPasswordAuthClient {
  return {
    auth: {
      signInWithPassword: async () => ({ data: null }),
      signUp: async () => ({ data: null }),
      ...overrides,
    },
  };
}
