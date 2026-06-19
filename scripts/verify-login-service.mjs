import { chromium } from "@playwright/test";

const target = process.env.TARGET_URL || "http://124.243.135.12/login";

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.PW_CHROMIUM_EXECUTABLE ||
      "C:\\Users\\17493\\AppData\\Local\\ms-playwright\\chromium-1219\\chrome-win64\\chrome.exe",
  });
  const page = await browser.newPage();
  await page.goto(target);
  await page.waitForSelector('form[data-auth-ready="true"]');

  await page.fill('input[name="email"]', `smoke-${Date.now()}@example.com`);
  await page.fill('input[name="password"]', "WrongPassword123");
  await page.click('button[type="submit"]');

  // Wait for either error message or toast
  const messageLocator = page.locator('form p:text-matches("邮箱或密码不正确|登录服务未配置")');
  const toastLocator = page.locator('[data-sonner-toast]');
  await Promise.race([
    messageLocator.waitFor({ timeout: 10000 }),
    toastLocator.waitFor({ timeout: 10000 }),
  ]);

  const message = await messageLocator.isVisible().catch(() => false)
    ? await messageLocator.textContent()
    : null;
  const toast = await toastLocator.isVisible().catch(() => false)
    ? await toastLocator.textContent()
    : null;

  console.log({ message, toast });

  if (message?.includes("登录服务未配置")) {
    console.error("FAIL: login service still unconfigured");
    process.exitCode = 1;
  } else if (message?.includes("邮箱或密码不正确")) {
    console.log("PASS: supabase client is configured (invalid credentials rejected)");
  } else if (toast?.includes("登录成功")) {
    console.log("PASS: login succeeded and toast shown");
  } else {
    console.log("UNKNOWN state; see screenshot");
    await page.screenshot({ path: "tmp/login-smoke.png", fullPage: true });
    process.exitCode = 1;
  }

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
