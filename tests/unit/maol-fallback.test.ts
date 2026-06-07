import assert from "node:assert/strict";
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

test("mock fallback is disabled for real provider mode", () => {
  process.env.AI_MOCK_MODE = "false";
  process.env.AI_API_KEY = "test-key";

  assert.throws(() => assertMockFallbackAllowed(new Error("provider failed")), /provider failed/u);
});
