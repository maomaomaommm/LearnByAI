import { expect, test } from "@playwright/test";

test("mock beta flow: create course, generate chapter, ask tutor, export", async ({ page }) => {
  test.setTimeout(90_000);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "LearnByAI" })).toBeVisible();

  await page.locator('a[href="/create"]').first().click();
  await expect(page).toHaveURL(/\/create$/);
  await expect(page.locator("form")).toBeVisible();

  await page.locator('form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/courses\/[0-9a-f-]+$/, { timeout: 30_000 });
  await expect(page.getByText("Course Bible")).toBeVisible({ timeout: 30_000 });
  const courseUrl = page.url();

  await expect.poll(async () =>
    page.evaluate(() => {
      const courses = JSON.parse(localStorage.getItem("learnbyai:courses") ?? "[]");
      return courses[0]?.chapters?.length ?? 0;
    }),
  { timeout: 30_000 }).toBeGreaterThan(0);
  const initialCourse = await page.evaluate(() => {
    const courses = JSON.parse(localStorage.getItem("learnbyai:courses") ?? "[]");
    return courses[0];
  });
  const queuedJobId = initialCourse.chapters[0].generationJobId;
  const jobResponse = await page.request.get(`/api/generation-jobs/${queuedJobId}`);
  expect(jobResponse.ok()).toBeTruthy();
  const jobJson = await jobResponse.json();
  expect(jobJson.job.id).toBe(queuedJobId);

  await expect(page.getByText("Course Bible")).toBeVisible();
  const chapterHref = `/courses/${initialCourse.id}/chapters/${initialCourse.chapters[0].id}`;
  const chapterLink = page.locator(`a[href="${chapterHref}"]`);
  await expect(chapterLink).toBeVisible({
    timeout: 30_000,
  });

  await chapterLink.scrollIntoViewIfNeeded();
  await Promise.all([
    page.waitForURL(new RegExp(`${escapeRegex(chapterHref)}$`), { timeout: 30_000 }),
    chapterLink.click(),
  ]);
  await expect(page.getByText(/AI IS WRITING THE TEXTBOOK|TARGET_TEXT|Format Guard|REVIEWER/)).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(/Format Guard|REVIEWER|TQH/)).toBeVisible({ timeout: 30_000 });

  const paragraph = page.locator("article p").first();
  await paragraph.dblclick();
  await expect(page.getByText("TARGET_TEXT")).toBeVisible();
  await page.locator("aside button").filter({ hasText: /解释|瑙ｉ噴|example|例/ }).first().click();
  await expect(page.getByText("> TUTOR_AI")).toBeVisible({ timeout: 15_000 });

  await page.goto(courseUrl);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /TeX/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.tex$/);
  const texPath = await download.path();
  expect(texPath).toBeTruthy();
  const texContent = await download.createReadStream().then(
    (stream) =>
      new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = [];
        stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        stream.on("error", reject);
      }),
  );
  expect(texContent).toContain("\\documentclass{article}");
  expect(texContent.length).toBeGreaterThan(100);

  const course = await page.evaluate(() => {
    const courses = JSON.parse(localStorage.getItem("learnbyai:courses") ?? "[]");
    return courses[0];
  });
  const pdfResponse = await page.request.post("/api/exports", {
    data: { courseId: course.id, course, format: "pdf" },
  });
  expect(pdfResponse.ok()).toBeTruthy();
  const pdfJson = await pdfResponse.json();
  expect(pdfJson.export.contentType).toBe("application/pdf");
  expect(pdfJson.export.storagePath).toBeTruthy();
  expect(pdfJson.export.storageProvider).toBe("local");
  expect(pdfJson.export.content).toBeUndefined();
  const pdfDownload = await page.request.get(`/api/exports/${pdfJson.export.id}`);
  expect(pdfDownload.ok()).toBeTruthy();
  const pdfBytes = Buffer.from(await pdfDownload.body());
  expect(pdfBytes.subarray(0, 5).toString()).toBe("%PDF-");
});

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
