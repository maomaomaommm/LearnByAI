import { expect, test } from "@playwright/test";

test("login does not create a browser-local API identity", async ({ page }) => {
  const email = `local-${crypto.randomUUID()}@example.com`;

  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  const submitButton = page.locator("form button").first();
  await expect(submitButton).toBeEnabled();
  await submitButton.click();
  await expect(page.getByText("Supabase login is not configured. Please contact the administrator.")).toBeVisible();
  await expect(
    page.evaluate(() => localStorage.getItem("learnbyai:local-user")),
  ).resolves.toBeNull();

  const create = await page.request.post("/api/courses", {
    headers: { "x-learnbyai-user-id": email },
    data: {
      topic: "Local Identity",
      goal: "Verify identity header",
      background: "Local beta user",
      preference: "Concise",
      weeklyHours: 3,
    },
  });
  expect(create.ok()).toBeTruthy();
  const { course } = await create.json();

  const ownRead = await page.request.get(`/api/courses/${course.id}`, {
    headers: { "x-learnbyai-user-id": email },
  });
  expect(ownRead.ok()).toBeTruthy();

  await page.goto("/login");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByText("Signed out.")).toBeVisible();
  await expect(
    page.evaluate(() => localStorage.getItem("learnbyai:local-user")),
  ).resolves.toBeNull();
});
