import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { readFileSync } from "node:fs";
import { readQuotaLimit } from "../../src/lib/quotaConfig";

const envSnapshot = { ...process.env };

afterEach(() => {
  process.env = { ...envSnapshot };
});

test("quota action env overrides test-wide quota env", () => {
  process.env.E2E_QUOTA_LIMIT = "2";
  process.env.QUOTA_ASK_TUTOR = "17";

  assert.equal(readQuotaLimit("ask_tutor"), 17);
  assert.equal(readQuotaLimit("export"), 2);
});

test("invalid quota env falls back to action defaults", () => {
  process.env.QUOTA_CREATE_COURSE = "not-a-number";
  process.env.QUOTA_GENERATE_CHAPTER = "-1";

  assert.equal(readQuotaLimit("create_course"), 20);
  assert.equal(readQuotaLimit("generate_chapter"), 100);
});

test("quota writes use the serialized success-only consumption helper", () => {
  const quotaSource = readFileSync("src/lib/quota.ts", "utf8");
  const courseRoute = readFileSync("src/app/api/courses/route.ts", "utf8");
  const exportRoute = readFileSync("src/app/api/exports/route.ts", "utf8");
  const annotationRoute = readFileSync("src/app/api/annotations/route.ts", "utf8");
  const chapterGenerateRoute = readFileSync("src/app/api/chapters/[id]/generate/route.ts", "utf8");
  const generationRunner = readFileSync("src/lib/generationRunner.ts", "utf8");

  assert.match(quotaSource, /export const assertQuota = checkQuota;/);
  assert.match(quotaSource, /export async function withQuotaConsumption/);
  assert.match(quotaSource, /withQuotaLock/);
  for (const source of [
    courseRoute,
    exportRoute,
    annotationRoute,
    chapterGenerateRoute,
    generationRunner,
  ]) {
    assert.match(source, /withQuotaConsumption/);
    assert.doesNotMatch(source, /assertQuota/);
    assert.doesNotMatch(source, /consumeQuota/);
  }
});

test("legacy chapter generation endpoint remains disabled", () => {
  const chapterRoute = readFileSync("src/app/api/chapters/route.ts", "utf8");

  assert.match(chapterRoute, /status:\s*410/);
  assert.doesNotMatch(chapterRoute, /generateChapter/);
  assert.doesNotMatch(chapterRoute, /consumeQuota/);
});
