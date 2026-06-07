import { expect, test } from "@playwright/test";

test("local beta login sets API identity and logout clears it", async ({ page }) => {
  const email = `local-${crypto.randomUUID()}@example.com`;

  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator("form button").first().click();
  await expect(page).toHaveURL(/\/courses$/, { timeout: 10_000 });
  await expect(
    page.evaluate(() => localStorage.getItem("learnbyai:local-user")),
  ).resolves.toBe(email);

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
  await page.getByRole("button", { name: "Sign out local beta user" }).click();
  await expect(page.getByText("Signed out.")).toBeVisible();
  await expect(
    page.evaluate(() => localStorage.getItem("learnbyai:local-user")),
  ).resolves.toBeNull();
});
