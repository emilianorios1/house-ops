import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests-next/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "off",
    screenshot: "off",
    video: "off",
    channel: process.env.E2E_CHANNEL ?? "chrome",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    {
      name: "mobile",
      use: {
        ...devices["iPhone 13"],
        defaultBrowserType: "chromium",
        channel: process.env.E2E_CHANNEL ?? "chrome",
      },
    },
  ],
});
