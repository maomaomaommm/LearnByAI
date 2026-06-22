import { expect, test, type APIRequestContext } from "@playwright/test";

const headers = () => ({ "x-learnbyai-user-id": `revise-${crypto.randomUUID()}@example.com` });

test("revise flow: propose rewrite, apply, revert (API)", async ({ request }) => {
  test.setTimeout(120_000);
  const h = headers();

  const create = await request.post("/api/courses", {
    headers: h,
    data: {
      topic: "Revise Flow",
      goal: "Verify the local-rewrite propose/apply/revert chain.",
      background: "Local fallback test user.",
      styles: ["intuition"],
      learningMode: "standard",
      chapterCount: 3,
      difficulty: "intermediate",
    },
  });
  expect(create.ok()).toBeTruthy();
  const { course } = await create.json();

  const planned = await waitFor(request, course.id, h, (c) => c.chapters.length > 0);
  const chapterId = planned.chapters[0].id;

  // Trigger chapter generation (idempotent) and wait for a TERMINAL status, so the
  // background pipeline is fully settled and won't overwrite content mid-test.
  await request.post(`/api/chapters/${chapterId}/generate`, { headers: h, data: { courseId: course.id } });
  const generated = await waitFor(request, course.id, h, (c) => isSettled(c.chapters[0]));
  const body = chapterBody(generated.chapters[0]);
  const anchor = pickAnchor(body);

  // 1) Propose a rewrite.
  const propose = await request.post("/api/revisions", {
    headers: h,
    data: { courseId: course.id, chapterId, selectedText: anchor, userMessage: "更详细", mode: "rewrite", scope: "selection" },
  });
  expect(propose.ok(), `propose failed: ${await propose.text()}`).toBeTruthy();
  const { revision } = await propose.json();
  expect(revision.status).toBe("proposed");
  expect(revision.afterText).not.toBe(revision.beforeText);

  // 2) Apply it.
  const apply = await request.post("/api/revisions/apply", { headers: h, data: { revisionId: revision.id } });
  expect(apply.ok(), `apply failed: ${await apply.text()}`).toBeTruthy();
  const applied = await apply.json();
  expect(applied.revision.status).toBe("applied");
  expect(chapterBody(applied.chapter)).toContain("模拟改写");

  // 3) Revert it.
  const revert = await request.post(`/api/revisions/${revision.id}/revert`, { headers: h });
  expect(revert.ok(), `revert failed: ${await revert.text()}`).toBeTruthy();
  const reverted = await revert.json();
  expect(reverted.revision.status).toBe("reverted");
  expect(chapterBody(reverted.chapter)).not.toContain("模拟改写");

  // State machine: a reverted revision cannot be applied again.
  const reapply = await request.post("/api/revisions/apply", { headers: h, data: { revisionId: revision.id } });
  expect(reapply.status()).toBe(409);

  // History lists the reverted revision.
  const history = await request.get(`/api/revisions?chapterId=${chapterId}`, { headers: h });
  expect(history.ok()).toBeTruthy();
  const { revisions } = await history.json();
  expect(revisions.find((r: { id: string; status: string }) => r.id === revision.id)?.status).toBe("reverted");
});

async function waitFor(
  request: APIRequestContext,
  courseId: string,
  h: Record<string, string>,
  predicate: (course: { chapters: { id: string; status?: string; content?: string; sections?: { content: string }[] }[] }) => boolean,
) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const read = await request.get(`/api/courses/${courseId}`, { headers: h });
    if (read.ok()) {
      const course = (await read.json()).course;
      if (course && predicate(course)) return course;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error("Timed out waiting for course state");
}

function isSettled(chapter: { status?: string; content?: string; sections?: { content: string }[] }) {
  return Boolean(chapter.content || chapter.sections?.length) && (chapter.status === "ready" || chapter.status === "quality_failed");
}

function chapterBody(chapter: { content?: string; sections?: { content: string }[] }) {
  return chapter.content ?? chapter.sections?.map((s) => s.content).join("\n\n") ?? "";
}

function pickAnchor(body: string): string {
  const lines = body.split("\n").map((line) => line.trim());
  for (const line of lines) {
    if (line.length >= 12 && line.length <= 80 && !/^[#>\-*|`]/.test(line) && body.split(line).length - 1 === 1) {
      return line;
    }
  }
  throw new Error("No unique prose anchor found in chapter body");
}
