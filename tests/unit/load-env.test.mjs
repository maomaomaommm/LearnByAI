import assert from "node:assert/strict";
import test from "node:test";
import { parseEnvFile } from "../../scripts/load-env.mjs";

test("parseEnvFile supports comments, export prefixes, and quoted values", () => {
  const values = parseEnvFile(`
    # LearnByAI local env
    export AI_SMOKE=true
    AI_API_BASE_URL=https://api.example.test/v1 # inline comment
    AI_MODEL="gpt-5.5"
    INTERNAL_WORKER_SECRET='worker secret'
    AI_PROMPT="line\\none"
  `);

  assert.equal(values.AI_SMOKE, "true");
  assert.equal(values.AI_API_BASE_URL, "https://api.example.test/v1");
  assert.equal(values.AI_MODEL, "gpt-5.5");
  assert.equal(values.INTERNAL_WORKER_SECRET, "worker secret");
  assert.equal(values.AI_PROMPT, "line\none");
});

test("parseEnvFile ignores invalid lines", () => {
  const values = parseEnvFile(`
    1INVALID=value
    NO_EQUALS
    VALID=value
  `);

  assert.deepEqual(values, { VALID: "value" });
});
