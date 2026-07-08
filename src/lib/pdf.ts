import "server-only";

import { chromium } from "playwright";

/**
 * Render a course (or a single chapter) to a PDF by driving a headless Chromium
 * over the internal print route. The app serves KaTeX/highlight CSS + fonts, so
 * math, code, and Mermaid diagrams render exactly as designed — then page.pdf()
 * paginates it. Direct download, no browser print dialog.
 */

// The headless browser hits the app on its own host. Follow PORT so e2e (:3100)
// and any non-default deployment work without extra config; override with
// PDF_RENDER_ORIGIN if the app is reachable at a different internal address.
const RENDER_ORIGIN =
  process.env.PDF_RENDER_ORIGIN || `http://127.0.0.1:${process.env.PORT || 3000}`;
const NAV_TIMEOUT_MS = 60_000;
const READY_TIMEOUT_MS = 30_000;

export async function renderCoursePdf(
  courseId: string,
  options: { chapterId?: string } = {},
): Promise<Buffer> {
  const secret = process.env.INTERNAL_WORKER_SECRET ?? "";
  const url = new URL(`/internal/print/${courseId}`, RENDER_ORIGIN);
  if (secret) url.searchParams.set("k", secret);
  if (options.chapterId) url.searchParams.set("chapter", options.chapterId);

  const browser = await chromium.launch({
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage();
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(url.toString(), { waitUntil: "networkidle", timeout: NAV_TIMEOUT_MS });
    // The print view flips window.__printReady once fonts + all Mermaid diagrams
    // have settled. Fall through on timeout rather than failing the export.
    await page
      .waitForFunction(() => window.__printReady === true, { timeout: READY_TIMEOUT_MS })
      .catch(() => undefined);

    return await page.pdf({
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<div></div>",
      footerTemplate:
        '<div style="width:100%;font-size:8px;color:#9ca3af;padding:0 16mm;text-align:right;">' +
        '<span class="pageNumber"></span> / <span class="totalPages"></span></div>',
      margin: { top: "16mm", bottom: "16mm", left: "16mm", right: "16mm" },
    });
  } finally {
    await browser.close();
  }
}
