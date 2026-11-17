import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 180_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [["list"], ["json", { outputFile: "e2e/results.json" }]],
  use: { baseURL: "http://localhost:3100", channel: process.env.PW_CHANNEL || undefined, trace: "retain-on-failure", screenshot: "only-on-failure", acceptDownloads: true },
  webServer: [
    { command: "bash e2e/start-backend.sh", url: "http://localhost:8100/api/health", reuseExistingServer: false, timeout: 60_000 },
    {
      command: "npx next dev -p 3100",
      url: "http://localhost:3100",
      reuseExistingServer: false,
      timeout: 120_000,
      env: { NEXT_PUBLIC_API_BASE_URL: "http://localhost:8100", NEXT_DIST_DIR: ".next-e2e" },
    },
  ],
});
