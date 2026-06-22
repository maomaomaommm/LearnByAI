import { expect, test } from "@playwright/test";

test("revise panel UI: select -> rewrite -> preview diff -> apply -> undo -> reapply -> delete", async ({ page }) => {
  test.setTimeout(180_000);
  const headers = { "x-learnbyai-user-id": `revise-ui-${crypto.randomUUID()}@example.com` };

  await page.route("**/api/**", async (route) => {
    await route.continue({ headers: { ...route.request().headers(), ...headers } });
  });

  const create = await page.request.post("/api/courses", {
    headers,
    data: {
      topic: "Revise UI Flow",
      goal: "Exercise the Revise panel end to end in the browser.",
      background: "Local fallback test user.",
      styles: ["intuition"],
      learningMode: "standard",
      chapterCount: 3,
      difficulty: "intermediate",
    },
  });
  expect(create.ok()).toBeTruthy();
  const { course } = await create.json();

  // Wait until the first chapter is planned.
  let chapterId = "";
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline && !chapterId) {
    const read = await page.request.get(`/api/courses/${course.id}`, { headers });
    if (read.ok()) {
      const c = (await read.json()).course;
      if (c?.chapters?.length) chapterId = c.chapters[0].id;
    }
    if (!chapterId) await new Promise((r) => setTimeout(r, 1500));
  }
  expect(chapterId).toBeTruthy();

  // Opening the chapter triggers generation; wait for the rendered article.
  await page.goto(`/courses/${course.id}/chapters/${chapterId}`);
  await expect(page.locator("article")).toBeVisible({ timeout: 60_000 });

  // Wait until generation is fully settled (terminal status) so the rendered content
  // is stable and won't be overwritten mid-interaction, then reload to reflect it.
  const settleDeadline = Date.now() + 75_000;
  while (Date.now() < settleDeadline) {
    const read = await page.request.get(`/api/courses/${course.id}`, { headers });
    if (read.ok()) {
      const ch = (await read.json()).course?.chapters?.[0];
      if (ch && (ch.content || ch.sections?.length) && (ch.status === "ready" || ch.status === "quality_failed")) break;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  await page.reload();
  await expect(page.locator("article p").first()).toBeVisible({ timeout: 30_000 });

  // Select a paragraph and open the Revise panel from the chooser.
  await page.locator("article p").first().dblclick();
  await page.getByRole("button", { name: /改写此处/ }).click();

  // Rewrite mode is the default; pick a preset to generate a proposal.
  await page.getByRole("button", { name: "更详细" }).click();

  // Before/after diff preview shows, then apply.
  await expect(page.getByText("改写后 (AFTER)")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("原文 (BEFORE)")).toBeVisible();
  await page.getByRole("button", { name: "应用改写" }).click();
  await expect(page.getByRole("button", { name: "已应用改写" })).toBeVisible({ timeout: 30_000 });

  // Back to history and undo the applied revision.
  await page.getByRole("button", { name: /返回历史/ }).click();
  await expect(page.getByTitle("撤销这次改写").first()).toBeVisible({ timeout: 30_000 });
  await page.getByTitle("撤销这次改写").first().click();
  await expect(page.getByText(/已撤销/).first()).toBeVisible({ timeout: 30_000 });

  // Re-apply the reverted revision, then delete the history entry.
  await expect(page.getByTitle("重新应用这次改写").first()).toBeVisible({ timeout: 30_000 });
  await page.getByTitle("重新应用这次改写").first().click();
  await expect(page.getByText(/已应用/).first()).toBeVisible({ timeout: 30_000 });
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByTitle("删除这条改写历史").first().click();
  await expect(page.getByText("改写历史 · 0")).toBeVisible({ timeout: 30_000 });
});
