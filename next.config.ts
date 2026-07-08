import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["localhost:3100"],
  // Playwright drives a real Chromium binary and uses dynamic requires — it must
  // stay external so Next doesn't try to bundle it into the server output.
  serverExternalPackages: ["playwright", "playwright-core"],
};

export default nextConfig;
