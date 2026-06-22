import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const script = "scripts/supabase-smoke.mjs";

test("Supabase smoke skips cleanly without env by default", () => {
  const result = runSmoke({});

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Skipping Supabase smoke/);
});

test("Supabase smoke fails without env when required by beta gate", () => {
  const result = runSmoke({ SUPABASE_SMOKE_REQUIRED: "true" });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Supabase smoke required but missing configuration/);
});

test("Supabase smoke checks the schema contract version from schema.sql", () => {
  const schema = readFileSync("supabase/schema.sql", "utf8");
  const smoke = readFileSync(script, "utf8");

  assert.match(schema, /create or replace function public\.learnbyai_schema_version\(\)/);
  assert.match(schema, /learnbyai-beta-2026-06-21-01/);
  assert.match(smoke, /learnbyai_schema_version/);
  assert.match(smoke, /learnbyai-beta-2026-06-21-01/);
  assert.match(smoke, /Supabase schema version mismatch/);
});

function runSmoke(env) {
  const cleanEnv = {
    PATH: process.env.PATH,
    Path: process.env.Path,
    SystemRoot: process.env.SystemRoot,
    ComSpec: process.env.ComSpec,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    NODE_OPTIONS: process.env.NODE_OPTIONS,
    ...env,
  };

  return spawnSync(process.execPath, [script], {
    cwd: process.cwd(),
    env: cleanEnv,
    encoding: "utf8",
  });
}
