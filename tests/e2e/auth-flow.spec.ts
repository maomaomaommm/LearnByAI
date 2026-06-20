import { expect, test } from "@playwright/test";
import { AUTH_UI_TEXT } from "../../src/lib/emailPasswordAuth";

test("login does not create a browser-local API identity", async ({ page }) => {
  const email = `local-${crypto.randomUUID()}@example.com`;

  await page.goto("/login");
  await expect(page.getByRole("heading", { name: AUTH_UI_TEXT.loginTitle })).toBeVisible();
  await expect(page.getByLabel(AUTH_UI_TEXT.password)).toHaveAttribute("required", "");
  await expect(page.getByLabel(AUTH_UI_TEXT.password)).toHaveAttribute("minlength", "6");
  await expect(page.getByRole("button", { name: AUTH_UI_TEXT.createAccount }).first()).toBeVisible();
  await expect(page.locator('form button[type="submit"]')).toHaveText(AUTH_UI_TEXT.signIn);

  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill("secret-password");
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
      chapterCount: 5, difficulty: "intermediate",
    },
  });
  expect(create.ok()).toBeTruthy();
  const { course } = await create.json();

  const ownRead = await page.request.get(`/api/courses/${course.id}`, {
    headers: { "x-learnbyai-user-id": email },
  });
  expect(ownRead.ok()).toBeTruthy();

  await page.goto("/login");
  await expect(
    page.evaluate(() => localStorage.getItem("learnbyai:local-user")),
  ).resolves.toBeNull();
});
