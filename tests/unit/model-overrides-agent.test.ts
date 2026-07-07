import assert from "node:assert/strict";
import test from "node:test";
import { explicitAgentOverride, ModelOverrides } from "../../src/lib/modelOverrides";

test("ignores web default overrides when Tutor has no explicit configuration", () => {
  const overrides: ModelOverrides = {
    version: 1,
    default: {
      apiKey: "web-default-key",
      baseUrl: "https://example.invalid/v1",
      model: "custom-model",
    },
  };

  assert.equal(explicitAgentOverride(overrides, "TUTOR"), undefined);
});

test("keeps only the explicit Tutor configuration", () => {
  const overrides: ModelOverrides = {
    version: 1,
    default: { model: "default-model" },
    agents: {
      AUTHOR: { model: "author-model" },
      TUTOR: { model: "tutor-model", apiKey: "tutor-key" },
    },
  };

  assert.deepEqual(explicitAgentOverride(overrides, "TUTOR"), {
    version: 1,
    agents: {
      TUTOR: { model: "tutor-model", apiKey: "tutor-key" },
    },
  });
});
