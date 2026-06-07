import assert from "node:assert/strict";
import { test } from "node:test";
import { publicSafeErrorMessage, redactPublicSecrets } from "../../src/lib/publicSafeError";
import { redactSecrets, safeErrorMessage } from "../../src/lib/safeError";

test("redactSecrets removes bearer tokens and API-key shaped values", () => {
  const text = redactSecrets(
    "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secret and sk-live-abcdefghijklmnopqrstuvwxyz",
  );

  assert.doesNotMatch(text, /eyJhbGci/u);
  assert.doesNotMatch(text, /sk-live/u);
  assert.match(text, /\[redacted\]/u);
});

test("safeErrorMessage hides provider payloads", () => {
  const message = safeErrorMessage(
    '{"error":{"message":"bad key sk-live-abcdefghijklmnopqrstuvwxyz","type":"auth"}}',
    "Provider request failed.",
  );

  assert.equal(message, "Provider request failed.");
});

test("safeErrorMessage keeps concise non-secret errors", () => {
  assert.equal(safeErrorMessage(new Error("Course not found"), "fallback"), "Course not found");
});

test("publicSafeErrorMessage hides Supabase and provider payloads from UI", () => {
  const message = publicSafeErrorMessage(
    new Error('Supabase AuthApiError {"access_token":"eyJsecret.payload","api_key":"sk-live-abcdefghijklmnopqrstuvwxyz"}'),
    "Sign-in failed.",
  );

  assert.equal(message, "Sign-in failed.");
});

test("publicSafeErrorMessage redacts tokens in concise UI errors", () => {
  const message = publicSafeErrorMessage(
    "Request rejected for Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secret",
    "fallback",
  );

  assert.equal(message, "Request rejected for [redacted]");
});

test("safeError reuses the public redaction rules", () => {
  assert.equal(redactSecrets("sk-live-abcdefghijklmnopqrstuvwxyz"), redactPublicSecrets("sk-live-abcdefghijklmnopqrstuvwxyz"));
});
