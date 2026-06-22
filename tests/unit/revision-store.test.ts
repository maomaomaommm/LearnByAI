import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Annotation, Revision } from "../../src/lib/types";

// Force the deterministic local-fallback store path (no Supabase) before the
// server module is evaluated. serverStore reads LEARNBYAI_LOCAL_STORE_PATH at
// module load, so this must run before the dynamic import below.
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const storeDir = join(tmpdir(), `learnbyai-store-${process.pid}-${Date.now()}`);
process.env.LEARNBYAI_LOCAL_STORE_PATH = join(storeDir, "store.json");

// serverStore imports "server-only"; test:unit runs with --conditions=react-server
// so that marker resolves to an empty module instead of throwing. The import is
// deferred into before() because tsx compiles test files to CJS (no top-level await),
// and because the env above must be in place before the module is evaluated.
let store: typeof import("../../src/lib/serverStore");

before(async () => {
  await mkdir(storeDir, { recursive: true });
  store = await import("../../src/lib/serverStore");
});

after(async () => {
  await rm(storeDir, { recursive: true, force: true });
});

test("revision round-trips through the local store and updates status", async () => {
  const chapterId = randomUUID();
  const revision: Revision = {
    id: randomUUID(),
    courseId: randomUUID(),
    chapterId,
    mode: "rewrite",
    scope: "selection",
    intent: "更详细",
    status: "proposed",
    beforeText: "旧文本",
    afterText: "新文本，更详细。",
    createdAt: new Date().toISOString(),
  };

  const saved = await store.saveServerRevision(revision);
  assert.equal(saved.id, revision.id);

  const list = await store.listServerRevisions(chapterId);
  assert.equal(list.length, 1);
  assert.equal(list[0].afterText, "新文本，更详细。");

  const got = await store.getServerRevision(revision.id);
  assert.equal(got?.intent, "更详细");
  assert.equal(got?.status, "proposed");

  const appliedAt = new Date().toISOString();
  const updated = await store.updateServerRevision(revision.id, { status: "applied", appliedAt });
  assert.equal(updated?.status, "applied");

  const reread = await store.getServerRevision(revision.id);
  assert.equal(reread?.status, "applied");
  assert.equal(reread?.appliedAt, appliedAt);
});

test("listServerRevisions isolates by chapter", async () => {
  const chapterA = randomUUID();
  const chapterB = randomUUID();
  await store.saveServerRevision(makeRevision(chapterA));
  await store.saveServerRevision(makeRevision(chapterB));

  const listA = await store.listServerRevisions(chapterA);
  assert.equal(listA.length, 1);
  assert.equal(listA[0].chapterId, chapterA);
});

test("annotation can be saved, listed, and deleted", async () => {
  const chapterId = randomUUID();
  const annotation: Annotation = {
    id: randomUUID(),
    chapterId,
    scope: "anchored",
    selectedText: "锚定文本",
    question: "这里为什么是这样？",
    messages: [],
    createdAt: new Date().toISOString(),
  };

  await store.saveServerAnnotation(annotation);
  assert.equal((await store.listServerAnnotations(chapterId)).length, 1);

  await store.deleteServerAnnotation(annotation.id);
  assert.equal((await store.listServerAnnotations(chapterId)).length, 0);
});

test("chapter-scope annotation persists without selectedText (泛问 contract)", async () => {
  const chapterId = randomUUID();
  const annotation: Annotation = {
    id: randomUUID(),
    chapterId,
    scope: "chapter",
    title: "整章泛问",
    question: "整体讲讲这一章",
    messages: [],
    createdAt: new Date().toISOString(),
  };

  const saved = await store.saveServerAnnotation(annotation);
  assert.equal(saved.selectedText, undefined);

  const list = await store.listServerAnnotations(chapterId);
  assert.equal(list.length, 1);
  assert.equal(list[0].scope, "chapter");
  assert.equal(list[0].title, "整章泛问");
});

function makeRevision(chapterId: string): Revision {
  return {
    id: randomUUID(),
    courseId: randomUUID(),
    chapterId,
    mode: "fix",
    scope: "selection",
    intent: "修复格式",
    status: "proposed",
    beforeText: "a",
    afterText: "b",
    createdAt: new Date().toISOString(),
  };
}
