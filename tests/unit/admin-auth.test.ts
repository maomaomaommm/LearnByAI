import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { readFileSync } from "node:fs";
import { createSignedAdminSession, verifySignedAdminSession } from "../../src/lib/adminSession";

const envSnapshot = { ...process.env };

afterEach(() => {
  process.env = { ...envSnapshot };
});

test("admin credentials require explicit username password and session secret", () => {
  const source = readFileSync("src/lib/adminAuth.ts", "utf8");
  assert.match(source, /LEARNBYAI_ADMIN_USERNAME/u);
  assert.match(source, /LEARNBYAI_ADMIN_PASSWORD/u);
  assert.match(source, /LEARNBYAI_ADMIN_SESSION_SECRET/u);
  assert.match(source, /LEARNBYAI_ADMIN_COOKIE_SECURE/u);
  assert.match(source, /HttpOnly|httpOnly/u);
  assert.doesNotMatch(source, /NODE_ENV\s*===\s*["']production["']/u);
});

test("admin session rejects tampered tokens", async () => {
  const secret = "admin-session-secret-with-32-chars";

  const token = await createSignedAdminSession("admin", secret, 3600);
  const session = await verifySignedAdminSession(token, secret);
  assert.equal(session?.username, "admin");

  const tampered = token.replace(/.$/u, token.endsWith("a") ? "b" : "a");
  assert.equal(await verifySignedAdminSession(tampered, secret), undefined);
  assert.equal(await verifySignedAdminSession("Bearer ordinary-user-token", secret), undefined);
});
