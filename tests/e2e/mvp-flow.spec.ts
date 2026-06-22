import { expect, test, type APIRequestContext } from "@playwright/test";

test("mock beta flow: create course, generate chapter, ask tutor, export", async ({ page }) => {
  test.setTimeout(90_000);
  const headers = { "x-learnbyai-user-id": `mvp-flow-${crypto.randomUUID()}@example.com` };

  await page.route("**/api/**", async (route) => {
    await route.continue({
      headers: {
        ...route.request().headers(),
        ...headers,
      },
    });
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "LearnByAI" })).toBeVisible();

  await page.locator('a[href="/create"]').first().click();
  await expect(page).toHaveURL(/\/create$/);
  await expect(page.locator("form")).toBeVisible();

  await page.locator('input[name="topic"]').fill("Mock Beta Flow");
  await page.locator('textarea[name="goal"]').fill("Verify the browser flow uses server-backed course data.");
  await page.locator('textarea[name="background"]').fill("A local fallback test user with basic study habits.");
  const submitButton = page.locator('form button[type="submit"]');
  await expect(submitButton).toBeEnabled();
  await submitButton.click();
  await expect(page).toHaveURL(/\/courses\/[0-9a-f-]+$/, { timeout: 30_000 });
  await expect(page.getByText("Course Bible").first()).toBeVisible({ timeout: 30_000 });
  const courseUrl = page.url();
  const courseId = courseUrl.match(/\/courses\/([^/?#]+)/)?.[1];
  expect(courseId).toBeTruthy();

  await expect.poll(async () => {
    const course = await readCourse(page.request, courseId!, headers);
    return course?.chapters?.length ?? 0;
  }, { timeout: 30_000 }).toBeGreaterThan(0);
  const initialCourse = await readCourse(page.request, courseId!, headers);
  expect(initialCourse).toBeTruthy();
  const queuedJobId = initialCourse.chapters[0].generationJobId;
  const jobResponse = await page.request.get(`/api/generation-jobs/${queuedJobId}`, { headers });
  expect(jobResponse.ok()).toBeTruthy();
  const jobJson = await jobResponse.json();
  expect(jobJson.job.id).toBe(queuedJobId);

  await expect(page.getByText("Course Bible").first()).toBeVisible();
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
  await expect(page.locator("article")).toBeVisible({ timeout: 30_000 });

  const paragraph = page.locator("article p").first();
  await paragraph.dblclick();
  await page.getByRole("button", { name: /问导师/ }).click();
  await expect(page.getByText("TARGET_TEXT")).toBeVisible();
  const tutorQuestion = `Explain this selection briefly ${crypto.randomUUID()}`;
  await page.locator('aside input[name="question"]').fill(tutorQuestion);
  await page.getByRole("button", { name: "发送问题" }).click();
  await expect(page.getByText("> USER")).toBeVisible();
  await expect(page.getByText(tutorQuestion)).toBeVisible();
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

  const course = await readCourse(page.request, courseId!, headers);
  expect(course).toBeTruthy();
  const pdfResponse = await page.request.post("/api/exports", {
    headers,
    data: { courseId: course.id, format: "pdf" },
  });
  expect(pdfResponse.ok()).toBeTruthy();
  const pdfJson = await pdfResponse.json();
  expect(pdfJson.export.contentType).toBe("application/pdf");
  expect(pdfJson.export.storagePath).toBeTruthy();
  expect(pdfJson.export.storageProvider).toBe("local");
  expect(pdfJson.export.content).toBeUndefined();
  const pdfDownload = await page.request.get(`/api/exports/${pdfJson.export.id}`, { headers });
  expect(pdfDownload.ok()).toBeTruthy();
  const pdfBytes = Buffer.from(await pdfDownload.body());
  expect(pdfBytes.subarray(0, 5).toString()).toBe("%PDF-");
});

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function readCourse(request: APIRequestContext, courseId: string, headers: Record<string, string>) {
  const response = await request.get(`/api/courses/${courseId}`, { headers });
  if (!response.ok()) return undefined;
  return ((await response.json()) as { course?: { id: string; chapters: { id: string; generationJobId?: string }[] } }).course;
}
