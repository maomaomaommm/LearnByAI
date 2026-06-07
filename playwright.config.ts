import { defineConfig, devices } from "@playwright/test";

const aiSmoke = process.env.AI_SMOKE === "true";
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3100";
const useExternalServer = process.env.PLAYWRIGHT_EXTERNAL_SERVER === "true";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  workers: 1,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  ...(useExternalServer
    ? {}
    : {
        webServer: {
          command: "node scripts/start-e2e-server.mjs",
          url: baseURL,
          reuseExistingServer: false,
          timeout: 120_000,
          env: {
            AI_MOCK_MODE: aiSmoke ? "false" : "true",
            AI_API_BASE_URL: process.env.AI_API_BASE_URL ?? "https://api.yzccc.cloud/v1",
            AI_API_KEY: aiSmoke ? (process.env.AI_API_KEY ?? "") : "",
            AI_MODEL: process.env.AI_MODEL ?? "gpt-5.5",
            E2E_QUOTA_LIMIT: "2",
            INTERNAL_WORKER_SECRET: process.env.INTERNAL_WORKER_SECRET ?? "e2e-worker-secret",
            PLAYWRIGHT_BASE_URL: baseURL,
          },
        },
      }),
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
    },
  ],
});
